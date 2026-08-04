"""Corre OR-Tools y guarda el plan del día.

Nunca destruye una ruta ya despachada: si el despachador vuelve a optimizar con
camiones en la calle, esas rutas se respetan y solo se replanea lo que sigue en
borrador.
"""
import os
from datetime import datetime, timedelta

from django.db import connection, transaction
from django.utils import timezone
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from .. import fleet
from ..calendario import nombre_dia
from ..models import Remision, Ruta
from .modelo import _SoloSimulacion, build_data_model
from .reglas import (
    ESTADOS_RUTA_CONGELADOS,
    HORA_CERO,
    MINUTOS_TURNO_MAXIMO,
    TIEMPO_DESCARGA_MINUTOS,
    es_zona_saltillo,
)

# Segundos que el solver se toma para exprimir una corrida normal.
#
# 20 s es el valor de operación: con 5 s el guided local search se quedaba corto
# para las mejoras de 2-opt en rutas largas. Se deja configurable por entorno
# para que la suite de pruebas —que corre el optimizador de verdad, no una
# imitación— no tarde un minuto en dar el mismo veredicto:
#
#     OPTIMIZER_SEGUNDOS=2 python manage.py test delivery
#
# Bajarlo en producción da rutas peores, no rutas equivocadas: el solver
# entrega la mejor solución que encontró en el tiempo que se le dio.
SEGUNDOS_SOLVER = int(os.getenv("OPTIMIZER_SEGUNDOS", "20"))


