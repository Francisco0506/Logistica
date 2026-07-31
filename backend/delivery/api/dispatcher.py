"""Panel del despachador: sincronizar, optimizar y despachar.

Es el panel donde se arma el día: trae las órdenes de entrega de SAP,
corre el optimizador y mueve las rutas por sus estados hasta que salen.
"""
from datetime import date, datetime, timedelta
from typing import List, Optional

from django.utils import timezone
from ninja import Router, Schema

from .. import fleet
from ..models import ESTADOS_RUTA_DESPACHADA, Remision, Ruta
from ..optimizer import (
    SEGUNDOS_SOLVER, solve_vrp, sugerir_camiones_para_remision,
    asignar_manualmente, recalcular_etas_desde_salida,
)
from ..integrations.samsara import get_ubicaciones_isuzu
from ..integrations.sap import sync_from_sap
from .comun import DEPOT_COORDS, TRANSICIONES_VALIDAS, _rango_eta, _texto_ventana

router = Router()

class RemisionOut(Schema):
    id: int
    doc_num: int
    card_name: str
    estado: str
    ship_to_code: str
    doc_total: float
    # Hora estimada de llegada, o `null` si todavía no se calcula.
    #
    # Antes el default era la palabra "Pendiente", que viajaba por la API como
    # si fuera una hora: el popup del mapa decía "Llega Pendiente", la guía
    # impresa que se lleva el almacén traía "Pendiente" en la columna de hora, y
    # la tarjeta del camión "Sigue: CLIENTE · Pendiente". Un campo de hora que a
    # veces trae una palabra obliga a cada pantalla a acordarse de filtrarla, y
    # tres de ellas no se acordaban.
    eta: Optional[str] = None
    # La misma ETA como rango (±15 min), que es como se le debe decir a la
    # gente: el camión llega antes o después, nunca a la mera hora.
    eta_desde: Optional[str] = None
    eta_hasta: Optional[str] = None
    address: str = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    truck: Optional[str] = None
    secuencia_ruta: Optional[int] = None
    # Peso real del pedido en KG. `null` cuando SAP no lo trae (ver sync.py):
    # el panel debe mostrarlo como desconocido, NUNCA sustituirlo por el
    # estimado que usa el optimizador, o se vería como un peso medido.
    peso_kg: Optional[float] = None
    # Ventana de recibo del cliente, en 24 h ("15:00 - 22:00"). Es el dato que
    # explica por qué las rutas van apretadas y no se mostraba en ningún lado.
    ventana: Optional[str] = None

class RutaOut(Schema):
    id: int
    camion: str
    chofer: str
    estado: str
    pedidos_count: int
    hora_salida: Optional[str] = None
    # Cuándo se generó esta ruta. Sirve para saber si el plan que se está
    # viendo ya se quedó viejo: si llegaron pedidos de SAP después de esta
    # hora, no están considerados y hay que volver a optimizar.
    generada: Optional[str] = None

# 1. Obtener todas las remisiones
@router.get("/remisiones", response=List[RemisionOut])
def get_remisiones(request, fecha: date):
    remisiones = Remision.objects.reales().filter(doc_date=fecha).select_related('destino', 'ruta')
    
    result = []
    for r in remisiones:
        lat, lng = None, None
        if r.destino and r.destino.latitude is not None and r.destino.longitude is not None:
            lat = r.destino.latitude
            lng = r.destino.longitude

        result.append({
            "id": r.id,
            "doc_num": r.doc_num,
            "card_name": r.card_name,
            "estado": r.estado,
            "ship_to_code": r.destino.ship_to_code if r.destino else "",
            "doc_total": float(r.doc_total),
            "address": r.destino.street if r.destino and r.destino.street else "Sin direccion en SAP",
            "eta": r.eta or None,
            "eta_desde": _rango_eta(r.eta)[0],
            "eta_hasta": _rango_eta(r.eta)[1],
            "lat": lat,
            "lng": lng,
            "truck": r.ruta.camion if r.ruta else None,
            "secuencia_ruta": r.secuencia_ruta,
            "peso_kg": r.peso_kg,
            "ventana": _texto_ventana(r.destino),
        })
    return result

