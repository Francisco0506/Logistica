"""Arma el modelo que come OR-Tools a partir de los pedidos del día.

Aquí se traducen los pedidos reales a lo que el solver entiende: matriz de
tiempos y distancias, demandas, ventanas y capacidades.
"""
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
)

def build_data_model(fecha, num_vehicles, vehicle_capacities, depot_coords, minutos_turno=MINUTOS_TURNO_MAXIMO, hora_cero=None):
    """
    Construye las matrices de distancia/tiempo (por calle real, evitando
    autopistas de cuota vía OSRM) y las demandas/ventanas horarias.

    Solo entran al modelo las remisiones Pendiente/Asignado que NO pertenezcan
    ya a una ruta despachada (congelada) — esas se dejan intactas y jamás se
    tocan aquí, para no reasignar pedidos que ya salieron físicamente.
    """
    remisiones = list(
        Remision.objects.reales().filter(doc_date=fecha, estado__in=['Pendiente', 'Asignado'])
        .exclude(ruta__estado__in=ESTADOS_RUTA_CONGELADOS)
        .select_related('destino', 'ruta')
    )
    if not remisiones:
        return None

    # Todo lo que se entrega en el MISMO LUGAR es una sola parada: el camión se
    # estaciona una vez. Se agrupa por coordenada y no por destino porque SAP
    # manda varios Ship-To en el mismo punto — duplicados de captura y varios
    # negocios en un mismo domicilio. Ver _clave_lugar para el detalle y las
    # cifras medidas.
    grupos_por_lugar = {}
    remisiones_sin_geo = []
    for r in remisiones:
        if r.destino and r.destino.latitude is not None and r.destino.longitude is not None:
            grupos_por_lugar.setdefault(_clave_lugar(r.destino), []).append(r)
        else:
            # Nunca se asignan silenciosamente: se reportan para que el dispatcher
            # los vea y pueda resolverlos (geocodificar manualmente, etc.)
            remisiones_sin_geo.append(r)

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
            ini_comun, fin_comun = ventanas[0]
        time_windows.append(_ventana_recortada_a_turno(ini_comun, fin_comun, minutos_turno))
        remisiones_validas.append(remisiones_del_lugar)

    if len(locations) <= 1:
        return {'sin_solucion': True, 'remisiones_sin_geo': remisiones_sin_geo}

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
        'fuente_matriz': fuente_matriz,
    }


# ==========================================
# 3. SOLUCIONADOR PRINCIPAL (OR-TOOLS)
# ==========================================
class _SoloSimulacion(Exception):
    """Señal interna para deshacer lo que escribió una corrida de prueba."""

    def __init__(self, resultado):
        self.resultado = resultado

