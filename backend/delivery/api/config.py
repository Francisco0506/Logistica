"""
Lo que el frontend necesita saber del backend y hoy tiene copiado a mano.

POR QUÉ EXISTE ESTE ENDPOINT.

Este repo lleva tres bugs reales causados por lo mismo: un dato que vive en dos
lugares y se desfasa. La paleta de camiones duplicada le daba el mismo color a
dos unidades; la lista de camiones de `samsara.py`, aparte de `fleet.py`, dejó
tres camiones fuera del mapa; y la lista de estados finales, copiada en cinco
archivos, hizo que el MISMO bug se arreglara dos veces sin que nadie notara las
otras copias.

El patrón siempre es el mismo: el backend sabe algo, el frontend lo transcribe,
y meses después nadie recuerda que había una copia. Aquí el backend lo dice y el
frontend lo lee.

QUÉ **NO** VA AQUÍ: nada que cambie de un día a otro (eso son los endpoints de
datos), ni secretos, ni nada que el frontend pueda calcular solo. Esto son las
reglas del negocio y el vocabulario, que cambian cuando alguien decide
cambiarlas.
"""
import os

from ninja import Router

from .. import fleet
from ..models import ESTADOS_ENTREGA_FINAL, ESTADOS_RUTA_DESPACHADA, Remision
from ..optimizer.reglas import (
    MINUTOS_TURNO_MAXIMO, PESO_ESTIMADO_KG, TIEMPO_DESCARGA_MINUTOS,
)
from .comun import MARGEN_ETA_MINUTOS, TRANSICIONES_VALIDAS

router = Router()

# Los escalones de turno que ofrece el panel. Estaban escritos a mano en TRES
# lugares del frontend (dos de ellos en el mismo archivo, uno dentro del JSX) y
# el backend además acotaba a 4-12 h por su lado: cuatro criterios para lo mismo.
ESCALONES_TURNO_HORAS = [6, 6.5, 7, 7.5, 8]


@router.get("/config")
def get_config(request):
    """
    Las reglas y el vocabulario que el frontend necesita, en un solo lugar.

    Se sirve en cada carga de pantalla, así que va sin tocar la base de datos:
    es todo constantes ya cargadas en memoria.
    """
    return {
        # ── Vocabulario de estados ──────────────────────────────────────────
        # Los TRES finales de una entrega. Comparar contra 'Entregado' a secas
        # dejaba a un camión en "8/10 para siempre" y le mostraba a la vendedora
        # un pedido fallido como "SIN PROGRAMAR".
        "estados_entrega_final": list(ESTADOS_ENTREGA_FINAL),
        # Los estados de ruta en que la mercancía YA es física.
        "estados_ruta_despachada": list(ESTADOS_RUTA_DESPACHADA),
        # La máquina de estados del despacho. El frontend tenía su propia copia
        # en `EstadoDespacho.jsx`, con un comentario que decía "coincide con
        # TRANSICIONES_VALIDAS del backend" — coincidía HOY. Al desfasarse, el
        # botón manda una transición que el backend rechaza con HTTP 200 y
        # `status: 'error'`, o sea un botón que no hace nada.
        "transiciones": TRANSICIONES_VALIDAS,
        # Catálogo de motivos de no-entrega. `HojaEntrega.jsx` tenía los siete
        # con textos propios: si aquí se agrega uno, el chofer nunca lo vería, y
        # si un id se desfasa Django lo guarda igual (no valida `choices` en
        # `save()`) y queda basura en el catálogo con el que se va a contar.
        "motivos_no_entrega": [
            {"id": codigo, "texto": texto} for codigo, texto in Remision.MOTIVOS
        ],
        "motivos_sin_entrega": list(Remision.MOTIVOS_SIN_ENTREGA),

        # ── Parámetros de operación ─────────────────────────────────────────
        "escalones_turno_horas": ESCALONES_TURNO_HORAS,
        # El turno con el que se corrió el plan. `TarjetaCamion.jsx` tenía el 6
        # clavado, así que al optimizar con 8 h TODAS las tarjetas se pintaban de
        # ámbar avisando de un problema que no existía.
        "turno_default_horas": MINUTOS_TURNO_MAXIMO / 60,
        "tiempo_descarga_minutos": TIEMPO_DESCARGA_MINUTOS,
        "margen_eta_minutos": MARGEN_ETA_MINUTOS,
        "peso_estimado_kg": PESO_ESTIMADO_KG,

        # ── Flota ───────────────────────────────────────────────────────────
        "cedis": {"lat": fleet.CEDIS[0], "lng": fleet.CEDIS[1]},
        # Con qué capacidad se cuenta un camión que el despachador agregó a
        # mano. Estaba en `fleet.py` y otra vez escrito en el JSX del panel.
        "camion_desconocido": {
            "capacidad_kg": fleet.CAPACIDAD_KG_DESCONOCIDO,
            "max_paradas": fleet.MAX_PARADAS_DESCONOCIDO,
        },

        # ── Con qué se planeó ───────────────────────────────────────────────
        # El frontend dibuja las rutas pidiéndole la geometría a SU propio OSRM
        # (VITE_OSRM_BASE) mientras el backend planeó contra el suyo. Si no son
        # el mismo, el mapa enseña un camino que no es el que se calculó. Aquí
        # el backend dice contra cuál planeó para poder detectarlo.
        "osrm_base": os.getenv("OSRM_BASE", ""),
    }