# 2. Sincronizar pedidos de SAP
@router.post("/sync")
def sync_sap(request, fecha: date):
    res = sync_from_sap(fecha)
    return res


# Hora a partir de la cual el despachador ya está preparando el día SIGUIENTE.
#
# Los camiones salen entre las 7:03 y las 10:35 (medido con GPS, 8 días). Pasada
# esa hora el plan de hoy ya está en la calle y lo que toca preparar es mañana.
# Se pone a las 11 para dar margen al día que salen tarde.
HORA_CORTE_JORNADA = 11


class JornadaOut(Schema):
    # El día cuyas entregas hay que planear ahora. Es el que abre el panel.
    fecha_carga: str
    # El día en que esa mercancía sale a la calle.
    fecha_reparto: str
    entregas: int
    # "hoy" si se está planeando el reparto de hoy, "mañana" si el de mañana.
    # El panel lo usa para no tener que repetir la lógica de la hora.
    para: str
    # Explicación lista para mostrar, para que nadie tenga que adivinar.
    explicacion: str


@router.get("/jornada", response=JornadaOut)
def get_jornada(request, reparto: date = None):
    """
    Qué día de entregas hay que planear AHORITA.

    Con `reparto` contesta otra pregunta: "quiero ver el reparto de ESTE día,
    ¿qué documentos le tocan?". Es lo que usa el selector de fecha del panel,
    que muestra el día en que SALE la mercancía —que es como piensa cualquiera—
    y no el día en que se capturó el documento, que es como está guardada.

    La regla de fondo: **la entrega capturada un día sale al siguiente**. Se
    surte y se captura de 6 am a 7 pm —el 99.9% antes de las 20:00, con picos a
    las 11-12 y a las 15-16— y el camión sale a la mañana siguiente entre las 7
    y las 10. Medido contra la base productiva; ver docs/flujo-documentos-sap.md.

    De ahí salen dos momentos distintos del día, y el panel tiene que abrir en
    el correcto o se ve vacío:

      ANTES de las 11  ->  el reparto de HOY todavía no sale o va saliendo.
                           Se planea con las entregas de AYER, que ya están
                           completas desde anoche.

      DESPUÉS de las 11 -> el reparto de hoy ya está en la calle. Lo que toca
                           preparar es MAÑANA, con las entregas que se están
                           capturando HOY.

    Antes esto siempre devolvía "ayer", y por la tarde eso ya no sirve: el
    despachador quiere adelantar el día siguiente y el panel le mostraba lo que
    ya se fue.

    El día se busca hacia atrás en vez de restar uno, porque el lunes hay que
    cargar el sábado y no el domingo.
    """
    ahora = timezone.localtime()
    hoy = ahora.date()

    if reparto is not None:
        # De qué día son los documentos de ESE reparto: el día hábil anterior.
        #
        # Antes esto buscaba hacia atrás "el último día que tuviera entregas", y
        # estaba mal: al pedir el reparto del 1-ago —que todavía no tiene nada
        # capturado— se iba hasta el 29-jul y mostraba los pedidos de ese día
        # como si fueran los del 1. Datos viejos presentados como si fueran del
        # día que se pidió, que es peor que no mostrar nada.
        #
        # Ahora es el día anterior y punto; si cae domingo se toma el sábado,
        # que es el único día sin captura. Si ese día no tiene entregas, se
        # devuelve 0 y se dice, en vez de rellenar con otra fecha.
        fecha_carga = reparto - timedelta(days=1)
        if fecha_carga.weekday() == 6:      # domingo
            fecha_carga -= timedelta(days=1)
        entregas = Remision.objects.reales().filter(doc_date=fecha_carga).count()
        return {
            "fecha_carga": fecha_carga.isoformat(),
            "fecha_reparto": reparto.isoformat(),
            "entregas": entregas,
            "para": "hoy" if reparto == hoy else ("mañana" if reparto == hoy + timedelta(days=1) else "otro"),
            "explicacion": (
                f"Reparto del {reparto:%d-%b} — son las entregas capturadas el "
                f"{fecha_carga:%d-%b}."
                if entregas else
                f"Todavía no hay entregas capturadas el {fecha_carga:%d-%b}, que "
                f"son las que saldrían el {reparto:%d-%b}."
            ),
        }

    preparando_mañana = ahora.hour >= HORA_CORTE_JORNADA

    if preparando_mañana:
        # Lo que se captura hoy sale mañana.
        fecha_carga = hoy
        fecha_reparto = hoy + timedelta(days=1)
        entregas = Remision.objects.reales().filter(doc_date=fecha_carga).count()
        explicacion = (
            f"Preparando MAÑANA {fecha_reparto:%d-%b}: son las entregas que se "
            f"están capturando hoy. Siguen llegando hasta las 7 de la noche."
        )
        return {
            "fecha_carga": fecha_carga.isoformat(),
            "fecha_reparto": fecha_reparto.isoformat(),
            "entregas": entregas,
            "para": "mañana",
            "explicacion": explicacion,
        }

    fecha_carga = None
    entregas = 0
    for dias in range(1, 8):
        candidata = hoy - timedelta(days=dias)
        n = Remision.objects.reales().filter(doc_date=candidata).count()
        if n:
            fecha_carga, entregas = candidata, n
            break

    if fecha_carga is None:
        # Nunca se ha sincronizado nada hacia atrás: que el panel abra en ayer
        # y el usuario sincronice. Mejor eso que abrir en hoy, que a esa hora
        # está vacío y hace pensar que el sistema falla.
        fecha_carga = hoy - timedelta(days=1)
        explicacion = (
            f"No hay entregas cargadas de los últimos 7 días. "
            f"Sincroniza {fecha_carga:%d-%b} para ver lo que sale hoy."
        )
    else:
        explicacion = (
            f"Entregas capturadas el {fecha_carga:%d-%b} — son las que salen "
            f"hoy {hoy:%d-%b}. Lo que se capture hoy sale mañana."
        )

    return {
        "fecha_carga": fecha_carga.isoformat(),
        "fecha_reparto": hoy.isoformat(),
        "entregas": entregas,
        "para": "hoy",
        "explicacion": explicacion,
    }

