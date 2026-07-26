from ninja import NinjaAPI, Schema
from typing import List, Optional
from datetime import date, datetime, timedelta
from django.db.models import Count
from django.utils import timezone
from . import fleet
from .models import Remision, Ruta
from .optimizer import (
    solve_vrp, sugerir_camiones_para_remision, asignar_manualmente,
    recalcular_etas_desde_salida,
)
from .sync import sync_from_sap
from .test_data import cargar_pedidos_prueba
from .samsara_service import get_ubicaciones_isuzu

api = NinjaAPI(title="Laben Routing API", version="1.0.0")

# La flota (placas, capacidades, topes de paradas) y el CEDIS viven en fleet.py,
# que es la única fuente de verdad y la que el frontend consume por API.
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

class RemisionOut(Schema):
    id: int
    doc_num: int
    card_name: str
    estado: str
    ship_to_code: str
    doc_total: float
    eta: str = "Pendiente"
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
@api.get("/dispatcher/remisiones", response=List[RemisionOut])
def get_remisiones(request, fecha: date):
    remisiones = Remision.objects.filter(doc_date=fecha).select_related('destino', 'ruta')
    
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
            "eta": r.eta if r.eta else "Pendiente",
            "lat": lat,
            "lng": lng,
            "truck": r.ruta.camion if r.ruta else None,
            "secuencia_ruta": r.secuencia_ruta,
            "peso_kg": r.peso_kg,
            "ventana": _texto_ventana(r.destino),
        })
    return result

# 2. Sincronizar pedidos de SAP
@api.post("/dispatcher/sync")
def sync_sap(request, fecha: date):
    res = sync_from_sap(fecha)
    return res

# 2b. Cargar pedidos de prueba (solo para probar el optimizador sin depender
# de SAP) con destinos reales ya importados. ADVERTENCIA: borra las rutas que
# hubiera ese día, incluidas las ya despachadas — el frontend debe confirmar
# con el usuario antes de llamar esto.
class CargarPruebaIn(Schema):
    fecha: date
    n: int = 80

@api.post("/dispatcher/pedidos/cargar-prueba")
def cargar_prueba_endpoint(request, payload: CargarPruebaIn):
    return cargar_pedidos_prueba(payload.fecha, payload.n)

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

@api.post("/dispatcher/rutas/generar")
def generar_rutas(request, payload: GenerarRutasIn):
    horas_turno = min(12.0, max(4.0, payload.horas_turno))
    try:
        datetime.strptime(payload.hora_salida, "%H:%M")
    except ValueError:
        return {"status": "error", "message": "Hora de salida inválida. Usa el formato HH:MM (ej. 09:30)."}
    if not payload.camiones:
        return {"status": "error", "message": "Activa al menos un camión antes de optimizar."}

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
@api.get("/dispatcher/rutas", response=List[RutaOut])
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
SEGUNDOS_POR_ESCENARIO = 6


@api.post("/dispatcher/rutas/escenarios")
def evaluar_escenarios(request, payload: EscenariosIn):
    if not payload.camiones:
        return {"status": "error", "message": "Activa al menos un camión."}

    total_pedidos = Remision.objects.filter(doc_date=payload.fecha).count()

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

@api.get("/dispatcher/flota", response=List[CamionOut])
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

@api.get("/dispatcher/camiones/gps", response=List[CamionGPSOut])
def get_camiones_gps(request):
    return get_ubicaciones_isuzu()

# 5. Actualizar estado de despacho de una ruta
class RutaEstadoIn(Schema):
    estado: str

@api.patch("/dispatcher/rutas/{ruta_id}/estado")
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
        ruta.hora_salida = datetime.now().time()
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
        ruta.remisiones.update(estado='Entregado')

    return {"status": "success", "message": f"Estado de ruta actualizado a {payload.estado}"}

# 6. Alertas reales del día: pedidos sin georreferencia o sin asignar a ninguna
# ruta. Sustituye cualquier lista de alertas fija — se calcula en vivo desde BD.
class AlertaOut(Schema):
    id: int
    doc_num: int
    card_name: str
    motivo: str

@api.get("/dispatcher/alertas", response=List[AlertaOut])
def get_alertas(request, fecha: date):
    remisiones = Remision.objects.filter(doc_date=fecha, estado='Pendiente').select_related('destino')
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

# ══════════════════════════════════════════════════════════════════════════
# PANEL DE VENDEDOR
# ══════════════════════════════════════════════════════════════════════════
# Cada vendedora ve SOLO sus pedidos, filtrados por el SlpCode que SAP ya trae
# en cada remisión (sync.py los guarda en slp_code/slp_name).
#
# Hoy el vendedor se manda como parámetro porque el login todavía no valida
# nada: es un selector de rol. Cuando haya usuarios de verdad, el SlpCode debe
# salir del usuario de la sesión y NO del parámetro, o cualquiera podría pedir
# los pedidos de otra vendedora cambiando la URL. Está anotado en
# docs/pendientes.md §5.

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


class VendedorOut(Schema):
    slp_code: str
    slp_name: str
    pedidos: int


@api.get("/ventas/vendedores", response=List[VendedorOut])
def get_vendedores(request, fecha: date):
    """Vendedores que tienen pedidos ese día, para el selector del panel."""
    filas = (
        Remision.objects.filter(doc_date=fecha)
        .values('slp_code', 'slp_name')
        .annotate(pedidos=Count('id'))
        .order_by('slp_name')
    )
    return list(filas)


