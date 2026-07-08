"""
Cliente OSRM compartido por el optimizador (matriz de distancia/tiempo) y por
cualquier geocodificación de respaldo. Centralizado aquí para no duplicar la
URL del servidor OSRM ni el parámetro de exclusión de autopistas entre archivos.
"""
import math
import requests

OSRM_BASE = "https://router.project-osrm.org"
# El servidor demo de OSRM no tiene datos de costo de peaje, pero excluir "motorway"
# evita en la práctica la gran mayoría de casetas de cuota en México, que corren
# sobre autopistas de cuota clasificadas como motorway en OpenStreetMap.
OSRM_EXCLUDE = "motorway"
REQUEST_TIMEOUT = 8


def haversine_distance(lat1, lon1, lat2, lon2):
    """Distancia en KM entre dos coordenadas (línea recta). Solo se usa como
    último respaldo si OSRM no responde."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return R * c


def osrm_table(locations):
    """
    Pide a OSRM la matriz real de distancias (metros) y tiempos (segundos) entre
    todos los puntos, evitando autopistas de cuota. `locations` es una lista de
    (lat, lng). Regresa (distance_matrix_m, duration_matrix_s) o None si falla.
    """
    coords_str = ";".join(f"{lng},{lat}" for lat, lng in locations)
    url = f"{OSRM_BASE}/table/v1/driving/{coords_str}"
    params = {"annotations": "distance,duration", "exclude": OSRM_EXCLUDE}
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok":
            return None
        return data["distances"], data["durations"]
    except (requests.RequestException, KeyError, ValueError):
        return None


def build_distance_time_matrices(locations, velocidad_kmh_fallback):
    """
    Intenta construir las matrices con OSRM (calles reales, sin autopistas de
    cuota). Si el servicio no responde, cae a Haversine en línea recta para no
    tronar el optimizador, pero el resultado ya no evita casetas en ese caso.
    """
    osrm_result = osrm_table(locations)
    if osrm_result:
        distances_m, durations_s = osrm_result
        distance_matrix = [[int(d) for d in row] for row in distances_m]
        time_matrix_min = [[int(d / 60) for d in row] for row in durations_s]
        return distance_matrix, time_matrix_min, True

    n = len(locations)
    distance_matrix = [[0] * n for _ in range(n)]
    time_matrix_min = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            dist_km = haversine_distance(locations[i][0], locations[i][1], locations[j][0], locations[j][1])
            distance_matrix[i][j] = int(dist_km * 1000)
            time_matrix_min[i][j] = int((dist_km / velocidad_kmh_fallback) * 60)
    return distance_matrix, time_matrix_min, False


def geocode_address(street, city, state="Nuevo Leon", country="Mexico"):
    """
    Geocodifica una dirección de texto contra Nominatim (OpenStreetMap) como
    último respaldo cuando SAP no trae lat/lng. Es un servicio gratuito con
    límite de uso justo (1 req/seg) — solo se llama para pedidos sin coordenada.
    Regresa (lat, lng) o None si no se pudo geocodificar.
    """
    if not street:
        return None
    query = ", ".join(p for p in [street, city, state, country] if p)
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "json", "limit": 1},
            headers={"User-Agent": "LabenDispatcher/1.0"},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json()
        if not results:
            return None
        return float(results[0]["lat"]), float(results[0]["lon"])
    except (requests.RequestException, KeyError, ValueError, IndexError):
        return None