# 2b. Los pedidos de prueba YA NO SE EXPONEN POR LA API.
#
# Existía `POST /dispatcher/pedidos/cargar-prueba`, que borraba TODAS las rutas
# del día —incluidas las ya despachadas— y las reemplazaba con pedidos
# inventados. Como la API no pide autenticación, cualquiera con la dirección
# podía tumbar el día de trabajo, y el botón estaba a un clic en el panel.
#
# Se quitó ahora que SAP está conectado y hay datos reales con qué probar. La
# capacidad sigue disponible desde la consola, donde solo llega quien desarrolla:
#
#     python manage.py cargar_prueba --fecha 2026-07-25 --n 80
#
# 3. Optimizar Rutas usando OR-Tools
class GenerarRutasIn(Schema):
    fecha: date
    # Placas de los camiones que el despachador tiene ACTIVOS en el panel
    # (ej. ["RA7475A", "PP4873A"]). Antes esto era un simple conteo y el backend
    # tomaba los primeros N de una lista fija, así que apagar un camión y
    # prender otro planeaba con la capacidad del que se apagó.
    camiones: List[str]
    # Turno del chofer en horas para esta corrida. Default 6h (turno oficial);
    # el despachador puede ampliarlo (6.5h, 7h, 8h) cuando los pedidos no
    # caben — la jornada real medida con GPS llega a 6.7h promedio. Acotado a
    # 4-12h para evitar valores absurdos por error de captura.
    horas_turno: float = 6.0
    # Hora a la que sale el PRIMER camión ("HH:MM"). Default 09:00 = lo medido
    # con GPS (el primer camión de cada día sale 09:06 en promedio, 09:08 de
    # mediana). No es cosmética: las ventanas de recibo de los clientes se
    # miden desde aquí, y 97 de 195 destinos cierran antes de las 14:00, así
    # que ponerla más tarde de lo real tira pedidos que sí caben.
    hora_salida: str = "09:00"

