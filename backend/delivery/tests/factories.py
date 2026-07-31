"""Datos mínimos para las pruebas, sin depender de SAP ni de la base real."""
from datetime import date, time

from delivery.models import Destino, LineaRemision, Remision, Ruta

# Coordenadas reales del área metropolitana de Monterrey, para que las
# distancias entre ellas se parezcan a las del sistema en operación.
CEDIS = (25.693214524592616, -100.48167993202988)
SAN_PEDRO = (25.6577, -100.4021)
CENTRO = (25.6714, -100.3095)
GUADALUPE = (25.6775, -100.2597)
ESCOBEDO = (25.7930, -100.3160)

FECHA = date(2026, 7, 27)

# Contador para que cada pedido tenga folio propio sin que las pruebas tengan
# que llevarlo. `doc_num` y `doc_entry` son únicos en el modelo.
_folio = [250000]


def crear_destino(coords=CENTRO, ini1=None, fin1=None, ini2=None, fin2=None, **extra):
    _folio[0] += 1
    return Destino.objects.create(
        card_code=f"C{_folio[0]}",
        ship_to_code=f"S{_folio[0]}",
        street="Calle de prueba",
        latitude=coords[0] if coords else None,
        longitude=coords[1] if coords else None,
        ini_recibo_1=ini1, fin_recibo_1=fin1,
        ini_recibo_2=ini2, fin_recibo_2=fin2,
        **extra,
    )


def crear_pedido(destino=None, fecha=FECHA, peso_kg=100.0, estado='Pendiente',
                 ruta=None, secuencia=None, eta=None, doc_num=None, slp_code="1"):
    _folio[0] += 1
    numero = doc_num if doc_num is not None else _folio[0]
    return Remision.objects.create(
        doc_entry=_folio[0],
        doc_num=numero,
        card_code="C1",
        card_name="CLIENTE DE PRUEBA",
        doc_date=fecha,
        doc_total=1000,
        slp_code=slp_code,
        slp_name="Vendedora",
        destino=destino if destino is not None else crear_destino(),
        peso_kg=peso_kg,
        estado=estado,
        ruta=ruta,
        secuencia_ruta=secuencia,
        eta=eta,
    )


def crear_linea(remision, cantidad=2, entregada=None, descripcion="Queso manchego"):
    return LineaRemision.objects.create(
        remision=remision,
        line_num=remision.lineas.count(),
        item_code="2113081",
        descripcion=descripcion,
        unidad="Pieza",
        cantidad=cantidad,
        cantidad_entregada=entregada,
    )


def crear_ruta(camion="RA7475A", fecha=FECHA, estado='Borrador'):
    return Ruta.objects.create(fecha=fecha, camion=camion, chofer="", estado=estado)


class MatrizFalsa:
    """
    Reemplaza a OSRM en las pruebas.

    Las pruebas NO deben salir a la red: sin esto dependerían de que el servidor
    de ruteo esté arriba y de cuánto tarde, y una prueba que a veces falla por
    algo que no es el código deja de servir para lo que sirve una prueba.

    Devuelve tiempos derivados de la distancia en línea recta, que es lo mismo
    que hace el respaldo real de `build_distance_time_matrices` cuando OSRM no
    contesta — o sea que este camino también es código de producción.
    """

    def __init__(self, fuente="osrm_sin_casetas"):
        self.fuente = fuente

    def __call__(self, locations, velocidad_kmh_fallback):
        from delivery.integrations.osrm import haversine_distance

        n = len(locations)
        distancias = [[0] * n for _ in range(n)]
        tiempos = [[0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                km = haversine_distance(*locations[i], *locations[j])
                distancias[i][j] = int(km * 1000)
                tiempos[i][j] = round(km / 42.0 * 60)
        return distancias, tiempos, self.fuente
