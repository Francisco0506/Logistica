"""Lo que comparten los tres paneles.

Vive aparte para que ni el despachador ni ventas ni la app del chofer tengan
que importarse entre ellos solo para reusar un formato de texto.
"""
from datetime import datetime, timedelta

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

# Margen que se le suma a la ETA para presentarla como rango ("entre 09:00 y
# 09:15") en vez de una hora exacta. Una hora al minuto suena a promesa que no
# se puede cumplir; el rango dice la verdad: es una estimación.
# OJO: es un margen de presentación, NO un intervalo de confianza medido. La
# incertidumbre real es mayor mientras OSRM siga ~25% optimista
# (ver docs/calibracion-tiempos-osrm.md).
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
    """'09:00' -> ('09:00', '09:15'). None si no hay ETA calculada."""
    if not eta:
        return None, None
    try:
        inicio = datetime.strptime(eta, "%H:%M")
    except ValueError:
        # ETAs viejas guardadas en 12 h ("09:00 AM") antes del cambio a 24 h.
        try:
            inicio = datetime.strptime(eta, "%I:%M %p")
        except ValueError:
            return None, None
    fin = inicio + timedelta(minutes=MARGEN_ETA_MINUTOS)
    return inicio.strftime("%H:%M"), fin.strftime("%H:%M")

