from datetime import datetime, timedelta
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
from django.db import transaction
from .models import Ruta, Remision, Destino
from .routing_service import build_distance_time_matrices

# ==========================================
# 1. CONSTANTES DE TIEMPO Y CONFIGURACIÓN
# ==========================================
VELOCIDAD_PROMEDIO_KMH = 30.0  # Solo se usa si OSRM no responde (respaldo Haversine)
TIEMPO_DESCARGA_MINUTOS = 15   # Tiempo de servicio por cliente
HORA_CERO = datetime.strptime("07:00", "%H:%M") # Hora a la que arranca el CEDIS
MINUTOS_TURNO_MAXIMO = 8 * 60  # Límite de 8 horas por turno de chofer
PESO_ESTIMADO_KG = 150  # Fallback SOLO cuando SAP no trae peso real de línea (ver sync.py)

# Estados de Ruta que ya fueron despachados/en proceso físico: nunca se destruyen
# ni recalculan al re-optimizar, para no reasignarle a otro camión un pedido que
# ya se cargó o que ya salió a la calle.
ESTADOS_RUTA_CONGELADOS = ['Cargando', 'Listo', 'En_Ruta', 'Finalizada']


def _ventana_en_minutos(destino):
    """
    Convierte la ventana de recibo real del Ship-To (ini_recibo_1/fin_recibo_1)
    a minutos desde HORA_CERO. Si el destino no tiene ventana configurada en SAP,
    se usa todo el turno para no bloquear la ruta.
    """
    if destino.ini_recibo_1 and destino.fin_recibo_1:
        ini = destino.ini_recibo_1
        fin = destino.fin_recibo_1
        ini_min = (ini.hour * 60 + ini.minute) - (HORA_CERO.hour * 60 + HORA_CERO.minute)
        fin_min = (fin.hour * 60 + fin.minute) - (HORA_CERO.hour * 60 + HORA_CERO.minute)
        ini_min = max(0, ini_min)
        fin_min = max(ini_min, min(fin_min, MINUTOS_TURNO_MAXIMO))
        return (ini_min, fin_min)
    return (0, MINUTOS_TURNO_MAXIMO)


