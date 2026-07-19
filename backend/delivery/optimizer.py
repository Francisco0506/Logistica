from datetime import datetime, timedelta
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
from django.db import transaction
from .models import Ruta, Remision
from .routing_service import build_distance_time_matrices

# ==========================================
# 1. CONSTANTES DE TIEMPO Y CONFIGURACIÓN
# ==========================================
# ── Constantes medidas con 1 mes de GPS real (Samsara), SOLO los 5 camiones
# que de verdad operan (013, 016, 017, 023, 027 — se excluyen 024/015/012 que
# casi no salen y ensuciaban los promedios). Ver docs/uso-flota-samsara.md.
VELOCIDAD_PROMEDIO_KMH = 42.0  # Solo se usa si OSRM no responde (respaldo Haversine) — real: promedio 42.3 km/h, mediana 39.0
TIEMPO_DESCARGA_MINUTOS = 12   # Tiempo de servicio por cliente — real: promedio 11.7 min, mediana 9.2, P75 14.5 (1662 paradas medidas)
# Hora base del plan. Los camiones NO salen a las 7:00: la salida real del
# CEDIS promedia 10:16 (mediana 09:53) porque antes hay que cargar. Se usa
# 10:00 para que las ETAs del plan nazcan realistas; al dar "Salida" se
# recalculan igual desde la hora real (ver recalcular_etas_desde_salida).
HORA_CERO = datetime.strptime("10:00", "%H:%M")
MINUTOS_TURNO_MAXIMO = int(6.5 * 60)  # Jornada real repartiendo: promedio 6.7 h, mediana 6.4 h, P75 8.1 h. El despachador puede ampliarla por corrida desde el panel.
# Referencia operativa (no es restricción): paradas reales por camión al día
# = mediana 15, P75 20, máximo observado 38 (ese día fueron 12.9 h de jornada).
# El límite de turno + el tiempo de descarga ya acotan las paradas por ruta.
PARADAS_TIPICAS_POR_RUTA = 15
PESO_ESTIMADO_KG = 150  # Fallback SOLO cuando SAP no trae peso real de línea (ver sync.py)
INTERVALO_SALIDA_MINUTOS = 30  # No todos los camiones salen a la misma hora: salidas cada 30 min
CAPACIDAD_CAMION_KG_DEFAULT = 3000  # Ruta no guarda la capacidad real del camión asignado; ver api.py:CAPACIDADES_CAMION_KG

# Estados de Ruta que ya fueron despachados/en proceso físico: nunca se destruyen
# ni recalculan al re-optimizar, para no reasignarle a otro camión un pedido que
# ya se cargó o que ya salió a la calle.
ESTADOS_RUTA_CONGELADOS = ['Cargando', 'Listo', 'En_Ruta', 'Finalizada']


def _ventana_en_minutos(destino, minutos_turno=MINUTOS_TURNO_MAXIMO):
    """
    Convierte la ventana de recibo real del Ship-To (ini_recibo_1/fin_recibo_1)
    a minutos desde HORA_CERO, SIN recortar al turno del chofer. Si el destino
    no tiene ventana configurada en SAP, se usa todo el turno para no bloquear
    la ruta.

    Devuelve la ventana real (puede empezar después del turno máximo, ej. un
    cliente que recibe hasta la tarde) — quien la use para restricciones duras
    de OR-Tools debe recortarla con _ventana_recortada_a_turno().
    """
    if destino.ini_recibo_1 and destino.fin_recibo_1:
        ini = destino.ini_recibo_1
        fin = destino.fin_recibo_1
        ini_min = (ini.hour * 60 + ini.minute) - (HORA_CERO.hour * 60 + HORA_CERO.minute)
        fin_min = (fin.hour * 60 + fin.minute) - (HORA_CERO.hour * 60 + HORA_CERO.minute)
        ini_min = max(0, ini_min)
        fin_min = max(0, fin_min)
        if fin_min < ini_min:
            # Dato inconsistente capturado en SAP (hora fin antes que hora
            # inicio, ej. "08:00-06:00" — probablemente un cierre vespertino
            # mal capturado sin PM). No tiene sentido bloquear al cliente con
            # una ventana de 0 minutos por un dato corrupto: se ignora la
            # ventana y se usa el turno completo, igual que si no tuviera
            # ventana configurada en SAP.
            return (0, minutos_turno)
        return (ini_min, fin_min)
    return (0, minutos_turno)


