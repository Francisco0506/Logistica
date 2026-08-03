"""Lo que comparten los tres paneles.

Vive aparte para que ni el despachador ni ventas ni la app del chofer tengan
que importarse entre ellos solo para reusar un formato de texto.
"""
from datetime import date, datetime, timedelta

from .. import fleet

# El CEDIS y la flota tienen una sola fuente de verdad: fleet.py.
DEPOT_COORDS = fleet.CEDIS

# Transiciones válidas del flujo de despacho: no se puede saltar pasos
# (ej. de Borrador directo a En_Ruta) llamando la API directo sin pasar por UI.
TRANSICIONES_VALIDAS = {
    'Borrador': ['Cargando'],
    'Cargando': ['Listo'],
    'Listo': ['En_Ruta'],
    'En_Ruta': ['Finalizada'],
    'Finalizada': [],
}

# Margen que se le pone a la ETA para presentarla como rango en vez de una hora
# exacta. Va HACIA LOS DOS LADOS: una ETA de 09:00 se muestra como
# "entre 08:45 y 09:15".
#
# Antes solo se sumaba hacia adelante (09:00 → "09:00 a 09:15"), y eso decía que
# el camión nunca llega antes de la hora calculada, que es falso: llega antes o
# después, nadie sabe si va a caer a la mera hora. Un rango de un solo lado se
# lee como una promesa —"a partir de las 09:00"— y el cliente que sale a las
# 08:50 y no encuentra al camión tiene razón en quejarse.
#
# OJO: es un margen de PRESENTACIÓN, no un intervalo de confianza medido. La
# incertidumbre real es mayor (ver docs/calibracion-tiempos-osrm.md); estos 15
# minutos son el mínimo honesto, no el error real.
MARGEN_ETA_MINUTOS = 15



def _texto_ventana(destino):
    """
    La ventana de recibo lista para mostrar, en 24 h, o None si no hay.

    Los horarios corruptos de SAP (hora de cierre igual o anterior a la de
    apertura, ej. "08:00-06:00" de LA PARMESANA, a la que le falta el PM) NO se
    muestran tal cual: un rango imposible en pantalla parece un error del
    sistema y no del dato. Se marca como mal capturado, que es la verdad y
    además dice qué hay que arreglar y dónde. El optimizador ya los ignora por
    su lado (ver optimizer._ventana_en_minutos).
    """
    if not destino or not destino.ini_recibo_1 or not destino.fin_recibo_1:
        return None

    def _rango(ini, fin):
        ini_min = ini.hour * 60 + ini.minute
        fin_min = fin.hour * 60 + fin.minute
        # "00:00" de cierre casi siempre es medianoche real (cierra al final del
        # día), no el inicio del día.
        if fin_min == 0:
            fin_min = 24 * 60
        if fin_min <= ini_min:
            return None
        return f"{ini:%H:%M} - {fin:%H:%M}"

    texto = _rango(destino.ini_recibo_1, destino.fin_recibo_1)
    if texto is None:
        return "Horario mal capturado en SAP"

    if destino.ini_recibo_2 and destino.fin_recibo_2:
        segundo = _rango(destino.ini_recibo_2, destino.fin_recibo_2)
        if segundo:
            texto += f" y {segundo}"
    return texto


def _rango_eta(eta):
    """
    '09:00' -> ('08:45', '09:15'). None, None si no hay ETA calculada.

    El rango va a los dos lados de la hora estimada, nunca solo hacia adelante:
    el camión puede llegar antes o después y no hay forma de saberlo.
    """
    if not eta:
        return None, None
    try:
        centro = datetime.strptime(eta, "%H:%M")
    except ValueError:
        # ETAs viejas guardadas en 12 h ("09:00 AM") antes del cambio a 24 h.
        try:
            centro = datetime.strptime(eta, "%I:%M %p")
        except ValueError:
            return None, None
    desde = centro - timedelta(minutes=MARGEN_ETA_MINUTOS)
    hasta = centro + timedelta(minutes=MARGEN_ETA_MINUTOS)
    return desde.strftime("%H:%M"), hasta.strftime("%H:%M")