@router.post("/rutas/generar")
def generar_rutas(request, payload: GenerarRutasIn):
    horas_turno = min(12.0, max(4.0, payload.horas_turno))
    try:
        datetime.strptime(payload.hora_salida, "%H:%M")
    except ValueError:
        return {"status": "error", "message": "Hora de salida inválida. Usa el formato HH:MM (ej. 09:30)."}
    if not payload.camiones:
        return {"status": "error", "message": "Activa al menos un camión antes de optimizar."}

    # Sin placas repetidas, conservando el orden. Si el panel manda la misma
    # placa dos veces (pasa al agregar a mano una que ya estaba en la lista) se
    # creaban DOS rutas del mismo camión el mismo día, y de ahí en adelante
    # nadie sabe cuál es la buena: la app del chofer tronaba y el manifiesto
    # mostraba media carga.
    payload.camiones = list(dict.fromkeys(payload.camiones))

    # Un camión agregado a mano desde el panel no está en la flota conocida:
    # entra a la corrida con capacidad y tope conservadores (fleet.py), pero se
    # avisa, porque el plan que salga para ese camión es una estimación.
    desconocidos = [p for p in payload.camiones if not fleet.datos(p)]

    res = solve_vrp(
        fecha=payload.fecha,
        placas=payload.camiones,
        depot_coords=DEPOT_COORDS,
        horas_turno=horas_turno,
        hora_salida=payload.hora_salida,
    )
    if desconocidos and res.get("status") == "success":
        res["message"] += (
            f" Ojo: {', '.join(desconocidos)} no está(n) en la flota registrada, "
            f"así que se planeó con capacidad estimada de {fleet.CAPACIDAD_KG_DESCONOCIDO} kg "
            f"y {fleet.MAX_PARADAS_DESCONOCIDO} paradas."
        )
    return res

# 4. Obtener rutas activas del día
@router.get("/rutas", response=List[RutaOut])
def get_rutas(request, fecha: date):
    rutas = Ruta.objects.filter(fecha=fecha)
    result = []
    for r in rutas:
        result.append({
            "id": r.id,
            "camion": r.camion,
            "chofer": r.chofer,
            "estado": r.estado,
            "pedidos_count": r.remisiones.count(),
            # Hora real en que el despachador dio "Salida" (botón En_Ruta), no
            # una hora teórica: null hasta que el camión de verdad se despache.
            "hora_salida": r.hora_salida.strftime("%H:%M") if r.hora_salida else None,
            "generada": timezone.localtime(r.creado_en).strftime("%H:%M") if r.creado_en else None,
        })
    return result

# 3b. "¿Qué hago para que quepan todos?"
#
# Corre el optimizador varias veces con una sola variable cambiada cada vez y
# devuelve cuántos pedidos entrarían en cada caso, ordenado por el que más
# ayuda. Ninguna corrida toca el plan real: se simulan y se deshacen.
#
# Se prueba una variable a la vez a propósito. Si se cambiaran dos juntas no se
# sabría cuál sirvió, y el despachador necesita saber QUÉ hacer, no solo que
# "algo" mejora.
class EscenariosIn(Schema):
    fecha: date
    camiones: List[str]
    horas_turno: float = 6.0
    hora_salida: str = "09:00"


