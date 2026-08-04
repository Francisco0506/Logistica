"""Las reglas del negocio que usa el optimizador.

Están aparte porque son las que se discuten con operación —cuánto dura una
parada, hasta qué hora se puede entregar, qué cuenta como una sola parada— y
conviene poder leerlas sin pasar por el código de OR-Tools.
"""
from datetime import datetime

from ..models import ESTADOS_RUTA_DESPACHADA

# ==========================================
# 1. CONSTANTES DE TIEMPO Y CONFIGURACIÓN
# ==========================================
# ── Constantes medidas con 1 mes de GPS real (Samsara), SOLO los 5 camiones
# que de verdad operan (013, 016, 017, 023, 027 — se excluyen 024/015/012 que
# casi no salen y ensuciaban los promedios). Ver docs/flota.md.
VELOCIDAD_PROMEDIO_KMH = 42.0  # Solo se usa si OSRM no responde (respaldo Haversine) — real: promedio 42.3 km/h, mediana 39.0
TIEMPO_DESCARGA_MINUTOS = 12   # Tiempo de servicio por cliente — real: promedio 11.7 min, mediana 9.2, P75 14.5 (1662 paradas medidas)
# Hora base del plan = salida del PRIMER camión del día. Medido con GPS sobre
# 25 días: el primer camión sale 09:06 en promedio (mediana 09:08, el más
# temprano 07:57, el más tarde 10:09). No es cosmética: las ventanas de recibo
# de los clientes se miden desde aquí, así que ponerla más tarde de lo real
# recorta el tiempo disponible y tira pedidos que sí caben. La hora real de
# salida de cada camión se aplica al dar "Salida", que recalcula las ETAs
# (ver recalcular_etas_desde_salida).
HORA_CERO = datetime.strptime("09:00", "%H:%M")
MINUTOS_TURNO_MAXIMO = 6 * 60  # Turno normal de 6 h. La jornada real medida es 6.7 h promedio / 6.4 h mediana, pero 6 h es el turno oficial: el despachador amplía por corrida desde el panel cuando hace falta.
# Referencia operativa para validar un plan (no es una constante del modelo):
# las paradas reales por camión al día son mediana 15, P75 20, máximo observado
# 38 (ese día fueron 12.9 h de jornada). Si una corrida entrega rutas de ~20
# paradas parejas, el plan va optimista — ver docs/calibracion-tiempos-osrm.md.
# Quien acota las paradas por ruta es el turno + el tiempo de descarga + el
# tope medido por camión (fleet.py:max_paradas).
PESO_ESTIMADO_KG = 150  # Fallback SOLO cuando SAP no trae peso real de línea (ver sync.py)
# Escalón entre salidas EN EL PLAN. Va en 0 a propósito, aunque en la calle los
# camiones sí salen separados (medido con GPS: 31 min de mediana entre uno y
# otro, con días de 19 min y días de 4 h). La diferencia es que ese escalón es
# la CONSECUENCIA de cuánto tarda la carga, no una decisión de ruteo: forzarlo
# aquí castiga dos veces al último camión (sale tarde Y pierde ventana de los
# clientes), y el plan termina entregando menos de lo que la operación entrega
# de verdad. Comprobado con 80 pedidos y 5 camiones: escalón 0 → 77 pedidos en
# rutas de 13-18 paradas (calca la realidad: 15.5 paradas/día por camión);
# escalón 30 → solo 67. La hora real de salida de cada camión se aplica al dar
# "Salida" en el panel, que recalcula las ETAs (recalcular_etas_desde_salida).
INTERVALO_SALIDA_MINUTOS = 0
# La capacidad y el tope de paradas de cada camión salen de su ficha real en
# fleet.py, buscados por placa. Ya no hay valores "por posición" aquí.

# Estados de Ruta que ya fueron despachados/en proceso físico: nunca se destruyen
# ni recalculan al re-optimizar, para no reasignarle a otro camión un pedido que
# ya se cargó o que ya salió a la calle.
#
# La lista vive en models.py, junto a los estados que nombra. Aquí solo se le
# pone el nombre con el que la conoce el optimizador; antes era una copia, y una
# copia es algo que se puede olvidar de actualizar.
ESTADOS_RUTA_CONGELADOS = ESTADOS_RUTA_DESPACHADA


