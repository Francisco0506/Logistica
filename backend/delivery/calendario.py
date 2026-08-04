"""
El calendario de la operación: qué día sale a la calle lo que se capturó cuándo.

VIVE AQUÍ Y NO EN `api/` A PROPÓSITO.

Estaba en `api/comun.py`, y su propio docstring explicaba la incomodidad: "vive
aquí y no dentro del endpoint /jornada porque el OPTIMIZADOR también lo
necesita". La conclusión correcta era sacarlo de `api/` por completo, no dejarlo
ahí: `optimizer/modelo.py` hacía `from ..api.comun import fecha_reparto_de`, o
sea que **el optimizador dependía de la capa HTTP**. No se podía importar
`delivery.optimizer` sin arrastrar django-ninja.

Esto es conocimiento del negocio —discutido con operación, medido contra la base
productiva— y no tiene nada que ver con servir peticiones.
"""
from datetime import date, timedelta  # noqa: F401  (date se usa en las anotaciones)

# Los días como se dicen en el panel y en las alertas. Estaban escritos a mano
# en `optimizer/solver.py` (dos veces en el mismo archivo) y en
# `api/dispatcher.py`.
DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

DOMINGO = 6


def es_domingo(dia: date) -> bool:
    """El único día en que no sale ningún camión."""
    return dia.weekday() == DOMINGO


def fecha_reparto_de(fecha_carga: date) -> date:
    """
    En qué día SALE a la calle lo que se capturó el `fecha_carga`.

    La regla de la operación: **la entrega capturada un día sale al siguiente**.
    Almacén hace el pickeo, captura las órdenes de entrega durante el día, y a
    la mañana siguiente los camiones salen con eso. Ver docs/flujo-documentos-sap.md.

    El domingo no se reparte, así que lo capturado el sábado sale el lunes.
    """
    reparto = fecha_carga + timedelta(days=1)
    if es_domingo(reparto):
        reparto += timedelta(days=1)
    return reparto


def fecha_carga_de(reparto: date) -> date:
    """
    El inverso: de qué día son los documentos que salen el día `reparto`.

    Es el día anterior y punto; si cae domingo se toma el sábado, que es el
    único día sin captura.

    Antes esto buscaba hacia atrás "el último día que tuviera entregas", y
    estaba mal: al pedir el reparto del 1-ago —que todavía no tenía nada
    capturado— se iba hasta el 29-jul y mostraba esos pedidos como si fueran del
    día que se pidió. Datos viejos presentados como actuales, que es peor que no
    mostrar nada.
    """
    carga = reparto - timedelta(days=1)
    if es_domingo(carga):
        carga -= timedelta(days=1)
    return carga


def nombre_dia(dia: date) -> str:
    return DIAS[dia.weekday()]


# ─────────────────────────────────────────────────────────────────────────────
# QUÉ DÍA ABRE EL PANEL
# ─────────────────────────────────────────────────────────────────────────────

# A partir de esta hora, el reparto de hoy ya está en la calle y lo que toca
# preparar es el siguiente.
#
# Las 11 salen de los datos, no de una corazonada: los camiones salen entre 7:03
# y 10:35 (GPS, 8 días), así que pasada esa hora el plan de hoy ya se fue. Y la
# captura de entregas va de 6 am a 7 pm —el 99.9% antes de las 20:00, medido
# sobre 2,548 entregas de 30 días— así que por la tarde ya hay bastante del día
# siguiente con qué trabajar.
HORA_CORTE_JORNADA = 11

# Hasta cuántos días hacia atrás buscar el último con captura, cuando el panel
# abre por la mañana y no se ha sincronizado nada.
DIAS_HACIA_ATRAS = 7


