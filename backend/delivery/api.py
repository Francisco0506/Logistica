from ninja import NinjaAPI, Schema
from typing import List, Optional
from datetime import date, datetime
from .models import Remision, Ruta, Destino
from .optimizer import solve_vrp, ESTADOS_RUTA_CONGELADOS, sugerir_camiones_para_remision, asignar_manualmente, CAPACIDAD_CAMION_KG_DEFAULT
from .sync import sync_from_sap

api = NinjaAPI(title="Laben Routing API", version="1.0.0")

# Capacidades promedio en KG por camión y coordenadas de salida del CEDIS.
# Únicas en todo el backend (frontend/src/config/fleet.js mantiene su propia
# copia de CEDIS solo para centrar el mapa, no para el cálculo de rutas).
# VALOR PROVISIONAL: se asume la capacidad del camión más chico de la flota
# (~3 toneladas de caja) para los 5 camiones, para no arriesgar sobrecarga
# real en los camiones que en verdad cargan menos. Actualizar en cuanto se
# confirmen las capacidades reales por camión (tarjeta de circulación).
CAPACIDADES_CAMION_KG = [3000, 3000, 3000, 3000, 3000]
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

# 3. Optimizar Rutas usando OR-Tools
class GenerarRutasIn(Schema):
    fecha: date
    numero_camiones: int

@api.post("/dispatcher/rutas/generar")
def generar_rutas(request, payload: GenerarRutasIn):
    # Si piden más camiones de los que hay capacidad configurada (ej. se agregó
    # un 6to camión desde el panel), se completa con el valor conservador por
    # default en vez de tronar — hasta que se confirme su capacidad real.
    vehicle_capacities = [
        CAPACIDADES_CAMION_KG[i] if i < len(CAPACIDADES_CAMION_KG) else CAPACIDAD_CAMION_KG_DEFAULT
        for i in range(payload.numero_camiones)
    ]

    res = solve_vrp(
        fecha=payload.fecha,
        num_vehicles=payload.numero_camiones,
        vehicle_capacities=vehicle_capacities,
        depot_coords=DEPOT_COORDS
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
            "pedidos_count": r.remisiones.count()
        })
    return result

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
