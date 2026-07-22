"""
Cliente OSRM compartido por el optimizador (matriz de distancia/tiempo) y por
cualquier geocodificación de respaldo. Centralizado aquí para no duplicar la
URL del servidor OSRM ni el parámetro de exclusión de autopistas entre archivos.
"""
import math
import os
import requests

# Por default usa el servidor público (bueno para desarrollo/pruebas chicas),
# pero se puede apuntar a un OSRM propio (Docker) poniendo OSRM_BASE en el .env
# — ver docker/README.md. El propio quita el límite de 100 paradas y puede
# evitar casetas de verdad.
OSRM_BASE = os.getenv("OSRM_BASE", "https://router.project-osrm.org").rstrip("/")
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
    todos los puntos. `locations` es una lista de (lat, lng).

    Regresa ((distances, durations, evito_casetas), None) si funcionó, o
    (None, motivo) si no — donde `motivo` distingue POR QUÉ falló, porque las
    dos causas se arreglan de forma distinta:

    - "demasiadas_paradas": el servidor respondió `TooBig`. El público demo
      acepta máximo 100 coordenadas por consulta, así que un día con muchas
      paradas se cae al respaldo de línea recta. Se quita apuntando a un OSRM
      propio (OSRM_BASE en el .env, ver docker/README.md).
    - "sin_respuesta": timeout, red caída o error inesperado.

    NOTA IMPORTANTE: el servidor público de demostración de OSRM
    (router.project-osrm.org) usa el perfil de coche por defecto, que NO tiene
    configuradas clases excluibles — pedirle `exclude=motorway` responde
    "Exclude flag combination is not supported" (400). Es decir, con este
    servidor gratuito NO se puede evitar autopistas/casetas de forma real.
    Se intenta primero con la exclusión (funcionaría si algún día se apunta a
    un servidor OSRM propio con un perfil que sí defina esa clase excluible) y,
    si el servidor la rechaza, se reintenta sin excluir nada — mejor calles
    reales sin evitar casetas que no tener ninguna respuesta.
    """
    coords_str = ";".join(f"{lng},{lat}" for lat, lng in locations)
    url = f"{OSRM_BASE}/table/v1/driving/{coords_str}"
    motivo = "sin_respuesta"
    for params, evito_casetas in (
        ({"annotations": "distance,duration", "exclude": OSRM_EXCLUDE}, True),
        ({"annotations": "distance,duration"}, False),
    ):
        try:
            resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
            data = resp.json()
            if data.get("code") == "Ok":
                return (data["distances"], data["durations"], evito_casetas), None
            # OSRM sí contestó pero rechazó la petición (un 400 no levanta
            # excepción en requests, así que hay que mirar el `code` del cuerpo).
            if data.get("code") == "TooBig":
                motivo = "demasiadas_paradas"
        except (requests.RequestException, KeyError, ValueError):
            continue
    return None, motivo


def build_distance_time_matrices(locations, velocidad_kmh_fallback):
    """
    Intenta construir las matrices con OSRM (calles reales). Si el servicio no
    responde en absoluto, cae a Haversine en línea recta para no tronar el
    optimizador. Regresa (distance_matrix, time_matrix_min, fuente) donde
    fuente es "osrm_sin_casetas", "osrm" (calles reales pero sin garantía de
    evitar casetas), "haversine_demasiadas_paradas" o "haversine_sin_respuesta"
    (línea recta, respaldo último — ver osrm_table para la diferencia).

    OJO: el respaldo NO truena, entrega rutas de aspecto normal calculadas en
    línea recta. El error contra la calle real no es parejo (medido: -15% al
    centro, -38% a Escobedo), así que no se puede corregir con un factor: lo
    que se distorsiona es qué paradas PARECEN cercanas entre sí, y con eso el
    orden de la ruta. Por eso la fuente se propaga hasta el mensaje que ve el
    despachador en vez de fallar en silencio.
    """
    osrm_result, motivo = osrm_table(locations)
    if osrm_result:
        distances_m, durations_s, evito_casetas = osrm_result
        distance_matrix = [[int(d) for d in row] for row in distances_m]
        time_matrix_min = [[int(d / 60) for d in row] for row in durations_s]
        fuente = "osrm_sin_casetas" if evito_casetas else "osrm"
        return distance_matrix, time_matrix_min, fuente

    n = len(locations)
    distance_matrix = [[0] * n for _ in range(n)]
    time_matrix_min = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            dist_km = haversine_distance(locations[i][0], locations[i][1], locations[j][0], locations[j][1])
            distance_matrix[i][j] = int(dist_km * 1000)
            time_matrix_min[i][j] = int((dist_km / velocidad_kmh_fallback) * 60)
    return distance_matrix, time_matrix_min, f"haversine_{motivo}"


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
