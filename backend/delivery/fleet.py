"""
Fuente ÚNICA de verdad de la flota de reparto de Laben.

Antes esta información vivía duplicada en dos lados que había que mantener
sincronizados a mano: una lista de capacidades por POSICIÓN en `api.py`
(`[6000, 3500, ...]`, sin placa) y otra copia completa en
`frontend/src/config/fleet.js`. El backend no sabía qué camión era cuál: los
nombraba `T-001`, `T-002`… y solo el frontend traducía esos códigos a placas.

Eso causaba tres problemas concretos:

1. Al optimizar, el panel mandaba únicamente CUÁNTOS camiones estaban activos y
   el backend tomaba los primeros N de la lista. Apagar un camión y prender otro
   dejaba al plan corriendo con la capacidad del que se apagó, sin avisar.
2. Las rutas guardadas decían `T-001`, y a qué unidad correspondía dependía de
   cuáles estaban prendidos en el navegador ese día. El historial en Postgres
   quedaba imposible de leer.
3. Confirmar una capacidad obligaba a editar dos archivos en el mismo orden.

Ahora el camión se identifica por su PLACA en todos lados, y el frontend pide
esta lista por API (`GET /api/dispatcher/flota`) en vez de tener su copia.

── De dónde sale cada dato ──────────────────────────────────────────────────
Los camiones NO vienen de SAP: vienen de **Samsara**, que es donde está dada de
alta la flota. SAP aporta pedidos y clientes.

`modelo` y `capacidad_kg`: del modelo EXACTO de cada unidad, sacado del VIN que
reporta Samsara, contra la ficha técnica de Isuzu México. En los VIN no se usa
la letra Q, por eso NQR aparece como "N1R". Equivalencias:
    NLR -> ELF 100      = 1,500 kg
    NKR -> ELF 200      = 2,000 kg
    NPR -> ELF 400/500  = 3,500 kg  (rango 3,000-5,000; se toma el bajo para no
                                     arriesgar sobrecarga hasta confirmar caja)
    NQR -> ELF 600      = 6,000 kg
PENDIENTE: confirmar contra la tarjeta de circulación (ver docs/pendientes.md).

`max_paradas`: el récord real de entregas que ese camión ha hecho en un día,
medido con GPS. Es el tope práctico mientras SAP no mande el peso real de cada
pedido: sin ese dato la restricción de kilos corre con un estimado y no es
confiable, pero las paradas sí están medidas.

`activo_default`: los que casi no salen arrancan apagados en el panel (024 salió
1 día en 30, 015 tres días con 9 km, 012 ninguno). Se prenden con un clic.

`color`: identifica al camión en TODAS las pantallas — su línea en el mapa, sus
paradas numeradas, la franja de sus pedidos en ventas y su tarjeta en el
manifiesto. Arranca en el naranja de Laben y sigue con ocho tonos vivos y bien
separados entre sí: lo que importa es distinguirlos de un vistazo cuando están
encimados en el mapa, que es su único trabajo.

Todos son lo bastante intensos para que el número de parada, que va en BLANCO
encima, se siga leyendo. Ese es el límite: más claros se ven bonitos sueltos
pero el número se pierde.

ORDEN de la lista = ranking de uso real (km de GPS en 60 días). Los que más
trabajan van primero, así el panel los muestra arriba.

Todo lo medido está en docs/flota.md.
"""

# Coordenadas exactas de salida de los camiones (CEDIS Santa Catarina).
CEDIS = (25.693214524592616, -100.48167993202988)

CAMIONES = [
    {
        "placa": "RA7475A", "samsara": "027", "vin": "3MGN1R755NM000496",
        "modelo": "ELF 600", "anio": 2022,
        "capacidad_kg": 6000, "max_paradas": 29,
        "activo_default": True, "color": "#EA580C",
    },
    {
        "placa": "PP4873A", "samsara": "023", "vin": "JAANPR758L7000211",
        "modelo": "ELF 400/500", "anio": 2020,
        "capacidad_kg": 3500, "max_paradas": 30,
        "activo_default": True, "color": "#E11D48",
    },
    {
        "placa": "PR6889B", "samsara": "017", "vin": "JAAN1R758H7902236",
        "modelo": "ELF 600", "anio": 2017,
        "capacidad_kg": 6000, "max_paradas": 24,
        "activo_default": True, "color": "#7C3AED",
    },
    {
        "placa": "RJ97892", "samsara": "016", "vin": "JAA1KR775G7100447",
        "modelo": "ELF 200", "anio": 2016,
        "capacidad_kg": 2000, "max_paradas": 29,
        "activo_default": True, "color": "#059669",
    },
    {
        "placa": "RJ37663", "samsara": "013", "vin": "JAANLR858F7200133",
        "modelo": "ELF 100", "anio": 2015,
        "capacidad_kg": 1500, "max_paradas": 19,
        "activo_default": True, "color": "#2563EB",
    },
    {
        "placa": "PP4872A", "samsara": "024", "vin": "JAANPR756J7000561",
        "modelo": "ELF 400/500", "anio": 2018,
        "capacidad_kg": 3500, "max_paradas": 25,
        "activo_default": False, "color": "#D97706",
    },
    {
        "placa": "RJ57620", "samsara": "015", "vin": "JAA1KR778G7100118",
        "modelo": "ELF 200", "anio": 2016,
        "capacidad_kg": 2000, "max_paradas": 25,
        "activo_default": False, "color": "#0891B2",
    },
    {
        "placa": "RH83800", "samsara": "012", "vin": "JAANPR754E7005411",
        "modelo": "ELF 400/500", "anio": 2014,
        "capacidad_kg": 3500, "max_paradas": 25,
        "activo_default": False, "color": "#C026D3",
    },
]

POR_PLACA = {c["placa"]: c for c in CAMIONES}

# Valores para un camión que el despachador agregó a mano desde el panel y que
# por lo tanto no está en esta lista. Conservadores a propósito: se prefiere
# subestimar lo que aguanta un camión desconocido a planearle de más.
CAPACIDAD_KG_DESCONOCIDO = 3000
MAX_PARADAS_DESCONOCIDO = 25


def datos(placa):
    """Ficha del camión, o None si no es de la flota conocida."""
    return POR_PLACA.get(placa)


def capacidad_kg(placa):
    """Carga útil en KG de ese camión. Valor conservador si no se conoce."""
    camion = POR_PLACA.get(placa)
    return camion["capacidad_kg"] if camion else CAPACIDAD_KG_DESCONOCIDO


def max_paradas(placa):
    """Tope de entregas por día de ese camión (récord medido con GPS)."""
    camion = POR_PLACA.get(placa)
    return camion["max_paradas"] if camion else MAX_PARADAS_DESCONOCIDO

# Se quitó `placas_activas_por_default()`: nadie la llamaba. El panel recibe la
# flota completa por /dispatcher/flota y decide él cuáles prender con el campo
# `activo_default` de cada camión.