def jornada_de(ahora, contar_entregas, reparto: date = None) -> dict:
    """
    Qué día de entregas hay que planear AHORITA.

    VIVE AQUÍ Y NO EN EL ENDPOINT. Es la regla de negocio más discutida con
    operación —cuándo sale lo que se captura— y estaba dentro de un handler
    HTTP, lo que obligaba a probarla levantando un cliente de Django para algo
    que es pura aritmética de calendario.

    `contar_entregas(fecha) -> int` se inyecta en vez de consultar el modelo
    aquí: así este módulo no depende de la base de datos y se puede probar con
    una función de mentiras.

    Con `reparto` contesta otra pregunta: "quiero ver el reparto de ESTE día,
    ¿qué documentos le tocan?". Es lo que usa el selector de fecha del panel,
    que muestra el día en que SALE la mercancía —como piensa cualquiera— y no el
    día en que se capturó el documento, que es como está guardada.
    """
    hoy = ahora.date()

    # ── Caso 1: el despachador escogió un día de reparto en el selector ──
    if reparto is not None:
        # Es el día hábil anterior y punto.
        #
        # Antes esto buscaba hacia atrás "el último día que tuviera entregas", y
        # estaba mal: al pedir el reparto del 1-ago —que todavía no tiene nada
        # capturado— se iba hasta el 29-jul y mostraba los pedidos de ese día
        # como si fueran los del 1. Datos viejos presentados como si fueran del
        # día que se pidió, que es peor que no mostrar nada.
        carga = fecha_carga_de(reparto)
        entregas = contar_entregas(carga)
        return {
            "fecha_carga": carga.isoformat(),
            "fecha_reparto": reparto.isoformat(),
            "entregas": entregas,
            "para": _para(reparto, hoy),
            "explicacion": (
                f"Reparto del {reparto:%d-%b} — son las entregas capturadas el {carga:%d-%b}."
                if entregas else
                f"Todavía no hay entregas capturadas el {carga:%d-%b}, que son las "
                f"que saldrían el {reparto:%d-%b}."
            ),
        }

    # ── Caso 2: pasada la hora de corte, se prepara el reparto siguiente ──
    if ahora.hour >= HORA_CORTE_JORNADA:
        # Lo que se captura hoy sale mañana... salvo el sábado, que sale el
        # lunes porque el domingo no se reparte. Se usa `fecha_reparto_de` en
        # vez de sumar un día a mano: ese salto ya está resuelto ahí, y tenerlo
        # en dos lados es justo lo que este módulo vino a evitar. Sumando a
        # mano, el sábado por la tarde el panel abría preparando un DOMINGO.
        salida = fecha_reparto_de(hoy)

        # EN DOMINGO NO SE CAPTURA NADA, así que no hay un "se está capturando
        # hoy" que contar. Lo que sale el lunes es lo del SÁBADO.
        #
        # Sin esta rama, el domingo por la tarde el panel abría diciendo
        # "Preparando 03-ago: son las entregas que se están capturando hoy" con
        # el contador en 0 — y el despachador se encontraba un lunes vacío sin
        # forma de saber que sus pedidos sí existen, solo que bajo otra fecha.
        # `fecha_carga_de` ya sabe saltarse el domingo hacia atrás; aquí solo
        # había que preguntarle en vez de dar por hecho que la carga es "hoy".
        if es_domingo(hoy):
            carga = fecha_carga_de(salida)
            return {
                "fecha_carga": carga.isoformat(),
                "fecha_reparto": salida.isoformat(),
                "entregas": contar_entregas(carga),
                "para": _para(salida, hoy),
                "explicacion": (
                    f"Preparando {salida:%d-%b} con lo capturado el {carga:%d-%b}: "
                    f"en domingo no se captura ni se reparte."
                ),
            }

        return {
            "fecha_carga": hoy.isoformat(),
            "fecha_reparto": salida.isoformat(),
            "entregas": contar_entregas(hoy),
            "para": _para(salida, hoy),
            "explicacion": (
                f"Preparando {salida:%d-%b}: son las entregas que se están "
                f"capturando hoy. Siguen llegando hasta las 7 de la noche."
            ),
        }

    # ── Caso 3: por la mañana, se planea el reparto de hoy con lo de ayer ──
    carga, entregas = None, 0
    for dias in range(1, DIAS_HACIA_ATRAS + 1):
        candidata = hoy - timedelta(days=dias)
        n = contar_entregas(candidata)
        if n:
            carga, entregas = candidata, n
            break

    # En domingo no sale ningún camión: lo que se está preparando es el lunes.
    # Sin esto el panel abría prometiendo un reparto en domingo.
    salida = hoy + timedelta(days=1) if es_domingo(hoy) else hoy
    sale = "hoy" if salida == hoy else f"el {salida:%d-%b}"

    if carga is None:
        # Nunca se ha sincronizado nada hacia atrás: que el panel abra en ayer y
        # el usuario sincronice. Mejor eso que abrir en hoy, que a esa hora está
        # vacío y hace pensar que el sistema falla.
        carga = hoy - timedelta(days=1)
        explicacion = (
            f"No hay entregas cargadas de los últimos {DIAS_HACIA_ATRAS} días. "
            f"Sincroniza {carga:%d-%b} para ver lo que sale {sale}."
        )
    else:
        explicacion = (
            f"Entregas capturadas el {carga:%d-%b} — son las que salen {sale} "
            f"{salida:%d-%b}. Lo que se capture hoy sale después."
        )

    return {
        "fecha_carga": carga.isoformat(),
        "fecha_reparto": salida.isoformat(),
        "entregas": entregas,
        "para": _para(salida, hoy),
        "explicacion": explicacion,
    }


def _para(reparto: date, hoy: date) -> str:
    """
    Etiqueta corta del día de reparto, para que el panel no repita la cuenta.

    "otro" y no "mañana" cuando el salto es de dos días: el sábado se prepara el
    LUNES, y el frontend usa esta etiqueta para redactar — decirle "mañana" lo
    haría escribir una fecha que no es.
    """
    if reparto == hoy:
        return "hoy"
    if reparto == hoy + timedelta(days=1):
        return "mañana"
    return "otro"