# Segundos de solver por escenario. Corto porque se corren varios seguidos y lo
# que interesa es comparar cuántos pedidos caben, no exprimir cada ruta.
# Se acota al límite general del solver: si alguien lo baja (pruebas, máquina
# lenta), no tiene sentido que un escenario tarde más que una corrida completa.
SEGUNDOS_POR_ESCENARIO = min(6, SEGUNDOS_SOLVER)


@router.post("/rutas/escenarios")
def evaluar_escenarios(request, payload: EscenariosIn):
    if not payload.camiones:
        return {"status": "error", "message": "Activa al menos un camión."}

    payload.camiones = list(dict.fromkeys(payload.camiones))

    # Solo lo que este análisis puede mover: los pedidos que NO van ya en un
    # camión despachado. Antes se contaban TODAS las remisiones del día contra
    # un `base` que sí excluye las rutas congeladas, así que dos camiones en la
    # calle con 40 pedidos salían reportados como "40 sin asignar, hay que
    # acomodarlos a mano" cuando se estaban entregando en ese momento.
    total_pedidos = (
        Remision.objects.reales()
        .filter(doc_date=payload.fecha)
        .exclude(ruta__estado__in=ESTADOS_RUTA_DESPACHADA)
        .count()
    )

    def _cuantos_caben(camiones, horas, salida):
        res = solve_vrp(
            fecha=payload.fecha, placas=camiones, depot_coords=DEPOT_COORDS,
            horas_turno=horas, hora_salida=salida,
            simular=True, segundos_solver=SEGUNDOS_POR_ESCENARIO,
        )
        if res.get("status") != "success":
            return None
        return sum(r["pedidos"] for r in res.get("rutas", []))

    base = _cuantos_caben(payload.camiones, payload.horas_turno, payload.hora_salida)
    if base is None:
        return {"status": "error", "message": "No se pudo evaluar el plan actual."}

    opciones = []

    # 1. Salir más temprano. Es la palanca más fuerte medida (ver docs/flota.md)
    #    porque las ventanas de los clientes son horas de reloj fijas.
    hora_actual = datetime.strptime(payload.hora_salida, "%H:%M")
    if hora_actual.hour > 6:
        una_hora_antes = (hora_actual - timedelta(hours=1)).strftime("%H:%M")
        caben = _cuantos_caben(payload.camiones, payload.horas_turno, una_hora_antes)
        if caben is not None:
            opciones.append({
                "accion": "salir_antes",
                "titulo": f"Salir a las {una_hora_antes} en vez de {payload.hora_salida}",
                "detalle": "Cargar más rápido en el CEDIS para que el primer camión salga una hora antes.",
                "pedidos": caben,
                "dificultad": "Depende del almacén, no del sistema",
            })

    # 2. Más turno: el máximo posible. Si ni con el máximo mejora, tampoco
    #    mejoraría con un escalón intermedio, así que con una corrida basta.
    if payload.horas_turno < 8:
        caben = _cuantos_caben(payload.camiones, 8.0, payload.hora_salida)
        if caben is not None:
            opciones.append({
                "accion": "mas_turno",
                "valor": 8.0,
                "titulo": "Ampliar el turno a 8 horas",
                "detalle": f"Los choferes trabajarían {8 - payload.horas_turno:g} h más que hoy.",
                "pedidos": caben,
                "dificultad": "Hay que confirmarlo con los choferes",
            })

    # 3. Activar un camión más. Se prueba el de MAYOR capacidad de los apagados:
    #    si ese no ayuda, ninguno de los más chicos va a ayudar. Probar los tres
    #    triplicaba el tiempo de espera para dar casi la misma respuesta.
    apagados = [c for c in fleet.CAMIONES if c["placa"] not in payload.camiones]
    if apagados:
        mejor_apagado = max(apagados, key=lambda c: (c["capacidad_kg"], c["max_paradas"]))
        placa = mejor_apagado["placa"]
        caben = _cuantos_caben(payload.camiones + [placa], payload.horas_turno, payload.hora_salida)
        if caben is not None:
            otros = len(apagados) - 1
            opciones.append({
                "accion": "activar_camion",
                "valor": placa,
                "titulo": f"Activar el {placa}",
                "detalle": (
                    f"{mejor_apagado['modelo']}, {mejor_apagado['capacidad_kg']:,} kg, "
                    f"hasta {mejor_apagado['max_paradas']} paradas."
                    + (f" Hay {otros} camión(es) apagado(s) más." if otros else "")
                ),
                "pedidos": caben,
                "dificultad": "Requiere unidad y chofer disponibles",
            })

    # El "gana" es contra el plan actual. Se ordena por lo que más mete, y las
    # que no mejoran nada se marcan pero NO se esconden: saber que ampliar el
    # turno no sirve es tan útil como saber qué sí sirve.
    for o in opciones:
        o["gana"] = o["pedidos"] - base
    opciones.sort(key=lambda o: -o["gana"])

    mejor = opciones[0] if opciones and opciones[0]["gana"] > 0 else None
    sin_asignar = total_pedidos - base

    return {
        "status": "success",
        "total_pedidos": total_pedidos,
        "asignados_ahora": base,
        "sin_asignar": sin_asignar,
        "opciones": opciones,
        "recomendacion": (
            f"{mejor['titulo']}: mete {mejor['gana']} pedido(s) más." if mejor
            else "Ninguna de estas opciones mete más pedidos. Los que faltan hay que asignarlos a mano o moverlos a otro día."
        ),
    }


