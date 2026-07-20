from ninja import NinjaAPI, Schema
from typing import List, Optional
from datetime import date, datetime
from .models import Remision, Ruta
from .optimizer import (
    solve_vrp, sugerir_camiones_para_remision, asignar_manualmente,
    recalcular_etas_desde_salida, CAPACIDAD_CAMION_KG_DEFAULT,
    MAX_PARADAS_POR_RUTA_DEFAULT,
)
from .sync import sync_from_sap
from .test_data import cargar_pedidos_prueba
from .samsara_service import get_ubicaciones_isuzu

api = NinjaAPI(title="Laben Routing API", version="1.0.0")

# Capacidades promedio en KG por camión y coordenadas de salida del CEDIS.
# Únicas en todo el backend (frontend/src/config/fleet.js mantiene su propia
# copia de CEDIS solo para centrar el mapa, no para el cálculo de rutas).
# Orden = mismo orden que FLEET/ID_TO_PLATE en fleet.js (T-001..T-008 = los 8
# camiones ISUZU de reparto reales: 012, 013, 015, 016, 017, 023, 024, 027).
# Capacidad de carga útil por camión, según la ficha técnica de Isuzu México
# para el modelo EXACTO de cada unidad. El modelo sale del VIN que reporta
# Samsara (en los VIN no se usa la letra Q, por eso NQR aparece como "N1R"):
#   NLR -> ELF 100         = 1,500 kg
#   NKR -> ELF 200         = 2,000 kg
#   NPR -> ELF 400/500     = 3,500 kg (rango 3,000-5,000; se toma el bajo para
#                            no arriesgar sobrecarga hasta confirmar la caja)
#   NQR -> ELF 600         = 6,000 kg
# Pendiente afinar con la tarjeta de circulación de cada unidad — al hacerlo se
# actualiza esta lista y FLEET en frontend/src/config/fleet.js (mismo orden).
# Orden = ranking de uso real (km GPS Samsara 60 días, ver docs/flota.md): el
# optimizador usa primero los camiones que de verdad operan.
CAPACIDADES_CAMION_KG = [
    6000,  # T-001 = 027 RA7475A  NQR / ELF 600     2022  (el más usado)
    3500,  # T-002 = 023 PP4873A  NPR / ELF 400/500 2020
    6000,  # T-003 = 017 PR6889B  NQR / ELF 600     2017
    2000,  # T-004 = 016 RJ97892  NKR / ELF 200     2016
    1500,  # T-005 = 013 RJ37663  NLR / ELF 100     2015
    3500,  # T-006 = 024 PP4872A  NPR / ELF 400/500 2018  (parado desde 14-jul)
    2000,  # T-007 = 015 RJ57620  NKR / ELF 200     2016  (2 meses sin operar)
    3500,  # T-008 = 012 RH83800  NPR / ELF 400/500 2014  (2 meses sin operar)
]

# Tope de paradas por ruta, medido con GPS: es el máximo de entregas que cada
# camión ha hecho realmente en un día. Sirve de tope práctico mientras SAP no
# mande el peso real de cada pedido (sin SAP, la restricción de kilos usa un
# peso estimado y no es confiable; las paradas sí están medidas).
MAX_PARADAS_POR_CAMION = [
    29,  # T-001 = 027 (promedio 16.6/día)
    30,  # T-002 = 023 (promedio 17.9/día; llegó a 38 en una jornada de 12.9 h)
    24,  # T-003 = 017 (promedio 11.8/día)
    29,  # T-004 = 016 (promedio 18.0/día)
    19,  # T-005 = 013 (promedio 11.9/día)
    25,  # T-006 = 024 (sin datos suficientes: se usa el típico de su tamaño)
    25,  # T-007 = 015 (sin datos)
    25,  # T-008 = 012 (sin datos)
]
DEPOT_COORDS = (25.693214524592616, -100.48167993202988)

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
    window: str = "09:00 - 12:00"
    eta: str = "09:30 AM"
    address: str = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    truck: Optional[str] = None
    secuencia_ruta: Optional[int] = None

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
    numero_camiones: int
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
    # Si piden más camiones de los que hay capacidad configurada (ej. se agregó
    # un 6to camión desde el panel), se completa con el valor conservador por
    # default en vez de tronar — hasta que se confirme su capacidad real.
    vehicle_capacities = [
        CAPACIDADES_CAMION_KG[i] if i < len(CAPACIDADES_CAMION_KG) else CAPACIDAD_CAMION_KG_DEFAULT
        for i in range(payload.numero_camiones)
    ]
    max_paradas = [
        MAX_PARADAS_POR_CAMION[i] if i < len(MAX_PARADAS_POR_CAMION) else MAX_PARADAS_POR_RUTA_DEFAULT
        for i in range(payload.numero_camiones)
    ]

    res = solve_vrp(
        fecha=payload.fecha,
        num_vehicles=payload.numero_camiones,
        vehicle_capacities=vehicle_capacities,
        max_paradas=max_paradas,
        depot_coords=DEPOT_COORDS,
        horas_turno=horas_turno,
        hora_salida=payload.hora_salida,
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
            "hora_salida": r.hora_salida.strftime("%I:%M %p") if r.hora_salida else None,
        })
    return result

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