def _ventana_en_minutos(destino, minutos_turno=MINUTOS_TURNO_MAXIMO, hora_cero=None):
    """
    Convierte la ventana de recibo real del Ship-To (ini_recibo_1/fin_recibo_1)
    a minutos desde HORA_CERO, SIN recortar al turno del chofer. Si el destino
    no tiene ventana configurada en SAP, se usa todo el turno para no bloquear
    la ruta.

    Devuelve la ventana real (puede empezar después del turno máximo, ej. un
    cliente que recibe hasta la tarde) — quien la use para restricciones duras
    de OR-Tools debe recortarla con _ventana_recortada_a_turno().
    """
    hora_cero = hora_cero or HORA_CERO

    def _raw(ini, fin):
        """(ini_min, fin_min) del día para un par ini/fin, o None si el dato
        está corrupto (fin <= ini una vez corregida la medianoche)."""
        ini_raw = ini.hour * 60 + ini.minute
        fin_raw = fin.hour * 60 + fin.minute
        # "00:00" como hora de cierre casi siempre significa medianoche real
        # (cierra al final del día, ej. un bar), no el inicio del día. Si no
        # se corrige antes de comparar, un negocio con ventana amplia real
        # (ej. 08:00-00:00) se confunde con un dato corrupto.
        if fin_raw == 0:
            fin_raw = 24 * 60
        if fin_raw <= ini_raw:
            # Dato inconsistente capturado en SAP (hora fin antes o igual que
            # hora inicio, ej. "08:00-06:00" o "10:00-10:00" — probablemente
            # un cierre vespertino mal capturado sin PM). No tiene sentido
            # bloquear al cliente con una ventana de 0 minutos por un dato
            # corrupto: se descarta este par en vez de usarlo.
            return None
        return ini_raw, fin_raw

    if destino.ini_recibo_1 and destino.fin_recibo_1:
        r1 = _raw(destino.ini_recibo_1, destino.fin_recibo_1)
        if r1 is None:
            # R1 corrupto: se ignora toda ventana y se usa el turno completo,
            # igual que si no tuviera ventana configurada en SAP.
            return (0, minutos_turno)
        ini_raw, fin_raw = r1

        # Segundo turno (ej. cierra a mediodía y reabre en la tarde). SAP solo
        # guarda un ini/fin por turno, sin marcar a qué día aplica, así que se
        # trata como parte del mismo horario de recibo. OR-Tools solo admite
        # UNA ventana continua por parada, así que se extiende el cierre hasta
        # el fin del segundo turno en vez de representar el hueco de en medio
        # — mejor sobrestimar cuándo recibe (raro que rechace un camión que sí
        # llegó dentro de alguno de los dos turnos) que perder el turno
        # completo por no leerlo, que es lo que pasaba antes.
        if destino.ini_recibo_2 and destino.fin_recibo_2:
            r2 = _raw(destino.ini_recibo_2, destino.fin_recibo_2)
            if r2 is not None:
                ini_raw = min(ini_raw, r2[0])
                fin_raw = max(fin_raw, r2[1])

        hora_cero_raw = hora_cero.hour * 60 + hora_cero.minute
        ini_min = max(0, ini_raw - hora_cero_raw)
        fin_min = max(0, fin_raw - hora_cero_raw)
        return (ini_min, fin_min)
    return (0, minutos_turno)


# Cuántos decimales se conservan de lat/lng para decidir si dos direcciones son
# EL MISMO LUGAR. Cuatro decimales son ~11 metros: junta una plaza o un centro
# comercial, y separa dos negocios de calles distintas. Si dos puntos están a
# menos de 11 m, el camión se estaciona una sola vez de todos modos.
DECIMALES_MISMO_LUGAR = 4


# Qué campo de `Destino` corresponde a cada día de la semana de Python
# (lunes = 0 … domingo = 6). El domingo no existe como campo porque no se
# reparte: ningún cliente tiene capturado si recibe en domingo.
CAMPO_DIA_ENTREGA = {
    0: 'ent_lun',
    1: 'ent_mar',
    2: 'ent_mie',
    3: 'ent_jue',
    4: 'ent_vie',
    5: 'ent_sab',
}


def recibe_ese_dia(destino, dia):
    """
    ¿Este cliente recibe el día en que le tocaría llegar el camión?

    `dia` es la fecha de REPARTO —cuándo llega el camión— no la de captura del
    documento. Son días distintos: lo capturado hoy sale mañana.

    Hasta ahora el optimizador NUNCA leía estos campos, aunque `Destino` los
    guarda y tanto SAP como el Excel los llenaban. Medido: 68 de 195 destinos
    tienen algún día restringido —casi todos "no reciben sábado"— y el sistema
    les planeaba entregas ese día igual. El camión llegaba a una puerta cerrada.
    Hoy casi no duele porque sobran camiones; cuando la cobertura suba, cada
    parada desperdiciada es una que sí ocupaba otro cliente.

    Ante la duda se DEJA PASAR: un destino sin el dato capturado se trata como
    que sí recibe. Es mejor mandar un camión de más que dejar fuera del reparto
    a un cliente por un campo que nadie llenó — y como la base productiva no
    tiene estos UDF (ver docs/pendientes.md §3), ahí todos caen en este caso.
    """
    campo = CAMPO_DIA_ENTREGA.get(dia.weekday())
    if campo is None:
        # Domingo. No se reparte, pero si alguien fuerza una corrida, que no
        # se caiga todo el plan: se trata como día hábil.
        return True
    return bool(getattr(destino, campo, True))