# 4a. La flota de reparto. El frontend la pide al abrir el panel en vez de
# mantener su propia copia de capacidades y topes de paradas, que era lo que
# obligaba a editar dos archivos en el mismo orden cada vez que se confirmaba un
# dato de un camión.
class CamionOut(Schema):
    placa: str
    samsara: str
    modelo: str
    anio: int
    capacidad_kg: int
    max_paradas: int
    activo_default: bool
    color: str

@router.get("/flota", response=List[CamionOut])
def get_flota(request):
    return fleet.CAMIONES

# 4b. Ubicación en vivo de los camiones ISUZU de reparto (GPS real vía Samsara).
# Solo lectura: si Samsara no está configurado o falla, regresa lista vacía en
# vez de romper el dispatcher.
class CamionGPSOut(Schema):
    placa: str
    nombre_samsara: str
    lat: float
    lng: float
    velocidad_kmh: float
    rumbo: Optional[float] = None
    ultima_actualizacion: Optional[str] = None
    direccion: str = ""

@router.get("/camiones/gps", response=List[CamionGPSOut])
def get_camiones_gps(request):
    return get_ubicaciones_isuzu()

# 5. Actualizar estado de despacho de una ruta
class RutaEstadoIn(Schema):
    estado: str

@router.patch("/rutas/{ruta_id}/estado")
def update_ruta_estado(request, ruta_id: int, payload: RutaEstadoIn):
    try:
        ruta = Ruta.objects.get(id=ruta_id)
    except Ruta.DoesNotExist:
        return {"status": "error", "message": "Ruta no encontrada"}

    permitidos = TRANSICIONES_VALIDAS.get(ruta.estado, [])
    if payload.estado not in permitidos:
        return {
            "status": "error",
            "message": f"No se puede pasar de '{ruta.estado}' a '{payload.estado}' directamente."
        }

    ruta.estado = payload.estado
    if payload.estado == 'En_Ruta':
        # localtime() y no datetime.now(): con USE_TZ=True `now()` da la hora
        # del SERVIDOR, que en cualquier hosting va en UTC. La salida de las
        # 09:00 se guardaría como 15:00 y de ahí saldrían mal TODAS las ETAs
        # que se recalculan abajo. En la compu de desarrollo no se nota porque
        # el reloj ya está en Monterrey.
        ruta.hora_salida = timezone.localtime().time()
    ruta.save()

    if payload.estado == 'En_Ruta':
        ruta.remisiones.update(estado='En_Camino')
        # La carga puede tardar horas: el plan del optimizador asumía una hora
        # de salida teórica. Al dar "Salida" se recalculan TODAS las ETAs de la
        # ruta desde la hora real de este momento, para que lo prometido a los
        # clientes/vendedoras corresponda a la realidad.
        n = recalcular_etas_desde_salida(ruta, DEPOT_COORDS)
        return {
            "status": "success",
            "message": f"Camión en ruta. ETAs recalculadas desde la hora real de salida ({n} pedidos).",
        }
    elif payload.estado == 'Finalizada':
        # Antes esto marcaba TODAS las remisiones como 'Entregado' de golpe, lo
        # que convertia el dato en "alguien cerro la ruta" y no en "se entrego".
        # Ahora solo toca las que el chofer no alcanzo a reportar, y las deja
        # como 'No_Entregado' con su motivo: si nadie confirmo la entrega, no
        # hay razon para suponer que ocurrio.
        sin_reportar = ruta.remisiones.exclude(
            estado__in=['Entregado', 'Entregado_Parcial', 'No_Entregado']
        )
        n = sin_reportar.count()
        if n:
            sin_reportar.update(estado='No_Entregado', motivo='otro',
                                observaciones='Se cerró la ruta sin que el chofer reportara esta parada.')
            return {
                "status": "success",
                "message": f"Ruta cerrada. {n} parada(s) quedaron sin confirmar y se marcaron como no entregadas.",
            }

    return {"status": "success", "message": f"Estado de ruta actualizado a {payload.estado}"}

