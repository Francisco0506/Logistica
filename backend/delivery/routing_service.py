"""
Cliente OSRM: matriz de distancia/tiempo por calle real para el optimizador.
Centralizado aquí para no duplicar la URL del servidor OSRM ni el parámetro de
exclusión de autopistas entre archivos.

Aquí NO se geocodifica. Cuando SAP no trae lat/lng de un Ship-To, el pedido se
deja sin coordenada y el panel lo marca como alerta (ver api.py): mandar la
dirección de un cliente a un servicio externo para resolverla sería filtrar
datos del cliente a un tercero sin avisar.
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


# ─────────────────────────────────────────────────────────────────────────
# Calibración contra viajes reales (27-jul-2026)
#
# OSRM entrega tiempo de manejo ideal: no sabe de semáforos, de tráfico, ni de
# la vuelta a la manzana buscando dónde estacionarse. Medido con 307 tramos
# reales reconstruidos del GPS de Samsara (7 días, camiones 013/016/017/023/027):
# se detectó cada parada de 2.5 min o más, y se comparó el tiempo real de puerta
# a puerta contra lo que OSRM dice del MISMO tramo.
#
#      tramo        n     min OSRM    min real    factor
#      0-2 km      76         183        421       2.30
#      2-5 km      99         529        921       1.74
#      5-10 km     55         488        987       2.02
#      10-20 km    30         474        734       1.55
#      20+ km      47       1,522      2,178       1.43
#      TODOS      307       3,196      5,242       1.64
#
# El factor NO es parejo: cae conforme el tramo se alarga, porque en un tramo
# corto el semáforo y la maniobra pesan más que el manejo. Por eso se interpola
# por distancia en vez de usar un solo número —un factor plano de 1.64 dejaría
# los tramos cortos 30% flojos y los largos 15% apretados.
#
# El umbral de 2.5 min para considerar "parada" importa: una entrega dura ~12
# min, así que nunca se cuenta como viaje; y una espera de semáforo dura menos,
# así que sí cuenta como viaje, que es lo correcto. Subirlo a 8 min inflaba el
# factor a 2.12 porque se empezaba a tragar el tiempo de entrega.
#
# Cómo re-medirlo: el script vive en docs/ y se corre contra Samsara. Hay que
# repetirlo si cambia el perfil de OSRM o la operación.
_CALIBRACION = [(2, 2.10), (5, 1.80), (10, 1.70), (20, 1.55), (40, 1.45)]


def factor_trafico(distancia_km):
    """Cuánto hay que multiplicar el tiempo de OSRM para ese tramo."""
    if distancia_km <= _CALIBRACION[0][0]:
        return _CALIBRACION[0][1]
    for (km_a, f_a), (km_b, f_b) in zip(_CALIBRACION, _CALIBRACION[1:]):
        if distancia_km <= km_b:
            avance = (distancia_km - km_a) / (km_b - km_a)
            return f_a + (f_b - f_a) * avance
    return _CALIBRACION[-1][1]


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
        # round() y no int(): truncar regalaba hasta 59 s por tramo (medido: 0.50
        # min en promedio), y con ~20 tramos por ruta son 10 minutos por camión
        # que desaparecían del plan.
        time_matrix_min = [
            [round((seg / 60) * factor_trafico(distance_matrix[i][j] / 1000.0))
             for j, seg in enumerate(fila)]
            for i, fila in enumerate(durations_s)
        ]
        fuente = "osrm_sin_casetas" if evito_casetas else "osrm"
        return distance_matrix, time_matrix_min, fuente

    n = len(locations)
    distance_matrix = [[0] * n for _ in range(n)]
    time_matrix_min = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            dist_km = haversine_distance(locations[i][0], locations[i][1], locations[j][0], locations[j][1])
            distance_matrix[i][j] = int(dist_km * 1000)
            time_matrix_min[i][j] = round((dist_km / velocidad_kmh_fallback) * 60)
    return distance_matrix, time_matrix_min, f"haversine_{motivo}"
