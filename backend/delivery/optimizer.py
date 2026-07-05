import math
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
from .models import Ruta, Remision, Destino

# Fórmula de Haversine para calcular distancias entre coordenadas en KM
def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371.0 # Radio de la Tierra en KM
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

def solve_vrp(fecha, num_vehicles, vehicle_capacities, depot_coords):
    """
    Resuelve el problema de ruteo de vehículos usando OR-Tools.
    Asigna las remisiones a camiones de forma óptima.
    """
    # 1. Obtener las remisiones activas para la fecha
    remisiones = list(Remision.objects.filter(doc_date=fecha, estado__in=['Pendiente', 'Asignado']).select_related('destino'))
    if not remisiones:
        return {"status": "error", "message": "No hay remisiones pendientes para optimizar en esta fecha."}

    # 2. Construir la lista de ubicaciones (Punto 0 es el CEDIS)
    locations = [depot_coords]
    demands = [0] # CEDIS no tiene demanda
    
    # Mapeo de remisiones a sus destinos
    remisiones_validas = []
    for r in remisiones:
        if r.destino and r.destino.latitude is not None and r.destino.longitude is not None:
            locations.append((r.destino.latitude, r.destino.longitude)) # (lat, lng)
            # Demanda en KG. Si no tiene peso, asumimos un valor por defecto
            demands.append(int(r.doc_total / 100) if r.doc_total > 0 else 50)
            remisiones_validas.append(r)
        
    if len(locations) <= 1:
        return {"status": "error", "message": "No hay destinos válidos con coordenadas geográficas."}

    # 3. Crear matriz de distancias (en metros)
    num_locations = len(locations)
    distance_matrix = []
    for i in range(num_locations):
        row = []
        for j in range(num_locations):
            dist_km = haversine_distance(locations[i][0], locations[i][1], locations[j][0], locations[j][1])
            row.append(int(dist_km * 1000)) # Metros
        distance_matrix.append(row)

    # 4. Configurar el Administrador del Enrutamiento
    manager = pywrapcp.RoutingIndexManager(num_locations, num_vehicles, 0)
    routing = pywrapcp.RoutingModel(manager)

    # Callback de distancia
    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return distance_matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # Callback de demanda de capacidad (peso)
    def demand_callback(from_index):
        from_node = manager.IndexToNode(from_index)
        return demands[from_node]

    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimensionWithVehicleCapacity(
        demand_callback_index,
        0,  # null capacity slack
        vehicle_capacities,  # vehicle maximum capacities
        True,  # start cumul to zero
        "Capacity"
    )

    # 5. Configurar Parámetros de Búsqueda
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )

    # Resolver
    solution = routing.SolveWithParameters(search_parameters)

    if not solution:
        return {"status": "error", "message": "No se pudo encontrar una solución óptima para las rutas."}

    # 6. Guardar Resultados en la Base de Datos
    # Limpiar rutas previas para ese día
    Ruta.objects.filter(fecha=fecha).delete()

    rutas_generadas = []
    for vehicle_id in range(num_vehicles):
        index = routing.Start(vehicle_id)
        route_sequence = []
        
        while not routing.IsEnd(index):
            node_index = manager.IndexToNode(index)
            if node_index != 0:
                remision = remisiones_validas[node_index - 1]
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
            
            # Asignar remisiones a la ruta
            for seq, remision in enumerate(route_sequence):
                remision.ruta = ruta_obj
                remision.secuencia_ruta = seq + 1
                remision.estado = 'Asignado'
                remision.save()
                
            rutas_generadas.append({
                "ruta_id": ruta_obj.id,
                "camion": ruta_obj.camion,
                "pedidos": len(route_sequence)
            })

    return {
        "status": "success",
        "message": f"Rutas generadas exitosamente para {fecha}.",
        "rutas": rutas_generadas
    }
