"""
Cliente de solo lectura para la API de Samsara (GPS/telemetría de la flotilla
real). Nunca hace POST/PUT/PATCH/DELETE — solo consulta ubicación en vivo.

Qué vehículos se muestran: LOS DE LA FLOTA DE REPARTO, sean de la marca que
sean. Samsara reporta 17 unidades; las que no están en fleet.py son los cuatro
carros de vendedores (Versa, March, dos KIA) y las unidades que no reparten.

Antes esto tenía su propia lista fija "solo ISUZU", con el comentario de que
"los Nissan/Hino/Freightliner quedan fuera". Ese criterio resultó equivocado: el
022 (Frontier) hizo 1,452 km en 11 días —más que dos de los ISUZU que sí
salían— y el 029 (HINO) andaba en la calle sin aparecer en el mapa. Peor, esa
lista era una SEGUNDA copia de la flota que había que acordarse de actualizar
aparte de fleet.py, y por eso se desfasó.

Ahora la flota se lee de fleet.py, que es la única fuente de verdad: dar de alta
un camión ahí basta para que salga en el mapa.
"""
import os
import requests

from .. import fleet

SAMSARA_BASE = "https://api.samsara.com"
REQUEST_TIMEOUT = 8

# Nombre del vehículo en Samsara -> placa real, derivado de la flota.
NOMBRE_A_PLACA = {
    c["samsara"]: c["placa"] for c in fleet.CAMIONES if c.get("samsara")
}


def _headers():
    token = os.getenv("SAMSARA_API_TOKEN")
    if not token:
        return None
    return {"Authorization": f"Bearer {token}"}


def get_ubicaciones_isuzu():
    """
    GET de solo lectura a Samsara: ubicación/velocidad actual de los camiones
    Isuzu de reparto. Si no hay token configurado o falla la llamada, regresa
    lista vacía (no rompe el dispatcher si Samsara no está disponible).
    """
    headers = _headers()
    if not headers:
        return []

    try:
        resp = requests.get(
            f"{SAMSARA_BASE}/fleet/vehicles/stats",
            headers=headers,
            params={"types": "gps"},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
    except requests.RequestException:
        return []

    data = resp.json().get("data", [])
    resultado = []
    for v in data:
        nombre = v.get("name")
        if nombre not in NOMBRE_A_PLACA:
            continue
        gps = v.get("gps") or {}
        if gps.get("latitude") is None or gps.get("longitude") is None:
            continue
        resultado.append({
            "placa": NOMBRE_A_PLACA[nombre],
            "nombre_samsara": nombre,
            "lat": gps["latitude"],
            "lng": gps["longitude"],
            "velocidad_kmh": round((gps.get("speedMilesPerHour") or 0) * 1.60934, 1),
            "rumbo": gps.get("headingDegrees"),
            "ultima_actualizacion": gps.get("time"),
            "direccion": (gps.get("reverseGeo") or {}).get("formattedLocation", ""),
        })
    return resultado