# Ciudades del corredor de Saltillo (Saltillo + Ramos Arizpe + Arteaga): están
# a ~85 km del CEDIS, lejos de todo lo demás, y por default el solver reparte
# sus paradas entre varios camiones aunque quepan en uno solo — cada camión de
# más que sale para allá es un viaje de ~3 h de ida y vuelta que no hacía falta.
# Pedido de Francisco (3-ago-2026): si caben en un camión, que sea SIEMPRE uno
# solo; si no caben, se reparte entre los que hagan falta avisando en el mensaje.
CIUDADES_ZONA_SALTILLO = ("saltillo", "ramos arizpe", "arteaga")


def es_zona_saltillo(city):
    """¿Esta ciudad (tal como la trae SAP, con mayúsculas/acentos que varían)
    pertenece al corredor de Saltillo?"""
    if not city:
        return False
    ciudad = city.strip().lower()
    return any(nombre in ciudad for nombre in CIUDADES_ZONA_SALTILLO)


def _clave_lugar(destino):
    """
    Identifica el LUGAR FÍSICO de un destino, no el registro de SAP.

    Hace falta porque SAP manda varios Ship-To en el mismo punto, y NO siempre
    por error:

    1. Dos códigos que facturan aparte pero entregan en la misma puerta
       (ej. C587-44 y C587-45, ambos PIZZA DEPRIZZA SANTA MONICA, misma calle y
       mismas coordenadas): puede ser el mismo pedido partido en dos facturas.
    2. Varios negocios en un mismo domicilio: PROVEO PARQUE MARTEL tiene cuatro
       razones sociales en la misma dirección, EL SURTIDOR tres.
    3. Y sí, también duplicados de captura de verdad (MALIS / MALÍS,
       "DEPRIZZA" / "DEPRRIZZA").

    Da igual cuál sea el caso: el camión se estaciona UNA vez. Por eso se agrupa
    por coordenada y no se intenta adivinar si dos códigos "son el mismo
    cliente" — eso es asunto de facturación, no de ruteo. Agrupar por destino_id
    (como se hacía) planeaba una parada de 12 min por cada registro: medido con
    los pedidos del 25-jul, 120 paradas planeadas contra 106 lugares reales,
    o sea 168 minutos de descarga que en la calle no existen.

    Los 11.7 min medidos con Samsara son tiempo DETENIDO EN UN PUNTO, así que
    cuando el camión paró en PROVEO y entregó a cuatro clientes, Samsara lo
    contó como una sola parada: el promedio ya trae esos casos adentro. Por eso
    12 min por lugar es lo medido, y 12 por registro era lo inventado.

    PENDIENTE (Francisco, 25-jul-2026): entregar a cuatro clientes en un mismo
    domicilio sí toma algo más que a uno solo — papeleo y firma por cada uno —
    pero cuánto más no está medido y Samsara no lo puede decir, porque solo ve
    que el camión estuvo detenido. Queda anotado en docs/pendientes.md para
    medirlo cuando se pueda y afinar el tiempo de servicio.
    """
    return (
        round(destino.latitude, DECIMALES_MISMO_LUGAR),
        round(destino.longitude, DECIMALES_MISMO_LUGAR),
    )


def _horas_y_minutos(minutos):
    """'3 h 20 min' / '45 min'. Para mensajes al despachador."""
    h, m = divmod(int(minutos), 60)
    if h and m:
        return f"{h} h {m} min"
    return f"{h} h" if h else f"{m} min"


def _ventana_recortada_a_turno(ini_min, fin_min, minutos_turno=MINUTOS_TURNO_MAXIMO):
    """
    Recorta una ventana real al turno máximo del chofer, para usarla como
    restricción dura de OR-Tools (que exige ini <= fin). Un cliente que abre
    su ventana después del turno máximo queda con una ventana de un solo
    minuto al final del turno: en la práctica, inalcanzable, y el solver lo
    deja fuera de esa ruta en vez de reventar con una ventana inválida.
    """
    ini_cap = min(ini_min, minutos_turno)
    fin_cap = max(ini_cap, min(fin_min, minutos_turno))
    return (ini_cap, fin_cap)


# ==========================================
# 2. CONSTRUCCIÓN DEL MODELO (MATRICES)
# ==========================================