def _ventana_recortada_a_turno(ini_min, fin_min, minutos_turno=MINUTOS_TURNO_MAXIMO):
    """
    Recorta una ventana real al turno máximo del chofer, para usarla como
    restricción dura de OR-Tools (que exige ini <= fin). Un cliente que abre
    su ventana después del turno máximo queda con una ventana de un solo
    minuto al final del turno: en la práctica, inalcanzable, y el solver lo
    deja fuera de esa ruta en vez de reventar con una ventana inválida.
    """
    ini_cap = min(ini_min, minutos_turno)
    fin_cap = max(ini_cap, min(fin_min, minutos_turno))
    return (ini_cap, fin_cap)


# ==========================================
# 2. CONSTRUCCIÓN DEL MODELO (MATRICES)
# ==========================================
def build_data_model(fecha, num_vehicles, vehicle_capacities, depot_coords, minutos_turno=MINUTOS_TURNO_MAXIMO):
    """
    Construye las matrices de distancia/tiempo (por calle real, evitando
    autopistas de cuota vía OSRM) y las demandas/ventanas horarias.

    Solo entran al modelo las remisiones Pendiente/Asignado que NO pertenezcan
    ya a una ruta despachada (congelada) — esas se dejan intactas y jamás se
    tocan aquí, para no reasignar pedidos que ya salieron físicamente.
    """
    remisiones = list(
        Remision.objects.filter(doc_date=fecha, estado__in=['Pendiente', 'Asignado'])
        .exclude(ruta__estado__in=ESTADOS_RUTA_CONGELADOS)
        .select_related('destino', 'ruta')
    )
    if not remisiones:
        return None

    # Varios documentos (remisiones) del mismo cliente el mismo día llegan al
    # mismo destino físico: el camión entra una sola vez. Se agrupan por
    # destino ANTES de armar el modelo VRP para que cada parada real sea un
    # solo nodo (con el peso sumado), en vez de contar cada documento como una
    # parada aparte y duplicar tiempo de descarga que en la calle no existe.
    grupos_por_destino = {}
    remisiones_sin_geo = []
    for r in remisiones:
        if r.destino and r.destino.latitude is not None and r.destino.longitude is not None:
            grupos_por_destino.setdefault(r.destino_id, []).append(r)
        else:
            # Nunca se asignan silenciosamente: se reportan para que el dispatcher
            # los vea y pueda resolverlos (geocodificar manualmente, etc.)
            remisiones_sin_geo.append(r)

    # Nodo 0 es el CEDIS
    locations = [depot_coords]
    demands = [0]
    time_windows = [(0, minutos_turno)]
    remisiones_validas = []  # una entrada por nodo: lista de remisiones de esa parada

    for remisiones_del_destino in grupos_por_destino.values():
        destino = remisiones_del_destino[0].destino
        locations.append((destino.latitude, destino.longitude))
        peso_parada = sum(
            (r.peso_kg if r.peso_kg else PESO_ESTIMADO_KG) for r in remisiones_del_destino
        )
        demands.append(int(peso_parada))
        time_windows.append(_ventana_recortada_a_turno(*_ventana_en_minutos(destino, minutos_turno), minutos_turno))
        remisiones_validas.append(remisiones_del_destino)

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
def solve_vrp(fecha, num_vehicles, vehicle_capacities, depot_coords, horas_turno=None):
    """
    Resuelve el problema de ruteo de vehículos usando OR-Tools (VRPTW) sobre
    distancias/tiempos reales de calle (OSRM, evitando autopistas de cuota).
    Nunca destruye rutas ya despachadas (Cargando/Listo/En_Ruta/Finalizada).

    `horas_turno`: duración del turno de cada chofer para ESTA corrida (default
    6h). El despachador puede ampliarlo (ej. 7h) cuando los pedidos del día no
    caben en las rutas con el turno normal — es una de las tres salidas junto
    con activar otro camión o asignar manualmente.
    """
    minutos_turno = int(horas_turno * 60) if horas_turno else MINUTOS_TURNO_MAXIMO
    # Los camiones ya despachados hoy (Cargando/Listo/En_Ruta/Finalizada) no
    # están disponibles para rutas NUEVAS: ya salieron con su propia carga. Si
    # no se restan aquí, el solver intenta crear una ruta nueva por cada
    # camión activo en el panel sin importar cuántos ya están ocupados, y al
    # guardarlas se queda sin códigos T-00X libres e inventa uno (T-006, etc.)
    # que no corresponde a ningún camión real de la flota.
    camiones_congelados = set(
        Ruta.objects.filter(fecha=fecha, estado__in=ESTADOS_RUTA_CONGELADOS).values_list('camion', flat=True)
    )
    num_vehicles = max(0, num_vehicles - len(camiones_congelados))
    vehicle_capacities = vehicle_capacities[:num_vehicles]
    if num_vehicles == 0:
        return {
            "status": "error",
            "message": "Todos los camiones activos ya están despachados hoy. Agrega otro camión o espera a que alguno termine su ruta.",
        }

    data = build_data_model(fecha, num_vehicles, vehicle_capacities, depot_coords, minutos_turno)
    if not data:
        return {"status": "error", "message": "No hay remisiones válidas para optimizar en esta fecha."}

    if data.get('sin_solucion'):
        return {
            "status": "error",
            "message": "Todos los pedidos pendientes carecen de coordenadas. Resuélvelos antes de optimizar.",
            "pedidos_sin_geo": [r.doc_num for r in data['remisiones_sin_geo']],
        }

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

    for location_idx, time_window in enumerate(data['time_windows']):
        if location_idx == data['depot']:
            continue
        index = manager.NodeToIndex(location_idx)
        time_dimension.CumulVar(index).SetRange(time_window[0], time_window[1])

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

    # Permitir que un nodo quede sin visitar (con penalización alta) en vez de que
    # el solver falle por completo si la capacidad/tiempo no alcanza para todos:
    # así garantizamos que SIEMPRE haya una solución, y los que queden fuera se
    # reportan explícitamente para resolverlos (más camiones, otra fecha, etc.)
    PENALIZACION_NODO_SIN_VISITAR = 10_000_000
    for node in range(1, len(data['time_matrix'])):
        index = manager.NodeToIndex(node)
        routing.AddDisjunction([index], PENALIZACION_NODO_SIN_VISITAR)

    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    # 20s (antes 5s): con 5s el guided local search a veces se quedaba corto
    # para exprimir mejoras de 2-opt en rutas largas (~1-3% de tiempo de
    # manejo) en días con muchos pedidos. Optimizar Rutas tarda más en
    # responder a cambio de rutas más ajustadas.
    search_parameters.time_limit.FromSeconds(20)

    solution = routing.SolveWithParameters(search_parameters)

    if not solution:
        return {"status": "error", "message": "El algoritmo no encontró ninguna solución. Revisa capacidades y ventanas de horario."}

    # ==========================================
    # 4. EXTRACCIÓN Y GUARDADO EN DB
    # ==========================================
    with transaction.atomic():
        # Solo se destruyen rutas 'Borrador' del día (aún no despachadas). Las
        # congeladas (Cargando/Listo/En_Ruta/Finalizada) quedan intactas.
        # (camiones_congelados ya se calculó arriba, antes de armar el modelo,
        # para descontarlos del num_vehicles disponible.)
        Ruta.objects.filter(fecha=fecha, estado='Borrador').delete()

        # remisiones_validas[i] es una LISTA de documentos que comparten parada
        # (mismo destino) — se recorren y actualizan todos juntos.
        remisiones_validas = data['remisiones_validas']
        nodos_visitados = set()
        rutas_generadas = []
        siguiente_num_camion = 1
        for vehicle_id in range(data['num_vehicles']):
            index = routing.Start(vehicle_id)
            route_sequence = []  # lista de paradas; cada parada es una lista de remisiones

            while not routing.IsEnd(index):
                time_var = time_dimension.CumulVar(index)
                minutos_desde_cero = solution.Min(time_var)

                node_index = manager.IndexToNode(index)
                if node_index != 0:
                    nodos_visitados.add(node_index)
                    remisiones_parada = remisiones_validas[node_index - 1]
                    eta_time = HORA_CERO + timedelta(minutes=minutos_desde_cero)
                    for remision in remisiones_parada:
                        remision.eta = eta_time.strftime("%I:%M %p")
                    route_sequence.append(remisiones_parada)

                index = solution.Value(routing.NextVar(index))

            if route_sequence:
                # Asignar el siguiente código de camión libre (T-00X) que no esté
                # ya usado por una ruta congelada de este mismo día.
                while f"T-00{siguiente_num_camion}" in camiones_congelados:
                    siguiente_num_camion += 1
                camion_code = f"T-00{siguiente_num_camion}"
                siguiente_num_camion += 1

                ruta_obj = Ruta.objects.create(
                    fecha=fecha,
                    camion=camion_code,
                    chofer=f"Chofer {camion_code[-1]}",
                    estado='Borrador'
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
        if remisiones_no_asignadas:
            Remision.objects.bulk_update(remisiones_no_asignadas, ['estado', 'ruta'])

        pedidos_no_asignados = [r.doc_num for r in remisiones_no_asignadas]
        pedidos_sin_geo = [r.doc_num for r in data['remisiones_sin_geo']]

        mensajes_fuente = {
            "osrm_sin_casetas": "Rutas generadas con distancias reales de calle, evitando autopistas de cuota.",
            "osrm": "Rutas generadas con distancias reales de calle. El servidor de ruteo no soportó evitar casetas en esta corrida.",
            "haversine": "OSRM no respondió: rutas generadas en línea recta, sin garantía de evitar casetas.",
        }
        message = mensajes_fuente[data['fuente_matriz']]
        if pedidos_no_asignados:
            message += f" {len(pedidos_no_asignados)} pedido(s) no cupieron en ninguna ruta: {pedidos_no_asignados}."
        if pedidos_sin_geo:
            message += f" {len(pedidos_sin_geo)} pedido(s) sin coordenadas, no considerados: {pedidos_sin_geo}."

        return {
            "status": "success",
            "message": message,
            "rutas": rutas_generadas,
            "pedidos_no_asignados": pedidos_no_asignados,
            "pedidos_sin_geo": pedidos_sin_geo,
        }


def recalcular_etas_desde_salida(ruta, depot_coords, salida_dt=None):
    """
    Recalcula las ETAs de una ruta a partir de la hora REAL de salida (cuando
    el despachador presiona "Salida"), no la hora teórica del plan.

    Motivo: el optimizador puede correr a las 8:00 pero la carga del camión
    termina a las 10:00 — sin esto, todas las ETAs prometidas quedan ~2 horas
    adelantadas respecto a la realidad. Se recorre la secuencia real de la
    ruta (CEDIS → paradas en orden) con tiempos de OSRM + descarga.

    Regresa cuántos pedidos se actualizaron.
    """
    remisiones = [
        r for r in ruta.remisiones.filter(destino__isnull=False)
        .select_related('destino').order_by('secuencia_ruta')
        if r.destino.latitude is not None and r.destino.longitude is not None
    ]
    if not remisiones:
        return 0
    salida_dt = salida_dt or datetime.now()

    # Paradas únicas en orden: documentos consecutivos del mismo destino
    # comparten parada (el camión entra una sola vez).
    paradas = []
    for r in remisiones:
        if paradas and paradas[-1][0] == r.destino_id:
            paradas[-1][1].append(r)
        else:
            paradas.append((r.destino_id, [r], (r.destino.latitude, r.destino.longitude)))

    locations = [depot_coords] + [p[2] for p in paradas]
    _, time_matrix, _ = build_distance_time_matrices(locations, VELOCIDAD_PROMEDIO_KMH)

    t = salida_dt
    actualizadas = []
    for i, (_, rems, _) in enumerate(paradas):
        t += timedelta(minutes=time_matrix[i][i + 1])
        for r in rems:
            r.eta = t.strftime("%I:%M %p")
            actualizadas.append(r)
        t += timedelta(minutes=TIEMPO_DESCARGA_MINUTOS)
    Remision.objects.bulk_update(actualizadas, ['eta'])
    return len(actualizadas)


# ==========================================
# 4. ASIGNACIÓN MANUAL DE UN PEDIDO SUELTO
# ==========================================
def sugerir_camiones_para_remision(remision, depot_coords):
    """
    Para un pedido que el optimizador dejó sin asignar, calcula en qué punto de
    cada ruta del día (que no esté ya despachada/congelada) conviene más
    insertarlo — el de menor tiempo agregado ("cheapest insertion") — y si
    cabe en tiempo (turno) y peso, o si se pasaría de alguno.

    No modifica nada en la BD: solo calcula y regresa las opciones para que el
    despachador decida. Siempre regresa las 5 rutas evaluadas, incluso las que
    no caben, marcadas con el motivo, para que el despachador pueda forzar la
    asignación de todos modos si así lo decide (ej. cliente urgente).
    """
    destino = remision.destino
    if not destino or destino.latitude is None or destino.longitude is None:
        return {"error": "Este pedido no tiene coordenadas; no se puede sugerir un camión."}

    rutas = list(
        Ruta.objects.filter(fecha=remision.doc_date)
        .exclude(estado__in=['En_Ruta', 'Finalizada'])
        .prefetch_related('remisiones__destino')
    )
    if not rutas:
        return {"error": "No hay rutas generadas todavía para este día. Corre el optimizador primero."}

    peso_pedido = remision.peso_kg if remision.peso_kg else PESO_ESTIMADO_KG

    opciones = []
    for ruta in rutas:
        remisiones_ruta = sorted(
            [r for r in ruta.remisiones.all() if r.destino and r.destino.latitude is not None],
            key=lambda r: r.secuencia_ruta or 0,
        )

        # Puntos de la ruta actual: CEDIS -> paradas existentes -> CEDIS
        puntos = [depot_coords] + [(r.destino.latitude, r.destino.longitude) for r in remisiones_ruta] + [depot_coords]
        locations_con_nuevo = puntos + [(destino.latitude, destino.longitude)]
        idx_nuevo = len(puntos)  # último índice = el pedido a insertar

        distance_matrix, time_matrix, _ = build_distance_time_matrices(locations_con_nuevo, VELOCIDAD_PROMEDIO_KMH)

        # Probar insertar el nuevo punto entre cada par consecutivo de la ruta
        # actual (incluye antes de la primera parada y después de la última) y
        # quedarse con la posición que agrega menos tiempo.
        mejor_costo = None
        mejor_posicion = None
        for i in range(len(puntos) - 1):
            costo_actual = time_matrix[i][i + 1]
            costo_con_insercion = (
                time_matrix[i][idx_nuevo] + TIEMPO_DESCARGA_MINUTOS + time_matrix[idx_nuevo][i + 1]
            )
            minutos_agregados = costo_con_insercion - costo_actual
            if mejor_costo is None or minutos_agregados < mejor_costo:
                mejor_costo = minutos_agregados
                mejor_posicion = i  # se inserta después de la parada i (0 = después del CEDIS)

        peso_actual = sum((r.peso_kg if r.peso_kg else PESO_ESTIMADO_KG) for r in remisiones_ruta)
        capacidad = CAPACIDAD_CAMION_KG_DEFAULT

        # Tiempo total de la ruta si se agrega este pedido, contra el turno de
        # 6h del camión (aproximado: se asume que ya venía ajustada al turno).
        duracion_actual = sum(time_matrix[i][i + 1] for i in range(len(puntos) - 1))
        duracion_con_insercion = duracion_actual + mejor_costo

        motivos = []
        cabe_tiempo = duracion_con_insercion <= MINUTOS_TURNO_MAXIMO
        if not cabe_tiempo:
            motivos.append(
                f"se pasaría del turno de {MINUTOS_TURNO_MAXIMO // 60}h "
                f"(quedaría en {int(duracion_con_insercion)} min)"
            )

        cabe_peso = (peso_actual + peso_pedido) <= capacidad
        if not cabe_peso:
            motivos.append(f"se pasaría del peso máximo del camión ({capacidad} kg)")

        # Choque de ventana de horario del propio destino nuevo.
        ini_ventana, fin_ventana = _ventana_en_minutos(destino)
        minutos_llegada_estimados = sum(time_matrix[i][i + 1] for i in range(mejor_posicion + 1)) if mejor_posicion is not None else 0
        choca_ventana = not (ini_ventana <= minutos_llegada_estimados <= fin_ventana)
        if choca_ventana:
            hora_ini = (HORA_CERO + timedelta(minutes=ini_ventana)).strftime("%I:%M %p")
            hora_fin = (HORA_CERO + timedelta(minutes=fin_ventana)).strftime("%I:%M %p")
            motivos.append(f"llegaría fuera de la ventana de recibo del cliente ({hora_ini} - {hora_fin})")

        eta_estimada = (HORA_CERO + timedelta(minutes=minutos_llegada_estimados)).strftime("%I:%M %p")

        opciones.append({
            "ruta_id": ruta.id,
            "camion": ruta.camion,
            "chofer": ruta.chofer,
            "estado_ruta": ruta.estado,
            "factible": cabe_tiempo and cabe_peso and not choca_ventana,
            "minutos_agregados": int(mejor_costo) if mejor_costo is not None else None,
            "eta_estimada": eta_estimada,
            "posicion_sugerida": mejor_posicion + 1 if mejor_posicion is not None else None,
            "motivos_riesgo": motivos,  # vacío si cabe perfecto; si no, se puede forzar de todos modos
        })

    opciones.sort(key=lambda o: (not o["factible"], o["minutos_agregados"] if o["minutos_agregados"] is not None else 9999))
    return {"pedido": remision.doc_num, "cliente": remision.card_name, "opciones": opciones}


@transaction.atomic
def asignar_manualmente(remision, ruta_id, posicion=None, forzar=False):
    """
    Mete un pedido a una ruta específica a mano, en la posición sugerida (o al
    final si no se da). Si hay riesgo (fuera de turno/peso/ventana) y no se
    pasa forzar=True, rechaza la asignación explicando por qué — el
    despachador debe confirmar explícitamente que quiere forzarla.
    """
    try:
        ruta = Ruta.objects.get(id=ruta_id)
    except Ruta.DoesNotExist:
        return {"status": "error", "message": "Esa ruta ya no existe."}

    if ruta.estado in ['En_Ruta', 'Finalizada']:
        return {"status": "error", "message": "Ese camión ya salió a la calle o terminó su ruta, no se le puede agregar nada."}

    if not forzar:
        depot = (25.693214524592616, -100.48167993202988)
        sugerencias = sugerir_camiones_para_remision(remision, depot)
        opcion = next((o for o in sugerencias.get("opciones", []) if o["ruta_id"] == ruta_id), None)
        if opcion and not opcion["factible"]:
            return {
                "status": "requiere_confirmacion",
                "message": "Este pedido no cabe limpio en esta ruta: " + "; ".join(opcion["motivos_riesgo"]),
                "motivos_riesgo": opcion["motivos_riesgo"],
            }

    remisiones_ruta = list(ruta.remisiones.order_by('secuencia_ruta'))
    if posicion is None or posicion > len(remisiones_ruta):
        posicion = len(remisiones_ruta) + 1

    # Recorrer secuencia para abrir espacio en la posición indicada
    for r in remisiones_ruta:
        if r.secuencia_ruta >= posicion:
            r.secuencia_ruta += 1
    Remision.objects.bulk_update(remisiones_ruta, ['secuencia_ruta'])

    remision.ruta = ruta
    remision.secuencia_ruta = posicion
    remision.estado = 'Asignado'
    remision.save()

    return {"status": "success", "message": f"Pedido #{remision.doc_num} asignado a {ruta.camion} en la posición {posicion}."}
