from ninja import NinjaAPI, Schema
from typing import List, Optional
from datetime import date, datetime
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

        # Ventana de recibo tal como está capturada, en 24 h. Si hay segunda
        # ventana se muestran las dos, porque son horarios distintos de verdad
        # (ej. cierra a mediodía y reabre en la tarde) y juntarlos en un solo
        # rango haría creer que recibe también en el hueco de en medio.
        ventana = None
        if r.destino and r.destino.ini_recibo_1 and r.destino.fin_recibo_1:
            ventana = f"{r.destino.ini_recibo_1:%H:%M} - {r.destino.fin_recibo_1:%H:%M}"
            if r.destino.ini_recibo_2 and r.destino.fin_recibo_2:
                ventana += f" y {r.destino.ini_recibo_2:%H:%M} - {r.destino.fin_recibo_2:%H:%M}"

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
            "ventana": ventana,
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
        })
    return result

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
