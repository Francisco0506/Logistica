"""App del chofer: sus paradas en orden y qué dejó en cada una.

Es la única pieza que le dice al sistema qué pasó de verdad en la
calle: sin ella, 'Entregado' solo significa que alguien en la oficina
cerró la ruta.
"""
from datetime import date
from typing import List, Optional

from django.db import transaction
from django.utils import timezone
from ninja import File, Router, Schema
from ninja.files import UploadedFile

from ..models import LineaRemision, Remision, Ruta
from .comun import _texto_ventana

router = Router()

class LineaOut(Schema):
    id: int
    item_code: str
    descripcion: str
    unidad: Optional[str] = None
    cantidad: float
    cantidad_entregada: Optional[float] = None


class ParadaChoferOut(Schema):
    id: int
    doc_num: int
    card_name: str
    estado: str
    secuencia_ruta: Optional[int] = None
    address: str = ""
    ventana: Optional[str] = None
    eta: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    telefono: Optional[str] = None
    contacto: Optional[str] = None
    referencias: Optional[str] = None
    lineas: List[LineaOut] = []
    # Lo que ya se reportó, si es que se reportó.
    motivo: Optional[str] = None
    observaciones: Optional[str] = None
    recibio: Optional[str] = None
    entregado_en: Optional[str] = None
    foto: Optional[str] = None


class RutaChoferOut(Schema):
    ruta_id: int
    camion: str
    chofer: str
    estado: str
    hora_salida: Optional[str] = None
    paradas: List[ParadaChoferOut]


@router.get("/ruta", response=RutaChoferOut)
def get_ruta_chofer(request, fecha: date, camion: str):
    """
    La ruta del día de UN camión, con todo lo que el chofer necesita en la calle.

    Va por camión y no por chofer porque hoy el sistema no sabe quién maneja qué
    (ver docs/pendientes.md §1). Cuando haya usuarios de chofer, la placa saldrá
    de su sesión.
    """
    try:
        ruta = Ruta.objects.get(fecha=fecha, camion=camion)
    except Ruta.DoesNotExist:
        return api.create_response(
            request,
            {"detail": f"El {camion} no tiene ruta para el {fecha}."},
            status=404,
        )

    remisiones = (
        ruta.remisiones.select_related('destino')
        .prefetch_related('lineas')
        .order_by('secuencia_ruta', 'doc_num')
    )

    paradas = []
    for r in remisiones:
        d = r.destino
        paradas.append({
            "id": r.id,
            "doc_num": r.doc_num,
            "card_name": r.card_name,
            "estado": r.estado,
            "secuencia_ruta": r.secuencia_ruta,
            "address": (d.street or "") if d else "",
            "ventana": _texto_ventana(d),
            "eta": r.eta,
            "lat": d.latitude if d else None,
            "lng": d.longitude if d else None,
            "telefono": d.telefono if d else None,
            "contacto": d.contacto if d else None,
            "referencias": d.referencias if d else None,
            "lineas": [
                {
                    "id": l.id,
                    "item_code": l.item_code,
                    "descripcion": l.descripcion,
                    "unidad": l.unidad,
                    "cantidad": float(l.cantidad),
                    "cantidad_entregada": float(l.cantidad_entregada) if l.cantidad_entregada is not None else None,
                }
                for l in r.lineas.all()
            ],
            "motivo": r.motivo,
            "observaciones": r.observaciones,
            "recibio": r.recibio,
            "entregado_en": timezone.localtime(r.entregado_en).strftime("%H:%M") if r.entregado_en else None,
            "foto": r.foto.url if r.foto else None,
        })

    return {
        "ruta_id": ruta.id,
        "camion": ruta.camion,
        "chofer": ruta.chofer,
        "estado": ruta.estado,
        "hora_salida": ruta.hora_salida.strftime("%H:%M") if ruta.hora_salida else None,
        "paradas": paradas,
    }


class LineaEntregadaIn(Schema):
    linea_id: int
    cantidad_entregada: float


class ConfirmarEntregaIn(Schema):
    # Qué se dejó de cada renglón. Si viene vacío se entiende que se entregó
    # todo completo, que es el caso normal y no debería costar trabajo.
    lineas: List[LineaEntregadaIn] = []
    motivo: Optional[str] = None
    observaciones: Optional[str] = None
    recibio: Optional[str] = None


@router.post("/paradas/{remision_id}/entregar")
def confirmar_entrega(request, remision_id: int, payload: ConfirmarEntregaIn):
    """
    El chofer confirma qué dejó en una parada.

    El estado NO se manda desde el celular: se DEDUCE de las cantidades. Si se
    dejó todo, es 'Entregado'; si se dejó algo, 'Entregado_Parcial'; si no se
    dejó nada, 'No_Entregado'. Así no puede quedar un pedido marcado como
    entregado completo con renglones a medias, que es justo el error que haría
    inútil el dato para facturación.
    """
    try:
        remision = Remision.objects.prefetch_related('lineas').get(id=remision_id)
    except Remision.DoesNotExist:
        return {"status": "error", "message": "Ese pedido no existe."}

    with transaction.atomic():
        lineas = {l.id: l for l in remision.lineas.all()}

        if payload.lineas:
            for entrada in payload.lineas:
                linea = lineas.get(entrada.linea_id)
                if not linea:
                    continue
                # Acotado entre 0 y lo que traía: no se puede entregar de más.
                linea.cantidad_entregada = max(0, min(entrada.cantidad_entregada, float(linea.cantidad)))
            LineaRemision.objects.bulk_update(lineas.values(), ['cantidad_entregada'])
        else:
            # Sin detalle = todo completo.
            for linea in lineas.values():
                linea.cantidad_entregada = linea.cantidad
            LineaRemision.objects.bulk_update(lineas.values(), ['cantidad_entregada'])

        pedido_completo = all(l.completa for l in lineas.values()) if lineas else not payload.motivo
        nada_entregado = (
            all((l.cantidad_entregada or 0) == 0 for l in lineas.values()) if lineas
            else False
        )

        if nada_entregado:
            remision.estado = 'No_Entregado'
        elif pedido_completo:
            remision.estado = 'Entregado'
        else:
            remision.estado = 'Entregado_Parcial'

        remision.entregado_en = timezone.now()
        remision.motivo = payload.motivo or None
        remision.observaciones = (payload.observaciones or "").strip() or None
        remision.recibio = (payload.recibio or "").strip() or None
        remision.save(update_fields=[
            'estado', 'entregado_en', 'motivo', 'observaciones', 'recibio',
        ])

    return {
        "status": "success",
        "estado": remision.estado,
        "message": {
            'Entregado': f"Pedido #{remision.doc_num} entregado completo.",
            'Entregado_Parcial': f"Pedido #{remision.doc_num} entregado incompleto.",
            'No_Entregado': f"Pedido #{remision.doc_num} marcado como no entregado.",
        }[remision.estado],
    }


@router.post("/paradas/{remision_id}/foto")
def subir_foto_entrega(request, remision_id: int, foto: UploadedFile = File(...)):
    """
    La foto de evidencia de la entrega.

    Va aparte de la confirmación porque es un archivo y no cabe en el mismo
    JSON, y porque conviene que una falla al subir la imagen —que en la calle
    pasa seguido, con mala señal— NO tire la confirmación de la entrega, que es
    el dato importante.
    """
    try:
        remision = Remision.objects.get(id=remision_id)
    except Remision.DoesNotExist:
        return {"status": "error", "message": "Ese pedido no existe."}

    remision.foto = foto
    remision.save(update_fields=['foto'])
    return {"status": "success", "url": remision.foto.url}
