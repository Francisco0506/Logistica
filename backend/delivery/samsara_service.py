"""
Cliente de solo lectura para la API de Samsara (GPS/telemetría de la flotilla
real). Nunca hace POST/PUT/PATCH/DELETE — solo consulta ubicación en vivo.

Filtrado a los camiones ISUZU de reparto: son los que de verdad importan para
el dispatcher (los Nissan/Hino/Freightliner y los 4 vehículos de vendedores
—Versa, March, KIA— quedan fuera).
"""
import os
import requests

SAMSARA_BASE = "https://api.samsara.com"
REQUEST_TIMEOUT = 8

# Placa real -> nombre del vehículo en Samsara, solo camiones ISUZU de reparto.
CAMIONES_ISUZU = {
    "RH83800": "012",
    "RJ37663": "013",
    "RJ57620": "015",
    "RJ97892": "016",
    "PR6889B": "017",
    "PP4873A": "023",
    "PP4872A": "024",
    "RA7475A": "027",
}
NOMBRE_A_PLACA = {v: k for k, v in CAMIONES_ISUZU.items()}


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