class PedidoVentasOut(Schema):
    id: int
    doc_num: int
    card_name: str
    estado: str
    doc_total: float
    address: str = ""
    ventana: Optional[str] = None
    eta_desde: Optional[str] = None
    eta_hasta: Optional[str] = None
    camion: Optional[str] = None
    # Para ubicar el pedido en el mapa del panel de ventas. `null` cuando SAP no
    # trae la coordenada del cliente — en ese caso el pedido tampoco se puede
    # rutear, y la situación ya lo explica.
    lat: Optional[float] = None
    lng: Optional[float] = None
    # En qué número de parada va este pedido dentro de su ruta.
    posicion: Optional[int] = None
    # Cuántas paradas van ANTES que ésta, y cuántas de esas ya se entregaron.
    # Es la pregunta que hace una vendedora cuando el cliente llama: no "¿a qué
    # hora llega?" sino "¿ya mero?". Con esto se contesta con un hecho —el
    # camión ya hizo 3 de las 8 que van antes— y no con una hora estimada.
    paradas_antes: Optional[int] = None
    entregadas_antes: Optional[int] = None
    # Explicación en lenguaje de vendedora de qué está pasando con su pedido.
    situacion: str
    # True cuando el pedido ya tiene lugar en una ruta del día.
    programado: bool


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


@api.get("/ventas/pedidos", response=List[PedidoVentasOut])
def get_pedidos_vendedor(request, fecha: date, slp_code: str):
    remisiones = (
        Remision.objects.filter(doc_date=fecha, slp_code=slp_code)
        .select_related('destino', 'ruta')
        .order_by('eta', 'doc_num')
    )

    # Avance de cada ruta del día, para poder decir cuántas paradas van antes
    # de un pedido y cuántas de esas ya se entregaron. Se consultan las rutas
    # completas (no solo los pedidos de esta vendedora) porque el camión entrega
    # de todo en el camino, no nada más lo de ella.
    rutas_del_dia = {}
    for r in Remision.objects.filter(doc_date=fecha, ruta__isnull=False).values(
        'ruta_id', 'secuencia_ruta', 'estado'
    ):
        rutas_del_dia.setdefault(r['ruta_id'], []).append(r)

    resultado = []
    for r in remisiones:
        eta_desde, eta_hasta = _rango_eta(r.eta)
        sin_geo = not r.destino or r.destino.latitude is None or r.destino.longitude is None
        camion = r.ruta.camion if r.ruta else None

        # Cuántas paradas van antes de ésta en su ruta, y cuántas ya se
        # entregaron. Las paradas se cuentan por secuencia distinta: varios
        # documentos al mismo lugar son UNA parada, así que contar documentos
        # inflaría el número que se le dice al cliente.
        antes = entregadas = None
        if r.ruta_id and r.secuencia_ruta:
            companeros = rutas_del_dia.get(r.ruta_id, [])
            secuencias_antes = {
                c['secuencia_ruta'] for c in companeros
                if c['secuencia_ruta'] and c['secuencia_ruta'] < r.secuencia_ruta
            }
            antes = len(secuencias_antes)
            entregadas = len({
                c['secuencia_ruta'] for c in companeros
                if c['secuencia_ruta'] in secuencias_antes and c['estado'] == 'Entregado'
            })

        # La situación dice qué está pasando Y por qué, para que la vendedora
        # pueda contestarle al cliente sin preguntarle a nadie más.
        if r.estado == 'Entregado':
            situacion = "Entregado"
        elif r.estado == 'En_Camino':
            situacion = (
                f"En camino en el {camion}, llega entre {eta_desde} y {eta_hasta}"
                if eta_desde else f"En camino en el {camion}"
            )
        elif r.estado == 'Asignado' and camion:
            situacion = (
                f"Programado en el {camion}, llega entre {eta_desde} y {eta_hasta}"
                if eta_desde else f"Programado en el {camion}, falta calcular la hora"
            )
        elif sin_geo:
            situacion = "No se puede programar: al cliente le falta la ubicación en SAP"
        else:
            situacion = "Todavía no entra en ninguna ruta de hoy"

        resultado.append({
            "id": r.id,
            "doc_num": r.doc_num,
            "card_name": r.card_name,
            "estado": r.estado,
            "doc_total": float(r.doc_total),
            "address": r.destino.street if r.destino and r.destino.street else "",
            "ventana": _texto_ventana(r.destino),
            "eta_desde": eta_desde,
            "eta_hasta": eta_hasta,
            "camion": camion,
            "situacion": situacion,
            "programado": bool(camion),
            "lat": None if sin_geo else r.destino.latitude,
            "lng": None if sin_geo else r.destino.longitude,
            "posicion": r.secuencia_ruta,
            "paradas_antes": antes,
            "entregadas_antes": entregadas,
        })
    return resultado


# 7. Sugerir en qué camión conviene meter un pedido que quedó sin asignar.
# No modifica nada: solo calcula opciones para que el despachador decida.
@api.get("/dispatcher/remisiones/{remision_id}/sugerencias")
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

@api.post("/dispatcher/remisiones/{remision_id}/asignar")
def post_asignar_manual(request, remision_id: int, payload: AsignarManualIn):
    try:
        remision = Remision.objects.select_related('destino').get(id=remision_id)
    except Remision.DoesNotExist:
        return {"status": "error", "message": "Pedido no encontrado."}
    return asignar_manualmente(remision, payload.ruta_id, payload.posicion, payload.forzar)
