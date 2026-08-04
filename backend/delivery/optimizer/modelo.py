"""Arma el modelo que come OR-Tools a partir de los pedidos del día.

Aquí se traducen los pedidos reales a lo que el solver entiende: matriz de
tiempos y distancias, demandas, ventanas y capacidades.
"""
from ..calendario import fecha_reparto_de
from ..models import Remision
from ..integrations.osrm import build_distance_time_matrices
from .reglas import (
    ESTADOS_RUTA_CONGELADOS,
    INTERVALO_SALIDA_MINUTOS,
    MINUTOS_TURNO_MAXIMO,
    PESO_ESTIMADO_KG,
    TIEMPO_DESCARGA_MINUTOS,
    VELOCIDAD_PROMEDIO_KMH,
    _clave_lugar,
    _ventana_en_minutos,
    _ventana_recortada_a_turno,
    recibe_ese_dia,
)

def build_data_model(fecha, num_vehicles, vehicle_capacities, depot_coords, minutos_turno=MINUTOS_TURNO_MAXIMO, hora_cero=None):
    """
    Construye las matrices de distancia/tiempo (por calle real, evitando
    autopistas de cuota vía OSRM) y las demandas/ventanas horarias.

    Solo entran al modelo las remisiones Pendiente/Asignado que NO pertenezcan
    ya a una ruta despachada (congelada) — esas se dejan intactas y jamás se
    tocan aquí, para no reasignar pedidos que ya salieron físicamente.
    """
    # El `order_by` NO es cosmético: sin él Postgres devuelve las filas en el
    # orden que se le da la gana, y ese orden decide cosas. Más abajo, cuando
    # dos clientes comparten domicilio con horarios que no se cruzan, se cae a
    # "la ventana del primero" — así que dos corridas sobre LOS MISMOS datos
    # podían dar planes distintos, que es de lo más caro de depurar en caliente.
    remisiones = list(
        Remision.objects.reales().filter(doc_date=fecha, estado__in=['Pendiente', 'Asignado'])
        .exclude(ruta__estado__in=ESTADOS_RUTA_CONGELADOS)
        .select_related('destino', 'ruta')
        .order_by('doc_entry')
    )
    if not remisiones:
        return None

    # Todo lo que se entrega en el MISMO LUGAR es una sola parada: el camión se
    # estaciona una vez. Se agrupa por coordenada y no por destino porque SAP
    # manda varios Ship-To en el mismo punto — duplicados de captura y varios
    # negocios en un mismo domicilio. Ver _clave_lugar para el detalle y las
    # cifras medidas.
    # El día en que el camión LLEGA, que es contra el que se miden los días en
    # que cada cliente recibe. No es el día del documento: lo capturado hoy sale
    # mañana.
    dia_reparto = fecha_reparto_de(fecha)

    grupos_por_lugar = {}
    remisiones_sin_geo = []
    remisiones_dia_cerrado = []
    for r in remisiones:
        if not (r.destino and r.destino.latitude is not None and r.destino.longitude is not None):
            # Nunca se asignan silenciosamente: se reportan para que el dispatcher
            # los vea y pueda resolverlos (geocodificar manualmente, etc.)
            remisiones_sin_geo.append(r)
        elif not recibe_ese_dia(r.destino, dia_reparto):
            # El cliente no recibe ese día. Se saca del plan y se REPORTA, igual
            # que los que no tienen coordenada: mandarle un camión a una puerta
            # cerrada gasta una parada que sí ocupaba alguien más, y no decirlo
            # dejaría al despachador buscando por qué ese pedido no aparece.
            remisiones_dia_cerrado.append(r)
        else:
            grupos_por_lugar.setdefault(_clave_lugar(r.destino), []).append(r)

    # Nodo 0 es el CEDIS
    locations = [depot_coords]
    demands = [0]
    time_windows = [(0, minutos_turno)]
    remisiones_validas = []  # una entrada por nodo: lista de remisiones de esa parada

    for remisiones_del_lugar in grupos_por_lugar.values():
        destino = remisiones_del_lugar[0].destino
        locations.append((destino.latitude, destino.longitude))
        peso_parada = sum(
            (r.peso_kg if r.peso_kg else PESO_ESTIMADO_KG) for r in remisiones_del_lugar
        )
        demands.append(int(peso_parada))
        # Cuando en un mismo lugar hay clientes distintos, cada uno puede tener
        # su propia ventana de recibo. Se toma la INTERSECCIÓN: el camión tiene
        # que llegar cuando TODOS estén abiertos, porque va a entregarles en la
        # misma parada. Si no se cruzan, se deja la del primero y el despachador
        # lo verá en las alertas.
        ventanas = [
            _ventana_en_minutos(r.destino, minutos_turno, hora_cero)
            for r in {r.destino_id: r for r in remisiones_del_lugar}.values()
        ]
        ini_comun = max(v[0] for v in ventanas)
        fin_comun = min(v[1] for v in ventanas)
        if ini_comun >= fin_comun:
            # No se cruzan: en el mismo domicilio hay quien recibe de mañana y
            # quien recibe de tarde. Se toma la ventana MÁS AMPLIA que las
            # cubre a todas, no la del primero de la lista.
            #
            # Antes era `ventanas[0]`, y eso tenía dos problemas. El chico: el
            # "primero" dependía del orden en que Postgres devolvía las filas
            # (ya corregido con el order_by de arriba). El grave: si al primero
            # le tocaba una ventana estrecha —un cliente que recibe 15:00-22:00
            # con turno de 6 h— quedaba recortada a un solo minuto al final del
            # turno, o sea infactible, y se caían del plan LOS CUATRO pedidos
            # del domicilio. Es el caso de PROVEO PARQUE MARTEL, que tiene
            # cuatro razones sociales en la misma puerta.
            #
            # Ensanchar es el mismo criterio que ya usa `_ventana_en_minutos`
            # con los dos turnos de un cliente: más vale sobrestimar cuándo
            # recibe —el camión llega y alguno estará abierto— que perder la
            # parada completa por un horario que ni siquiera se puede
            # representar con una sola ventana.
            ini_comun = min(v[0] for v in ventanas)
            fin_comun = max(v[1] for v in ventanas)
        time_windows.append(_ventana_recortada_a_turno(ini_comun, fin_comun, minutos_turno))
        remisiones_validas.append(remisiones_del_lugar)

    if len(locations) <= 1:
        return {
            'sin_solucion': True,
            'remisiones_sin_geo': remisiones_sin_geo,
            'remisiones_dia_cerrado': remisiones_dia_cerrado,
            'dia_reparto': dia_reparto,
        }

    distance_matrix, time_matrix, fuente_matriz = build_distance_time_matrices(locations, VELOCIDAD_PROMEDIO_KMH)

    # Sumar tiempo de descarga a cada columna destino (excepto el regreso al CEDIS)
    for i in range(len(time_matrix)):
        for j in range(len(time_matrix[i])):
            if j != 0:
                time_matrix[i][j] += TIEMPO_DESCARGA_MINUTOS

    # Salidas escalonadas: no todos los camiones salen a la misma hora del CEDIS.
    vehicle_starts = [i * INTERVALO_SALIDA_MINUTOS for i in range(num_vehicles)]

    return {
        'distance_matrix': distance_matrix,
        'time_matrix': time_matrix,
        'time_windows': time_windows,
        'demands': demands,
        'vehicle_capacities': vehicle_capacities,
        'num_vehicles': num_vehicles,
        'vehicle_starts': vehicle_starts,
        'depot': 0,
        'remisiones_validas': remisiones_validas,
        'remisiones_sin_geo': remisiones_sin_geo,
        'remisiones_dia_cerrado': remisiones_dia_cerrado,
        'dia_reparto': dia_reparto,
        'fuente_matriz': fuente_matriz,
    }


# ==========================================
# 3. SOLUCIONADOR PRINCIPAL (OR-TOOLS)
# ==========================================
class _SoloSimulacion(Exception):
    """Señal interna para deshacer lo que escribió una corrida de prueba."""

    def __init__(self, resultado):
        self.resultado = resultado

