from ninja import NinjaAPI, Schema
from typing import List, Optional
from datetime import date
from .models import Remision, Ruta, Destino
from .optimizer import solve_vrp
from .sync import sync_from_sap

api = NinjaAPI(title="Laben Routing API", version="1.0.0")

class RemisionOut(Schema):
    id: int
    doc_num: int
    card_name: str
    estado: str
    ship_to_code: str
    doc_total: float
    window: str = "09:00 - 12:00"
    eta: str = "09:30 AM"
    lat: Optional[float] = None
    lng: Optional[float] = None
    truck: Optional[str] = None

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
            "lat": lat,
            "lng": lng,
            "truck": r.ruta.camion if r.ruta else None
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
    # Capacidades promedio en KG por camión
    capacities = [3500, 3500, 3000, 2500, 2500]
    vehicle_capacities = capacities[:payload.numero_camiones]
    
    # Coordenadas de salida del CEDIS (exactas de Norberto)
    depot_coords = (25.693214524592616, -100.48167993202988)

    res = solve_vrp(
        fecha=payload.fecha,
        num_vehicles=payload.numero_camiones,
        vehicle_capacities=vehicle_capacities,
        depot_coords=depot_coords
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