# ==========================================
# 2. CONSTRUCCIÓN DEL MODELO (MATRICES)
# ==========================================
def build_data_model(fecha, num_vehicles, vehicle_capacities, depot_coords):
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

    # Nodo 0 es el CEDIS
    locations = [depot_coords]
    demands = [0]
    time_windows = [(0, MINUTOS_TURNO_MAXIMO)]
    remisiones_validas = []
    remisiones_sin_geo = []

    for r in remisiones:
        if r.destino and r.destino.latitude is not None and r.destino.longitude is not None:
            locations.append((r.destino.latitude, r.destino.longitude))
            demands.append(int(r.peso_kg) if r.peso_kg else PESO_ESTIMADO_KG)
            time_windows.append(_ventana_en_minutos(r.destino))
            remisiones_validas.append(r)
        else:
            # Nunca se asignan silenciosamente: se reportan para que el dispatcher
            # los vea y pueda resolverlos (geocodificar manualmente, etc.)
            remisiones_sin_geo.append(r)

    if len(locations) <= 1:
        return {'sin_solucion': True, 'remisiones_sin_geo': remisiones_sin_geo}

    distance_matrix, time_matrix, fuente_matriz = build_distance_time_matrices(locations, VELOCIDAD_PROMEDIO_KMH)

    # Sumar tiempo de descarga a cada columna destino (excepto el regreso al CEDIS)
    for i in range(len(time_matrix)):
        for j in range(len(time_matrix[i])):
            if j != 0:
                time_matrix[i][j] += TIEMPO_DESCARGA_MINUTOS

    vehicle_starts = [0 for _ in range(num_vehicles)]

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
def solve_vrp(fecha, num_vehicles, vehicle_capacities, depot_coords):
    """
    Resuelve el problema de ruteo de vehículos usando OR-Tools (VRPTW) sobre
    distancias/tiempos reales de calle (OSRM, evitando autopistas de cuota).
    Nunca destruye rutas ya despachadas (Cargando/Listo/En_Ruta/Finalizada).
    """
    data = build_data_model(fecha, num_vehicles, vehicle_capacities, depot_coords)
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

    time_dimension_name = 'Time'
    routing.AddDimension(
        transit_callback_index,
        30,  # espera máxima si llega temprano
        data['time_windows'][0][1],
        False,
        time_dimension_name)

    time_dimension = routing.GetDimensionOrDie(time_dimension_name)

    for location_idx, time_window in enumerate(data['time_windows']):
        if location_idx == data['depot']:
            continue
        index = manager.NodeToIndex(location_idx)
        time_dimension.CumulVar(index).SetRange(time_window[0], time_window[1])

    for vehicle_id in range(data['num_vehicles']):
        index = routing.Start(vehicle_id)
        start_min = data['vehicle_starts'][vehicle_id]
        time_dimension.CumulVar(index).SetRange(start_min, start_min)

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
    search_parameters.time_limit.FromSeconds(5)

    solution = routing.SolveWithParameters(search_parameters)

    if not solution:
        return {"status": "error", "message": "El algoritmo no encontró ninguna solución. Revisa capacidades y ventanas de horario."}

    # ==========================================
    # 4. EXTRACCIÓN Y GUARDADO EN DB
    # ==========================================
    with transaction.atomic():
        # Solo se destruyen rutas 'Borrador' del día (aún no despachadas). Las
        # congeladas (Cargando/Listo/En_Ruta/Finalizada) quedan intactas.
        camiones_congelados = set(
            Ruta.objects.filter(fecha=fecha, estado__in=ESTADOS_RUTA_CONGELADOS).values_list('camion', flat=True)
        )

        Ruta.objects.filter(fecha=fecha, estado='Borrador').delete()

        remisiones_validas = data['remisiones_validas']
        nodos_visitados = set()
        rutas_generadas = []
        siguiente_num_camion = 1
        for vehicle_id in range(data['num_vehicles']):
            index = routing.Start(vehicle_id)
            route_sequence = []

            while not routing.IsEnd(index):
                time_var = time_dimension.CumulVar(index)
                minutos_desde_cero = solution.Min(time_var)

                node_index = manager.IndexToNode(index)
                if node_index != 0:
                    nodos_visitados.add(node_index)
                    remision = remisiones_validas[node_index - 1]
                    eta_time = HORA_CERO + timedelta(minutes=minutos_desde_cero)
                    remision.eta = eta_time.strftime("%I:%M %p")
                    route_sequence.append(remision)

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
                for seq, remision in enumerate(route_sequence):
                    remision.ruta = ruta_obj
                    remision.secuencia_ruta = seq + 1
                    remision.estado = 'Asignado'
                    remisiones_to_update.append(remision)

                Remision.objects.bulk_update(remisiones_to_update, ['ruta', 'secuencia_ruta', 'estado', 'eta'])

                rutas_generadas.append({
                    "ruta_id": ruta_obj.id,
                    "camion": ruta_obj.camion,
                    "pedidos": len(route_sequence)
                })

        # Pedidos que el solver no pudo colocar en ninguna ruta (capacidad/tiempo
        # insuficientes) + los que no tenían coordenadas: se reportan, nunca se
        # pierden silenciosamente.
        pedidos_no_asignados = [
            remisiones_validas[i - 1].doc_num
            for i in range(1, len(remisiones_validas) + 1)
            if i not in nodos_visitados
        ]
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


# ==========================================
# 1. CONSTANTES DE TIEMPO Y CONFIGURACIÓN
# ==========================================
VELOCIDAD_PROMEDIO_KMH = 30.0  # Velocidad conservadora en ciudad (tráfico)
TIEMPO_DESCARGA_MINUTOS = 15   # Tiempo de servicio por cliente
HORA_CERO = datetime.strptime("07:00", "%H:%M") # Hora a la que arranca el CEDIS
MINUTOS_TURNO_MAXIMO = 8 * 60  # Límite de 8 horas por turno de chofer

