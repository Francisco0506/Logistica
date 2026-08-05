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
from ninja.errors import HttpError
from ninja.files import UploadedFile

from ..models import LineaRemision, Remision, Ruta
from .comun import _rango_eta, _texto_ventana

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
    # El nombre de la SUCURSAL (Ship-To de SAP), ej. "Pollo Loco Eloy Cavazos".
    # `card_name` es la razón social que factura ("Pollos Expo Guadalupe, S.A.
    # De C.V."), que casi nunca es el nombre pintado en el local — y es
    # justo lo que el chofer necesita para reconocer la puerta correcta
    # cuando el mismo cliente tiene varias sucursales en la ruta (pasa seguido:
    # Pollo Loco, Pizza Legacy y varios más reparten en más de un punto el
    # mismo día). Sin esto, dos paradas seguidas se veían con el MISMO título
    # ("Pollos Expo Guadalupe, S.A. De C.V.") y solo la calle las distinguía.
    ship_to_code: Optional[str] = None
    estado: str
    secuencia_ruta: Optional[int] = None
    address: str = ""
    ventana: Optional[str] = None
    eta: Optional[str] = None
    # La ETA como rango (±15 min). Es la que el chofer le dice al cliente por
    # teléfono, y una hora exacta ahí es una promesa que no se puede cumplir.
    eta_desde: Optional[str] = None
    eta_hasta: Optional[str] = None
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
    firma: Optional[str] = None


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
    # `.filter().first()` y no `.get()`: aunque desde el 4-ago `Ruta` ya tiene
    # `unique_together('fecha', 'camion')`, esa restricción no existía cuando
    # esto se escribió y ya se guardaron duplicados en producción, además de
    # que sigue habiendo una ventana entre que el solver arma el plan y guarda
    # la primera ruta. `.get()` ahí tronaba con un 500 de MultipleObjectsReturned
    # sin mensaje, en el peor momento: el chofer parado en la calle sin poder
    # ver su ruta.
    ruta = Ruta.objects.filter(fecha=fecha, camion=camion).order_by('id').first()
    if ruta is None:
        # HttpError y no `api.create_response`: `api` no existe en este módulo
        # (vive en __init__.py y importarlo haría un ciclo), así que la versión
        # anterior reventaba con NameError justo en el caso más común de la
        # mañana — el chofer abre su celular antes de que exista el plan y en
        # vez de "no tienes ruta" veía un 500.
        raise HttpError(404, f"El {camion} no tiene ruta para el {fecha}.")

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
            "ship_to_code": d.ship_to_code if d else None,
            "estado": r.estado,
            "secuencia_ruta": r.secuencia_ruta,
            "address": (d.street or "") if d else "",
            "ventana": _texto_ventana(d),
            "eta": r.eta,
            "eta_desde": _rango_eta(r.eta)[0],
            "eta_hasta": _rango_eta(r.eta)[1],
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
            "firma": r.firma.url if r.firma else None,
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

    # El camión tiene que HABER SALIDO para poder reportar una entrega.
    #
    # Esta regla existía solo en el navegador (`Driver/index.jsx`:
    # `puedeEntregar = ruta?.estado === 'En_Ruta'`), o sea que no existía: la API
    # no pide autenticación, así que un POST directo confirmaba la entrega de
    # cualquier parada, de cualquier ruta, con el camión todavía en el almacén.
    #
    # Importa más de lo que parece. Una entrega reportada sobre una ruta en
    # Borrador queda con `ruta` en Borrador, y la limpieza de sobrantes del sync
    # —que solo perdona las rutas ya despachadas— se la puede llevar junto con
    # su foto y su firma. La integridad de la evidencia no puede depender de un
    # `if` en el celular.
    if not remision.ruta or remision.ruta.estado != 'En_Ruta':
        return {
            "status": "error",
            "message": "Este camión todavía no sale del CEDIS. Pide que te den Salida en el almacén.",
        }

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

        if lineas:
            pedido_completo = all(l.completa for l in lineas.values())
            nada_entregado = all((l.cantidad_entregada or 0) == 0 for l in lineas.values())
        else:
            # Pedido sin renglones (SAP no mandó líneas). No hay cantidades de
            # dónde deducir el estado, así que lo dice el MOTIVO, que ya
            # distingue los dos casos:
            #
            #   cerrado / sin quién reciba / sin espacio -> no se bajó nada
            #   rechazo parcial / dañado / faltó         -> se entregó una parte
            #
            # Antes `nada_entregado` era False por construcción en esta rama, o
            # sea que un pedido sin líneas NUNCA podía llegar a 'No_Entregado':
            # el chofer marcaba "el cliente estaba cerrado" y el sistema lo
            # guardaba como 'Entregado_Parcial'. Para ventas y para facturación
            # eso es exactamente lo contrario de lo que pasó.
            pedido_completo = not payload.motivo
            nada_entregado = payload.motivo in Remision.MOTIVOS_SIN_ENTREGA

        # EL MOTIVO MANDA SOBRE LAS CANTIDADES, tenga renglones o no.
        #
        # "Estaba cerrado" y "no había quién recibiera" significan que el camión
        # no bajó nada, y eso no se discute con los números: si el cliente no
        # abrió, da igual lo que dijeran las cantidades.
        #
        # Sin esto el bug era de un solo toque y silencioso. El chofer llega, el
        # cliente está cerrado, marca "Estaba cerrado" y confirma SIN bajar las
        # cantidades —que es lo natural: no tocó la mercancía, no tiene por qué
        # moverle a los renglones, y además bajarlos a mano son 120 toques de
        # pie en la calle—. Como los renglones seguían completos, `all(l.completa)`
        # daba True y la entrega se guardaba como **'Entregado'**: ventas y
        # facturación veían entregada una mercancía que sigue arriba del camión.
        #
        # La regla ya existía y estaba bien escrita, pero solo se aplicaba en la
        # rama de los pedidos SIN renglones —que son los menos—. Aquí se saca de
        # las dos ramas para que valga siempre.
        if payload.motivo in Remision.MOTIVOS_SIN_ENTREGA:
            nada_entregado = True
            pedido_completo = False

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


@router.post("/paradas/{remision_id}/firma")
def subir_firma_entrega(request, remision_id: int, firma: UploadedFile = File(...)):
    """
    La firma de quien recibe, trazada con el dedo en la pantalla.

    Va aparte de la confirmación por la misma razón que la foto: es un archivo,
    y una falla al subirlo —con la señal de la calle pasa seguido— no debe
    tumbar la confirmación de la entrega, que es el dato que de verdad importa.

    Lo que llega es el PNG que el celular exporta del recuadro de firma. No se
    guardan los trazos punto por punto: lo que se va a necesitar después es
    ENSEÑAR la firma en una aclaración, no volver a dibujarla.
    """
    try:
        remision = Remision.objects.get(id=remision_id)
    except Remision.DoesNotExist:
        return {"status": "error", "message": "Ese pedido no existe."}

    remision.firma = firma
    remision.save(update_fields=['firma'])
    return {"status": "success", "url": remision.firma.url}