def solve_vrp(fecha, placas, depot_coords, horas_turno=None, hora_salida=None,
              simular=False, segundos_solver=None):
    """
    Resuelve el problema de ruteo de vehículos usando OR-Tools (VRPTW) sobre
    distancias/tiempos reales de calle (OSRM, evitando autopistas de cuota).
    Nunca destruye rutas ya despachadas (Cargando/Listo/En_Ruta/Finalizada).

    `placas`: las placas de los camiones que el despachador tiene ACTIVOS para
    esta corrida (ej. ["RA7475A", "PP4873A"]). Cada ruta se guarda con la placa
    real del camión que la lleva, y su capacidad y tope de paradas salen de la
    ficha de ESE camión (fleet.py).

    Antes esto recibía solo CUÁNTOS camiones había y tomaba los primeros N de
    una lista de capacidades. Apagar un camión y prender otro dejaba el plan
    corriendo con la capacidad del que se apagó, sin avisar; y las rutas se
    guardaban como "T-001", así que el historial no decía qué unidad fue.

    `horas_turno`: duración del turno de cada chofer para ESTA corrida (default
    6h). El despachador puede ampliarlo (ej. 7h) cuando los pedidos del día no
    caben en las rutas con el turno normal.

    `hora_salida` ("HH:MM"): a qué hora sale el PRIMER camión ese día (default
    09:00, la salida real medida). Es la palanca más fuerte del plan: como las
    ventanas de recibo de los clientes son horas de reloj fijas y 97 de 195
    destinos cierran antes de las 14:00, adelantar la salida una hora mete
    ~5 pedidos más, mientras que alargar el turno no mete casi ninguno.
    """
    # `simular`: corre exactamente el mismo cálculo y luego DESHACE todo lo que
    # escribió. Sirve para contestar "¿y si le doy una hora más?" sin tocar el
    # plan que el despachador está viendo. Se hace con una transacción que se
    # revierte a propósito, en vez de duplicar la lógica en una versión "de
    # mentiras" que tarde o temprano se desincronizaría de la de verdad.
    if simular:
        try:
            with transaction.atomic():
                resultado = solve_vrp(
                    fecha, placas, depot_coords, horas_turno, hora_salida,
                    simular=False, segundos_solver=segundos_solver,
                )
                raise _SoloSimulacion(resultado)
        except _SoloSimulacion as señal:
            return señal.resultado

    minutos_turno = int(horas_turno * 60) if horas_turno else MINUTOS_TURNO_MAXIMO
    hora_cero = datetime.strptime(hora_salida, "%H:%M") if hora_salida else HORA_CERO

    # Los camiones ya despachados hoy (Cargando/Listo/En_Ruta/Finalizada) no
    # están disponibles para rutas NUEVAS: ya salieron con su propia carga. Se
    # descartan por placa, así que el camión que se excluye es exactamente el
    # que está en la calle — no "uno cualquiera" como cuando esto se contaba.
    camiones_congelados = set(
        Ruta.objects.filter(fecha=fecha, estado__in=ESTADOS_RUTA_CONGELADOS).values_list('camion', flat=True)
    )
    placas_disponibles = [p for p in placas if p not in camiones_congelados]
    if not placas_disponibles:
        return {
            "status": "error",
            "message": "Todos los camiones activos ya están despachados hoy. Activa otro camión o espera a que alguno termine su ruta.",
        }

    # La capacidad y el tope de paradas siguen a la placa, no a la posición.
    num_vehicles = len(placas_disponibles)
    vehicle_capacities = [fleet.capacidad_kg(p) for p in placas_disponibles]
    max_paradas = [fleet.max_paradas(p) for p in placas_disponibles]

    data = build_data_model(fecha, num_vehicles, vehicle_capacities, depot_coords, minutos_turno, hora_cero)
    if not data:
        return {"status": "error", "message": "No hay remisiones válidas para optimizar en esta fecha."}

    if data.get('sin_solucion'):
        cerrados = data.get('remisiones_dia_cerrado', [])
        sin_geo = data['remisiones_sin_geo']
        # Dos causas distintas se arreglan de forma distinta, así que se dicen
        # por separado en vez de un "no hay nada que planear" a secas.
        partes = []
        if sin_geo:
            partes.append(f"{len(sin_geo)} sin coordenadas en SAP")
        if cerrados:
            partes.append(
                f"{len(cerrados)} de clientes que no reciben en "
                f"{nombre_dia(data['dia_reparto'])}"
            )
        return {
            "status": "error",
            "message": "No quedó ningún pedido que se pueda rutear: " + " y ".join(partes) + ".",
            "pedidos_sin_geo": [r.doc_num for r in sin_geo],
            "pedidos_dia_cerrado": [r.doc_num for r in cerrados],
        }

    # Zona Saltillo (+ Ramos Arizpe + Arteaga): a ~85 km del CEDIS, lejos de
    # todo lo demás. Por default el solver reparte sus paradas entre varios
    # camiones si eso le ahorra unos minutos en la ruta de cada uno, aunque
    # quepan perfecto en uno solo — cada camión de más que sale para allá es un
    # viaje de ~3 h de ida y vuelta que no hacía falta.
    nodos_zona_saltillo = [
        node for node in range(1, len(data['remisiones_validas']) + 1)
        if es_zona_saltillo(data['remisiones_validas'][node - 1][0].destino.city)
    ]

    # A QUÉ camión se le da la zona. Se escoge UNO solo y se le restringen esas
    # paradas: es más firme que pedirle al solver "que vayan todas juntas" —esa
    # forma la esquivaba tirando la zona ENTERA, que es lo peor de los dos
    # mundos— y además deja claro en el plan cuál es el camión de Saltillo.
    #
    # Se prefiere el de mayor capacidad entre los que aguantan el peso y el
    # número de paradas de la zona, para que le quede margen de llevar también
    # lo que le quede de paso.
    vehiculo_saltillo = None
    if len(nodos_zona_saltillo) > 1:
        demanda_zona = sum(data['demands'][n] for n in nodos_zona_saltillo)
        paradas_zona = len(nodos_zona_saltillo)
        candidatos = [
            v for v in range(data['num_vehicles'])
            if vehicle_capacities[v] >= demanda_zona and max_paradas[v] >= paradas_zona
        ]
        if candidatos:
            vehiculo_saltillo = max(candidatos, key=lambda v: vehicle_capacities[v])

    def _construir_y_resolver(forzar_zona_saltillo):
        """Arma el modelo de OR-Tools completo y lo resuelve. Se puede llamar
        dos veces: una intentando forzar la zona Saltillo a un solo camión, y
        —solo si esa primera pasada terminó tirando la zona entera en vez de
        acomodarla— otra vez sin la restricción, para que al menos se reparta
        entre varios en vez de perderse."""
        manager = pywrapcp.RoutingIndexManager(len(data['time_matrix']), data['num_vehicles'], data['depot'])
        routing = pywrapcp.RoutingModel(manager)

        def time_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            return data['time_matrix'][from_node][to_node]

        transit_callback_index = routing.RegisterTransitCallback(time_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

        # Tope global de la dimensión: el camión que sale más tarde también necesita
        # su turno completo de MINUTOS_TURNO_MAXIMO a partir de su propia salida.
        ultimo_inicio = max(data['vehicle_starts']) if data['vehicle_starts'] else 0
        tope_global_dimension = ultimo_inicio + minutos_turno

        time_dimension_name = 'Time'
        routing.AddDimension(
            transit_callback_index,
            30,  # espera máxima si llega temprano
            tope_global_dimension,
            False,
            time_dimension_name)

        time_dimension = routing.GetDimensionOrDie(time_dimension_name)

        # Coeficiente de span global: penaliza que una ruta termine mucho más tarde
        # que las demás. Sin esto el solver solo minimiza el tiempo TOTAL sumado, y
        # tiende a cargar unos camiones de más y dejar otros cortos, con rutas
        # dispersas. Con un valor bajo (10) equilibra la jornada entre camiones y
        # las rutas quedan más compactas/parejas, sin sacrificar cobertura — medido
        # en banco de pruebas: +1 pedido cubierto y ~13 min menos de desbalance
        # entre el camión más cargado y el más ligero, con los mismos kilómetros.
        time_dimension.SetGlobalSpanCostCoefficient(10)

        # La ventana de recibo se mide contra la hora en que el camión LLEGA, pero
        # el acumulado de la dimensión Time trae ya sumada la descarga de esta misma
        # parada (el callback de tránsito la lleva dentro, ver build_data_model):
        # o sea, CumulVar(nodo) es la hora de SALIDA de esa parada.
        #
        # Sin corregirlo, la ventana quedaba corrida 12 minutos hacia atrás: a un
        # cliente que recibe hasta las 13:00 se le rechazaba una llegada a las 12:55
        # (salida 13:07), y a uno que abre a las 15:00 se le aceptaba una llegada a
        # las 14:48. El propio código ya reconocía este desfase al restar la
        # descarga para calcular la ETA (más abajo), pero no aquí — así que el plan
        # tiraba pedidos que sí cabían y prometía otros a puerta cerrada.
        #
        # Se desplaza la ventana en vez de quitar la descarga del callback porque
        # ahí sí tiene que estar: es tiempo que consume el turno del chofer.
        for location_idx, time_window in enumerate(data['time_windows']):
            if location_idx == data['depot']:
                continue
            index = manager.NodeToIndex(location_idx)
            # El tope sigue siendo el turno: salir de una parada después de que se
            # acabó la jornada no es una opción, aunque el cliente siga abierto.
            ini = min(time_window[0] + TIEMPO_DESCARGA_MINUTOS, minutos_turno)
            fin = min(time_window[1] + TIEMPO_DESCARGA_MINUTOS, minutos_turno)
            time_dimension.CumulVar(index).SetRange(ini, max(ini, fin))

        for vehicle_id in range(data['num_vehicles']):
            start_index = routing.Start(vehicle_id)
            end_index = routing.End(vehicle_id)
            start_min = data['vehicle_starts'][vehicle_id]
            time_dimension.CumulVar(start_index).SetRange(start_min, start_min)
            # Cada camión debe regresar antes de que se le acabe SU turno,
            # sin importar a qué hora haya salido.
            time_dimension.CumulVar(end_index).SetMax(start_min + minutos_turno)

        def demand_callback(from_index):
            from_node = manager.IndexToNode(from_index)
            return data['demands'][from_node]

        demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
        routing.AddDimensionWithVehicleCapacity(
            demand_callback_index,
            0,
            data['vehicle_capacities'],
            True,
            "Capacity"
        )

        # Tope de paradas por camión. Mientras SAP no mande el peso real de cada
        # pedido, la restricción de kilos corre con un peso estimado y no es
        # confiable; el número de paradas que cada camión hace en un día sí está
        # medido con GPS, así que sirve de tope práctico para que el plan no le
        # cargue a un camión más entregas de las que ha hecho jamás.
        def paradas_callback(from_index):
            return 0 if manager.IndexToNode(from_index) == data['depot'] else 1

        paradas_callback_index = routing.RegisterUnaryTransitCallback(paradas_callback)
        routing.AddDimensionWithVehicleCapacity(
            paradas_callback_index,
            0,
            max_paradas,
            True,
            "Paradas"
        )

        # Permitir que un nodo quede sin visitar (con penalización alta) en vez de que
        # el solver falle por completo si la capacidad/tiempo no alcanza para todos:
        # así garantizamos que SIEMPRE haya una solución, y los que queden fuera se
        # reportan explícitamente para resolverlos (más camiones, otra fecha, etc.)
        PENALIZACION_NODO_SIN_VISITAR = 10_000_000
        for node in range(1, len(data['time_matrix'])):
            index = manager.NodeToIndex(node)
            routing.AddDisjunction([index], PENALIZACION_NODO_SIN_VISITAR)

        if forzar_zona_saltillo and vehiculo_saltillo is not None:
            # -1 es "sin visitar": se deja como opción a propósito. Sin él, el
            # nodo dejaría de ser descartable y un día en que la zona no cupiera
            # volvería INFACTIBLE el plan entero, no solo la zona.
            for node in nodos_zona_saltillo:
                routing.VehicleVar(manager.NodeToIndex(node)).SetValues([-1, vehiculo_saltillo])

        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
        search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        # 20s (antes 5s): con 5s el guided local search a veces se quedaba corto
        # para exprimir mejoras de 2-opt en rutas largas (~1-3% de tiempo de
        # manejo) en días con muchos pedidos. Optimizar Rutas tarda más en
        # responder a cambio de rutas más ajustadas.
        # Al simular escenarios se corren varios seguidos, así que ahí se usa un
        # límite más corto: interesa comparar cuántos pedidos caben en cada opción,
        # no exprimir el último minuto de manejo de cada una.
        search_parameters.time_limit.FromSeconds(segundos_solver or SEGUNDOS_SOLVER)

        solution = routing.SolveWithParameters(search_parameters)
        return manager, routing, time_dimension, solution

    # Primer intento: si la zona cabe por capacidad/paradas en al menos un
    # camión, se fuerza a que vaya en uno solo. Si el solver de todos modos
    # termina dejando pedidos de la zona sin camión (el intento "todos juntos"
    # no encajó en el turno/ventanas de ningún camión disponible), se vuelve a
    # resolver SIN la restricción: mejor repartida entre varios que perdida.
    #
    # POR QUÉ la zona terminó pudiendo o no ir en un solo camión. Son dos
    # historias distintas y antes las dos salían con el MISMO texto ("no caben
    # en un solo camión"), que además solo una de las dos veces era cierto:
    #
    #   'no_cupo_en_uno'  — sí hay un camión con capacidad y paradas de sobra,
    #                       pero metiéndole la zona completa no le alcanza el
    #                       turno o no le cuadran las ventanas de recibo. Se
    #                       arregla ampliando el turno o adelantando la salida.
    #   'sin_camion_grande' — ningún camión ACTIVO aguanta el peso o el número
    #                       de paradas de la zona. Se arregla prendiendo otro
    #                       camión, y ampliar el turno no sirve de nada.
    #
    # Decirle "no caben en un solo camión" al despachador cuando el problema es
    # que traía prendidas dos camionetas de 1 t lo manda a mover la palanca
    # equivocada.
    causa_zona_saltillo = None
    if vehiculo_saltillo is not None:
        manager, routing, time_dimension, solution = _construir_y_resolver(forzar_zona_saltillo=True)
        # Solo se acepta si el candado NO costó pedidos: si el camión único no
        # alcanza a hacer todas las paradas de la zona dentro de su turno y sus
        # ventanas, el solver las deja fuera. Perder entregas es peor que mandar
        # un segundo camión, así que en ese caso se repite sin el candado y se
        # avisa en el mensaje del panel.
        zona_completa = solution is not None and all(
            solution.Value(routing.ActiveVar(manager.NodeToIndex(n))) == 1
            for n in nodos_zona_saltillo
        )
        if not zona_completa:
            manager, routing, time_dimension, solution = _construir_y_resolver(forzar_zona_saltillo=False)
            causa_zona_saltillo = 'no_cupo_en_uno'
    else:
        manager, routing, time_dimension, solution = _construir_y_resolver(forzar_zona_saltillo=False)
        if len(nodos_zona_saltillo) > 1:
            causa_zona_saltillo = 'sin_camion_grande'

    if not solution:
        return {"status": "error", "message": "El algoritmo no encontró ninguna solución. Revisa capacidades y ventanas de horario."}

    # ==========================================
    # 4. EXTRACCIÓN Y GUARDADO EN DB
    # ==========================================
    with transaction.atomic():
        # ── Revalidación: ¿siguen libres los camiones con los que se planeó? ──
        #
        # `camiones_congelados` se leyó ANTES de salir a OSRM y de los 20 s del
        # solver. Entre esa lectura y esta línea pasa casi medio minuto, y el
        # almacén no se detiene mientras tanto.
        #
        # Lo que pasó el 4-ago-2026: 09:05 el despachador aprieta "Optimizar
        # rutas"; 09:05:08 el almacén pone el PP4873A en 'Cargando'. El camión
        # entró a la corrida como disponible, así que abajo se le crea una ruta
        # NUEVA; y su ruta vieja ya no es 'Borrador', así que el delete de aquí
        # no se la lleva. El camión terminó con dos rutas del mismo día, y los
        # pedidos que los de almacén ya estaban subiendo se los quedó otro
        # camión — sin que nada avisara.
        #
        # Volver a preguntar aquí adentro, con la transacción ya abierta, es lo
        # que cierra la ventana: si algo cambió, esta corrida no vale y se
        # aborta ENTERA (todavía no se ha borrado ni escrito nada), en vez de
        # guardar un plan que contradice lo que hay en el patio. El despachador
        # vuelve a apretar el botón y la siguiente corrida ya sale con el camión
        # descontado.
        rutas_congeladas = Ruta.objects.filter(
            fecha=fecha, estado__in=ESTADOS_RUTA_CONGELADOS
        )
        if connection.features.has_select_for_update:
            # El candado deja esperando a cualquier otra transacción que quiera
            # despachar uno de estos camiones mientras se escriben las rutas.
            # Va detrás del `if` porque SQLite —la base de las pruebas— no lo
            # soporta y Django revienta con NotSupportedError en vez de
            # ignorarlo; ahí no hace falta, no hay concurrencia que proteger.
            rutas_congeladas = rutas_congeladas.select_for_update()
        congelados_ahora = set(rutas_congeladas.values_list('camion', flat=True))

        despachados_a_media_corrida = sorted(
            set(placas_disponibles) & congelados_ahora
        )
        if despachados_a_media_corrida:
            return {
                "status": "error",
                "message": (
                    "El plan se descartó sin guardar nada: mientras se calculaba, "
                    f"el almacén empezó a despachar {', '.join(despachados_a_media_corrida)}. "
                    "Vuelve a optimizar para que las rutas salgan con ese camión ya descontado."
                ),
                "camiones_despachados_durante_la_corrida": despachados_a_media_corrida,
            }

        # Solo se destruyen rutas 'Borrador' del día (aún no despachadas). Las
        # congeladas (Cargando/Listo/En_Ruta/Finalizada) quedan intactas.
        Ruta.objects.filter(fecha=fecha, estado='Borrador').delete()

        # remisiones_validas[i] es una LISTA de documentos que comparten parada
        # (mismo destino) — se recorren y actualizan todos juntos.
        remisiones_validas = data['remisiones_validas']
        nodos_visitados = set()
        rutas_generadas = []
        # Con qué camiones acabó repartida la zona Saltillo DE VERDAD. El aviso
        # de "se repartieron entre varios" se armaba con la intención (si se
        # había podido forzar o no), no con el resultado: con un solo camión
        # activo el plan avisaba que la zona se había repartido entre varios
        # camiones que no existían. Aquí se cuenta lo que quedó escrito.
        vehiculos_zona_saltillo = set()
        nodos_zona = set(nodos_zona_saltillo)
        for vehicle_id in range(data['num_vehicles']):
            index = routing.Start(vehicle_id)
            route_sequence = []  # lista de paradas; cada parada es una lista de remisiones

            while not routing.IsEnd(index):
                time_var = time_dimension.CumulVar(index)
                minutos_desde_cero = solution.Min(time_var)

                node_index = manager.IndexToNode(index)
                if node_index != 0:
                    nodos_visitados.add(node_index)
                    if node_index in nodos_zona:
                        vehiculos_zona_saltillo.add(vehicle_id)
                    remisiones_parada = remisiones_validas[node_index - 1]
                    # La ETA que se le promete al cliente es la hora de LLEGADA.
                    # El acumulado de la dimensión Time trae ya la descarga de
                    # esta misma parada (el callback de tránsito la lleva sumada,
                    # ver build_data_model), así que hay que restarla: sin esto
                    # se prometían 12 min más tarde de cuando el camión de verdad
                    # toca la puerta, y además no cuadraba con la ETA que calcula
                    # recalcular_etas_desde_salida, que sí da la llegada limpia
                    # — el mismo pedido cambiaba de hora al apretar "Salida".
                    # La espera por ventana de recibo se acumula en la parada
                    # anterior (slack de la dimensión), así que la resta es válida
                    # aunque el camión llegue antes de que el cliente abra.
                    minutos_llegada = minutos_desde_cero - TIEMPO_DESCARGA_MINUTOS
                    eta_time = hora_cero + timedelta(minutes=minutos_llegada)
                    for remision in remisiones_parada:
                        # 24 h, igual que como se captura el horario en SAP.
                        remision.eta = eta_time.strftime("%H:%M")
                    route_sequence.append(remisiones_parada)

                index = solution.Value(routing.NextVar(index))

            # Aquí `index` ya es el nodo final: el regreso al CEDIS. Su acumulado
            # es la hora a la que el camión cierra su jornada, y es el número que
            # de verdad hay que comparar contra el turno. La columna del depósito
            # NO lleva sumada descarga (ver build_data_model), así que esto es el
            # regreso limpio.
            minutos_regreso = solution.Min(time_dimension.CumulVar(index))
            salida_plan = (hora_cero + timedelta(minutes=data['vehicle_starts'][vehicle_id])).strftime("%H:%M")
            regreso_plan = (hora_cero + timedelta(minutes=minutos_regreso)).strftime("%H:%M")

            if route_sequence:
                # La ruta se guarda con la PLACA del camión que la lleva. El
                # vehículo `vehicle_id` del solver es exactamente el camión
                # `placas_disponibles[vehicle_id]`, con cuya capacidad y tope de
                # paradas se resolvió, así que el plan y lo guardado no pueden
                # discrepar. El chofer se deja vacío a propósito: quién maneja no
                # es un dato que el sistema tenga (ver docs/pendientes.md §1), y
                # antes se inventaba un "Chofer 1" que parecía real.
                ruta_obj = Ruta.objects.create(
                    fecha=fecha,
                    camion=placas_disponibles[vehicle_id],
                    chofer='',
                    estado='Borrador',
                    salida_plan=salida_plan,
                    regreso_plan=regreso_plan,
                )

                remisiones_to_update = []
                total_documentos = 0
                for seq, remisiones_parada in enumerate(route_sequence):
                    for remision in remisiones_parada:
                        remision.ruta = ruta_obj
                        remision.secuencia_ruta = seq + 1
                        remision.estado = 'Asignado'
                        remisiones_to_update.append(remision)
                        total_documentos += 1

                Remision.objects.bulk_update(remisiones_to_update, ['ruta', 'secuencia_ruta', 'estado', 'eta'])

                rutas_generadas.append({
                    "ruta_id": ruta_obj.id,
                    "camion": ruta_obj.camion,
                    "paradas": len(route_sequence),
                    "pedidos": total_documentos,
                })

        # Pedidos que el solver no pudo colocar en ninguna ruta (capacidad/tiempo
        # insuficientes) + los que no tenían coordenadas: se reportan, nunca se
        # pierden silenciosamente.
        remisiones_no_asignadas = [
            remision
            for i in range(1, len(remisiones_validas) + 1)
            if i not in nodos_visitados
            for remision in remisiones_validas[i - 1]
        ]
        # Regresarlos explícitamente a Pendiente y sin ruta: si venían de una
        # corrida anterior con estado 'Asignado' apuntando a una ruta que esta
        # corrida ya borró, sin esto quedan huérfanos (ni en ningún camión, ni
        # en Alertas porque esas solo muestran estado='Pendiente') — invisibles
        # para el despachador aunque sigan existiendo en la base de datos.
        for remision in remisiones_no_asignadas:
            remision.estado = 'Pendiente'
            remision.ruta = None
            remision.secuencia_ruta = None
            # La ETA también se borra. Si no, el pedido queda sin camión pero
            # con la hora de la corrida anterior, y el panel de ventas le sigue
            # diciendo a la vendedora "llega entre 13:20 y 13:35" de un pedido
            # que no va en ningún camión — una hora inventada con toda la cara
            # de ser real.
            remision.eta = None
        if remisiones_no_asignadas:
            Remision.objects.bulk_update(
                remisiones_no_asignadas, ['estado', 'ruta', 'secuencia_ruta', 'eta']
            )

        # Los clientes que no reciben ese día quedan igual de limpios que los
        # que no cupieron: si venían 'Asignado' de una corrida anterior contra
        # una ruta que ésta ya borró, sin esto quedan apuntando a la nada.
        dia_cerrado = data.get('remisiones_dia_cerrado', [])
        for remision in dia_cerrado:
            remision.estado = 'Pendiente'
            remision.ruta = None
            remision.secuencia_ruta = None
            remision.eta = None
        if dia_cerrado:
            Remision.objects.bulk_update(dia_cerrado, ['estado', 'ruta', 'secuencia_ruta', 'eta'])

        # Y los que no tienen coordenada, que era el TERCER grupo y el único que
        # se quedaba sin limpiar: solo se leía para armar el mensaje.
        #
        # Se llega ahí porque `asignar_manualmente` no bloquea un pedido sin
        # coordenadas —`sugerir` devuelve un error, las opciones salen vacías y
        # el guardia `if opcion and not opcion["factible"]` no dispara— así que
        # el despachador lo mete a mano y queda 'Asignado'. Al re-optimizar, su
        # ruta Borrador se borra, el SET_NULL lo deja sin ruta, y conservaba
        # 'Asignado' con su secuencia y su ETA viejas: no salía en ningún camión,
        # no salía en Alertas (que filtran estado='Pendiente') y ninguna corrida
        # futura lo levantaba. Existía en la base y era invisible.
        sin_geo = data.get('remisiones_sin_geo', [])
        for remision in sin_geo:
            remision.estado = 'Pendiente'
            remision.ruta = None
            remision.secuencia_ruta = None
            remision.eta = None
        if sin_geo:
            Remision.objects.bulk_update(sin_geo, ['estado', 'ruta', 'secuencia_ruta', 'eta'])

        pedidos_no_asignados = [r.doc_num for r in remisiones_no_asignadas]
        pedidos_sin_geo = [r.doc_num for r in data['remisiones_sin_geo']]
        pedidos_dia_cerrado = [r.doc_num for r in dia_cerrado]

        mensajes_fuente = {
            "osrm_sin_casetas": "Rutas generadas con distancias reales de calle, evitando autopistas de cuota.",
            "osrm": "Rutas generadas con distancias reales de calle. El servidor de ruteo no soportó evitar casetas en esta corrida.",
            "haversine_demasiadas_paradas": (
                "ATENCIÓN: hoy hay más paradas de las que acepta el servidor de ruteo público (máx. 100), "
                "así que las rutas se calcularon EN LÍNEA RECTA y el orden de las paradas no es confiable. "
                "Revísalas antes de despachar. Se corrige apuntando a un servidor OSRM propio."
            ),
            "haversine_sin_respuesta": (
                "ATENCIÓN: el servidor de ruteo no respondió, así que las rutas se calcularon EN LÍNEA RECTA "
                "y el orden de las paradas no es confiable. Revísalas antes de despachar."
            ),
        }
        # .get() y no [] a propósito: un fuente nuevo no debe tumbar una corrida
        # que ya generó rutas válidas y las acaba de guardar en la BD.
        message = mensajes_fuente.get(
            data['fuente_matriz'],
            "Rutas generadas, pero no se pudo determinar la fuente de las distancias. Revísalas antes de despachar.",
        )
        if pedidos_no_asignados:
            message += f" {len(pedidos_no_asignados)} pedido(s) no cupieron en ninguna ruta: {pedidos_no_asignados}."
        if pedidos_sin_geo:
            message += f" {len(pedidos_sin_geo)} pedido(s) sin coordenadas, no considerados: {pedidos_sin_geo}."
        if pedidos_dia_cerrado:
            message += (
                f" {len(pedidos_dia_cerrado)} pedido(s) NO se planearon porque el cliente "
                f"no recibe en {nombre_dia(data['dia_reparto'])}: {pedidos_dia_cerrado}. "
                f"Hay que moverlos a otro día o corregir el horario en SAP."
            )
        # El aviso solo sale si la zona DE VERDAD quedó partida entre dos o más
        # camiones. Que no se haya podido forzar no significa que se haya
        # repartido: el solver puede acabar juntándola solo, o puede no haber
        # más que un camión al que mandarla.
        if causa_zona_saltillo and len(vehiculos_zona_saltillo) > 1:
            placas_zona = ", ".join(
                sorted(placas_disponibles[v] for v in vehiculos_zona_saltillo)
            )
            if causa_zona_saltillo == 'sin_camion_grande':
                message += (
                    f" Zona Saltillo/Ramos Arizpe/Arteaga: ningún camión activo aguanta solo "
                    f"el peso y las {len(nodos_zona_saltillo)} paradas de la zona, así que se "
                    f"repartió entre {len(vehiculos_zona_saltillo)} ({placas_zona}). "
                    f"Prende un camión más grande si quieres que vaya en uno solo."
                )
            else:
                message += (
                    f" Zona Saltillo/Ramos Arizpe/Arteaga: las {len(nodos_zona_saltillo)} paradas "
                    f"no cupieron en un solo camión dentro del turno y sus ventanas de recibo, "
                    f"así que se repartió entre {len(vehiculos_zona_saltillo)} ({placas_zona}). "
                    f"Con más horas de turno o saliendo más temprano puede caber en uno."
                )

        return {
            "status": "success",
            "message": message,
            "rutas": rutas_generadas,
            "pedidos_no_asignados": pedidos_no_asignados,
            "pedidos_sin_geo": pedidos_sin_geo,
            "pedidos_dia_cerrado": pedidos_dia_cerrado,
        }