# ==========================================
# 2. FUNCIONES MATEMÁTICAS AUXILIARES
# ==========================================
def haversine_distance(lat1, lon1, lat2, lon2):
    """Calcula la distancia en KM entre dos coordenadas usando la fórmula de Haversine."""
    R = 6371.0 # Radio de la Tierra en KM
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

def distance_to_minutes(dist_km):
    """Convierte kilómetros a minutos asumiendo una velocidad promedio."""
    return int((dist_km / VELOCIDAD_PROMEDIO_KMH) * 60)

# ==========================================
# 3. CONSTRUCCIÓN DEL MODELO (MATRICES)
# ==========================================
def build_data_model(fecha, num_vehicles, vehicle_capacities, depot_coords):
    """Construye las matrices de distancia, tiempo, demandas y ventanas horarias."""
    remisiones = list(Remision.objects.filter(doc_date=fecha, estado__in=['Pendiente', 'Asignado']).select_related('destino'))
    if not remisiones:
        return None

    # Nodo 0 es el CEDIS
    locations = [depot_coords]
    demands = [0]
    time_windows = [(0, MINUTOS_TURNO_MAXIMO)] # El CEDIS está abierto todo el turno
    remisiones_validas = []

    for r in remisiones:
        if r.destino and r.destino.latitude is not None and r.destino.longitude is not None:
            locations.append((r.destino.latitude, r.destino.longitude))
            demands.append(150) # 150 KG fijos por ahora
            
            # TODO: Leer ventanas reales de r.destino.ini_recibo_1 cuando estén en la BD.
            # Por ahora asignamos una ventana muy amplia (todo el turno).
            time_windows.append((0, MINUTOS_TURNO_MAXIMO))
            remisiones_validas.append(r)
        
    if len(locations) <= 1:
        return None

    num_locations = len(locations)
    distance_matrix = []
    time_matrix = []

    for i in range(num_locations):
        dist_row = []
        time_row = []
        for j in range(num_locations):
            dist_km = haversine_distance(locations[i][0], locations[i][1], locations[j][0], locations[j][1])
            dist_row.append(int(dist_km * 1000)) # Metros
            
            # El tiempo de viaje es: (tiempo de manejo) + (tiempo de descarga en el destino J)
            # No hay tiempo de descarga si regresamos al CEDIS (j == 0)
            tiempo_manejo = distance_to_minutes(dist_km)
            tiempo_total = tiempo_manejo + (TIEMPO_DESCARGA_MINUTOS if j != 0 else 0)
            time_row.append(tiempo_total)
            
        distance_matrix.append(dist_row)
        time_matrix.append(time_row)

    # Iniciar todos los camiones en tiempo 0 (la salida real será dinámica)
    vehicle_starts = [0 for i in range(num_vehicles)]

    return {
        'distance_matrix': distance_matrix,
        'time_matrix': time_matrix,
        'time_windows': time_windows,
        'demands': demands,
        'vehicle_capacities': vehicle_capacities,
        'num_vehicles': num_vehicles,
        'vehicle_starts': vehicle_starts,
        'depot': 0,
        'remisiones_validas': remisiones_validas
    }

