"""
Mide con GPS real de Samsara qué tan optimista es OSRM.

Solo lectura. Recorre el historial de posiciones de los ISUZU de reparto y
calcula la velocidad EN MOVIMIENTO, que es la comparación correcta contra el
tiempo de manejo que devuelve OSRM (OSRM no incluye el tiempo detenido).
"""
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt

import requests
from dotenv import load_dotenv

load_dotenv(r"C:\Proyecto\Logistica\backend\.env")
H = {"Authorization": f"Bearer {os.getenv('SAMSARA_API_TOKEN')}"}
BASE = "https://api.samsara.com"

# Los 5 que de verdad operan (docs/flota.md).
OPERAN = {"013", "016", "017", "023", "027"}
DIAS = int(sys.argv[-1]) if sys.argv[-1].isdigit() else 7
MOVIENDOSE_KMH = 5      # debajo de esto se considera detenido
CEDIS = (25.693215, -100.48168)


def km(a, b):
    lat1, lon1, lat2, lon2 = map(radians, [a[0], a[1], b[0], b[1]])
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * asin(sqrt(h))


def traer_historial(dias):
    """Todas las páginas del historial GPS del periodo."""
    fin = datetime.now(timezone.utc)
    ini = fin - timedelta(days=dias)
    por_vehiculo = defaultdict(list)
    cursor, paginas = None, 0

    while True:
        params = {
            "types": "gps",
            "startTime": ini.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endTime": fin.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        if cursor:
            params["after"] = cursor
        # Samsara corta la conexión si se le pega muy seguido: reintento con
        # pausa creciente y una espera corta entre páginas.
        d = None
        for intento in range(4):
            try:
                r = requests.get(f"{BASE}/fleet/vehicles/stats/history", headers=H, params=params, timeout=60)
                r.raise_for_status()
                d = r.json()
                break
            except Exception as e:
                if intento == 3:
                    print(f"  (se corta en la página {paginas}: {type(e).__name__})")
                    return por_vehiculo
                time.sleep(2 * (intento + 1))
        time.sleep(0.4)
        for v in d.get("data", []):
            nombre = v.get("name")
            if nombre in OPERAN:
                por_vehiculo[nombre].extend(v.get("gps", []))
        paginas += 1
        pag = d.get("pagination", {})
        if not pag.get("hasNextPage"):
            break
        cursor = pag.get("endCursor")
        if paginas > 60:      # candado por si acaso
            break

    print(f"  {paginas} páginas leídas")
    return por_vehiculo


def analizar(por_vehiculo):
    print(f"\n{'='*66}")
    print(f"VELOCIDAD REAL EN MOVIMIENTO — últimos {DIAS} días")
    print(f"{'='*66}\n")

    todas_vel = []
    salidas_por_dia = defaultdict(dict)

    for nombre in sorted(por_vehiculo):
        puntos = sorted(por_vehiculo[nombre], key=lambda p: p["time"])
        vels = [p["speedMilesPerHour"] * 1.60934 for p in puntos
                if p.get("speedMilesPerHour") is not None]
        en_mov = [v for v in vels if v >= MOVIENDOSE_KMH]
        if not en_mov:
            continue

        en_mov.sort()
        prom = sum(en_mov) / len(en_mov)
        mediana = en_mov[len(en_mov) // 2]
        p90 = en_mov[int(len(en_mov) * 0.9)]
        todas_vel.extend(en_mov)

        # Distancia recorrida y tiempo en movimiento, para la velocidad
        # "efectiva" (la que de verdad importa para una ruta).
        dist, minutos_mov = 0.0, 0.0
        for a, b in zip(puntos, puntos[1:]):
            ta = datetime.fromisoformat(a["time"].replace("Z", "+00:00"))
            tb = datetime.fromisoformat(b["time"].replace("Z", "+00:00"))
            dt = (tb - ta).total_seconds() / 60
            if dt <= 0 or dt > 10:      # hueco: no se puede interpolar
                continue
            va = (a.get("speedMilesPerHour") or 0) * 1.60934
            if va >= MOVIENDOSE_KMH:
                dist += km((a["latitude"], a["longitude"]), (b["latitude"], b["longitude"]))
                minutos_mov += dt

        efectiva = (dist / (minutos_mov / 60)) if minutos_mov > 5 else 0

        print(f"  Camión {nombre}")
        print(f"    puntos GPS en movimiento : {len(en_mov):>6}")
        print(f"    velocidad promedio       : {prom:>6.1f} km/h")
        print(f"    mediana                  : {mediana:>6.1f} km/h")
        print(f"    percentil 90             : {p90:>6.1f} km/h")
        print(f"    EFECTIVA (km / h en mov.): {efectiva:>6.1f} km/h   [{dist:.0f} km en {minutos_mov/60:.1f} h]")
        print()

        # Primera salida del CEDIS de cada día
        for p in puntos:
            t = datetime.fromisoformat(p["time"].replace("Z", "+00:00"))
            local = t - timedelta(hours=6)     # Monterrey = UTC-6
            v = (p.get("speedMilesPerHour") or 0) * 1.60934
            lejos = km((p["latitude"], p["longitude"]), CEDIS) > 1.0
            if v >= MOVIENDOSE_KMH and lejos:
                dia = local.date()
                if nombre not in salidas_por_dia[dia]:
                    salidas_por_dia[dia][nombre] = local

    if todas_vel:
        todas_vel.sort()
        prom = sum(todas_vel) / len(todas_vel)
        print(f"{'-'*66}")
        print(f"  FLOTA COMPLETA: promedio {prom:.1f} km/h · mediana {todas_vel[len(todas_vel)//2]:.1f} km/h")
        print(f"  ({len(todas_vel):,} lecturas de GPS en movimiento)")
        print(f"{'-'*66}\n")

    print("HORA DE PRIMERA SALIDA DEL CEDIS (hora local de Monterrey)\n")
    for dia in sorted(salidas_por_dia)[-8:]:
        camiones = salidas_por_dia[dia]
        if not camiones:
            continue
        horas = sorted(camiones.values())
        rango = f"{horas[0]:%H:%M}" + (f" a {horas[-1]:%H:%M}" if len(horas) > 1 else "")
        detalle = "  ".join(f"{n} {h:%H:%M}" for n, h in sorted(camiones.items(), key=lambda x: x[1]))
        print(f"  {dia}  primera {rango}")
        print(f"              {detalle}")


from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        "Mide con GPS real de Samsara la velocidad efectiva de la flota y la "
        "hora real de salida del CEDIS, para calibrar el optimizador contra los "
        "tiempos optimistas de OSRM. Uso: python manage.py medir_velocidad_real 7"
    )

    def add_arguments(self, parser):
        parser.add_argument("dias", nargs="?", type=int, default=7)

    def handle(self, *args, **options):
        global DIAS
        DIAS = options["dias"]
        self.stdout.write(f"Consultando Samsara ({DIAS} dias)...")
        analizar(traer_historial(DIAS))