# 6. Alertas reales del día: pedidos sin georreferencia o sin asignar a ninguna
# ruta. Sustituye cualquier lista de alertas fija — se calcula en vivo desde BD.
class AlertaOut(Schema):
    id: int
    doc_num: int
    card_name: str
    motivo: str

@router.get("/alertas", response=List[AlertaOut])
def get_alertas(request, fecha: date):
    remisiones = Remision.objects.reales().filter(doc_date=fecha, estado='Pendiente').select_related('destino')
    alertas = []
    for r in remisiones:
        sin_geo = not r.destino or r.destino.latitude is None or r.destino.longitude is None
        alertas.append({
            "id": r.id,
            "doc_num": r.doc_num,
            "card_name": r.card_name,
            "motivo": "Sin georreferencia en SAP B1" if sin_geo else "Pendiente de asignar a una ruta",
        })
    return alertas


# 7. Sugerir en qué camión conviene meter un pedido que quedó sin asignar.
# No modifica nada: solo calcula opciones para que el despachador decida.
@router.get("/remisiones/{remision_id}/sugerencias")
def get_sugerencias(request, remision_id: int):
    try:
        remision = Remision.objects.select_related('destino').get(id=remision_id)
    except Remision.DoesNotExist:
        return {"error": "Pedido no encontrado."}
    return sugerir_camiones_para_remision(remision, DEPOT_COORDS)

# 8. Asignar manualmente un pedido a una ruta específica. Si el pedido no cabe
# limpio (turno, peso o ventana de horario) regresa status='requiere_confirmacion'
# con el motivo; el despachador debe volver a llamar con forzar=true para
# confirmar que quiere meterlo de todos modos.
class AsignarManualIn(Schema):
    ruta_id: int
    posicion: Optional[int] = None
    forzar: bool = False

@router.post("/remisiones/{remision_id}/asignar")
def post_asignar_manual(request, remision_id: int, payload: AsignarManualIn):
    try:
        remision = Remision.objects.select_related('destino').get(id=remision_id)
    except Remision.DoesNotExist:
        return {"status": "error", "message": "Pedido no encontrado."}
    return asignar_manualmente(remision, payload.ruta_id, payload.posicion, payload.forzar)