# ==========================================
# 4. SOLUCIONADOR PRINCIPAL (OR-TOOLS)
# ==========================================
def solve_vrp(fecha, num_vehicles, vehicle_capacities, depot_coords):
    """
    Resuelve el problema de ruteo de vehículos usando OR-Tools (VRPTW).
    Incluye ventanas de tiempo, tiempo de servicio y salidas escalonadas.
    """
    data = build_data_model(fecha, num_vehicles, vehicle_capacities, depot_coords)
    if not data:
        return {"status": "error", "message": "No hay remisiones válidas para optimizar en esta fecha."}

    manager = pywrapcp.RoutingIndexManager(len(data['time_matrix']), data['num_vehicles'], data['depot'])
    routing = pywrapcp.RoutingModel(manager)

    # 4.1 Función de Tiempo
    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return data['time_matrix'][from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(time_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index) # Minimizar TIEMPO en lugar de distancia

    # 4.2 Dimensión de Tiempo (VRPTW)
    time_dimension_name = 'Time'
    routing.AddDimension(
        transit_callback_index,
        30, # Allow waiting time at nodes (slack) de hasta 30 minutos si llega temprano
        data['time_windows'][0][1], # Maximum time per vehicle (Límite de turno)
        False,  # Don't force start cumul to zero (vamos a forzar la salida escalonada abajo)
        time_dimension_name)
    
    time_dimension = routing.GetDimensionOrDie(time_dimension_name)
    
    # 4.3 Agregar Ventanas de Tiempo por cada nodo
    for location_idx, time_window in enumerate(data['time_windows']):
        if location_idx == data['depot']:
            continue
        index = manager.NodeToIndex(location_idx)
        time_dimension.CumulVar(index).SetRange(time_window[0], time_window[1])
        
    # 4.4 Forzar salidas escalonadas de los camiones (7:00, 7:30, 8:00...)
    for vehicle_id in range(data['num_vehicles']):
        index = routing.Start(vehicle_id)
        start_min = data['vehicle_starts'][vehicle_id]
        time_dimension.CumulVar(index).SetRange(start_min, start_min)

    # 4.5 Función de Capacidad (KG)
    def demand_callback(from_index):
        from_node = manager.IndexToNode(from_index)
        return data['demands'][from_node]

    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimensionWithVehicleCapacity(
        demand_callback_index,
        0,  # null capacity slack
        data['vehicle_capacities'],  # vehicle maximum capacities
        True,  # start cumul to zero
        "Capacity"
    )

    # 4.6 Parámetros de Búsqueda (Metaheurísticas)
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search_parameters.time_limit.FromSeconds(3) # Damos 3 segundos para explorar soluciones complejas

    # Resolver
    solution = routing.SolveWithParameters(search_parameters)

    if not solution:
        return {"status": "error", "message": "El algoritmo no encontró una solución. Revisa las restricciones de tiempo y peso."}

    # ==========================================
    # 5. EXTRACCIÓN Y GUARDADO EN DB
    # ==========================================
    with transaction.atomic():
        Ruta.objects.filter(fecha=fecha).delete()
        remisiones_validas = data['remisiones_validas']
        
        rutas_generadas = []
        for vehicle_id in range(data['num_vehicles']):
            index = routing.Start(vehicle_id)
            route_sequence = []
            
            # Recorrer los nodos de la ruta asignada al camión
            while not routing.IsEnd(index):
                time_var = time_dimension.CumulVar(index)
                minutos_desde_cero = solution.Min(time_var) # Obtener el tiempo calculado de llegada
                
                node_index = manager.IndexToNode(index)
                if node_index != 0:
                    remision = remisiones_validas[node_index - 1]
                    # Calcular hora de llegada real (ETA) sumando minutos a las 07:00 AM
                    eta_time = HORA_CERO + timedelta(minutes=minutos_desde_cero)
                    remision.eta = eta_time.strftime("%I:%M %p")
                    route_sequence.append(remision)
                    
                index = solution.Value(routing.NextVar(index))

            if route_sequence:
                # Crear la Ruta en la BD
                ruta_obj = Ruta.objects.create(
                    fecha=fecha,
                    camion=f"T-00{vehicle_id + 1}",
                    chofer=f"Chofer {vehicle_id + 1}",
                    estado='Borrador'
                )
                
                # Asignar remisiones a la ruta en bloque
                remisiones_to_update = []
                for seq, remision in enumerate(route_sequence):
                    remision.ruta = ruta_obj
                    remision.secuencia_ruta = seq + 1
                    remision.estado = 'Asignado'
                    remisiones_to_update.append(remision)
                    
                Remision.objects.bulk_update(remisiones_to_update, ['ruta', 'secuencia_ruta', 'estado', 'eta'])
                    
                rutas_generadas.append({
                    "ruta_id": ruta_obj.id,
                    "camion": ruta_obj.camion,
                    "pedidos": len(route_sequence)
                })

        return {
            "status": "success",
            "message": f"Rutas generadas exitosamente con control de tiempos.",
            "rutas": rutas_generadas
        }
