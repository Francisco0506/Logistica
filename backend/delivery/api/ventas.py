"""Panel del vendedor: sus pedidos y a qué hora llegan.

Cada vendedora ve SOLO sus pedidos, filtrados por el SlpCode que SAP
trae en cada remisión. Hoy el vendedor va como parámetro porque el
login no valida nada; cuando haya usuarios debe salir de la sesión.
"""
from datetime import date
from typing import List, Optional

from django.db.models import Count
from ninja import Router, Schema

from ..models import Remision
from .comun import _rango_eta, _texto_ventana

router = Router()

class VendedorOut(Schema):
    slp_code: str
    slp_name: str
    pedidos: int


@router.get("/vendedores", response=List[VendedorOut])
def get_vendedores(request, fecha: date):
    """Vendedores que tienen pedidos ese día, para el selector del panel."""
    filas = (
        Remision.objects.reales().filter(doc_date=fecha)
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
    # ── Lo que el chofer reportó desde la calle ──
    # Solo viene cuando la entrega ya se confirmó. Es lo que la vendedora
    # necesita para contestarle al cliente qué le faltó y por qué, sin tener
    # que llamarle al chofer.
    entregado_en: Optional[str] = None
    motivo: Optional[str] = None
    motivo_texto: Optional[str] = None
    observaciones: Optional[str] = None
    recibio: Optional[str] = None
    faltantes: List[str] = []
    foto: Optional[str] = None
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


@router.get("/pedidos", response=List[PedidoVentasOut])
def get_pedidos_vendedor(request, fecha: date, slp_code: str):
    remisiones = (
        Remision.objects.reales().filter(doc_date=fecha, slp_code=slp_code)
        .select_related('destino', 'ruta')
        .prefetch_related('lineas')
        .order_by('eta', 'doc_num')
    )

    # Avance de cada ruta del día, para poder decir cuántas paradas van antes
    # de un pedido y cuántas de esas ya se entregaron. Se consultan las rutas
    # completas (no solo los pedidos de esta vendedora) porque el camión entrega
    # de todo en el camino, no nada más lo de ella.
    rutas_del_dia = {}
    for r in Remision.objects.reales().filter(doc_date=fecha, ruta__isnull=False).values(
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

        # Qué renglones quedaron cortos, en palabras: "2 de 3 Queso manchego".
        # Se arma aquí y no en el frontend porque es la misma frase que va a
        # necesitar cualquier otra pantalla que muestre una entrega incompleta.
        faltantes = []
        if r.estado in ('Entregado_Parcial', 'No_Entregado'):
            for l in r.lineas.all():
                dejado = float(l.cantidad_entregada) if l.cantidad_entregada is not None else 0
                pedido_ = float(l.cantidad)
                if dejado < pedido_:
                    unidad = f" {l.unidad}" if l.unidad else ""
                    faltantes.append(
                        f"{dejado:g} de {pedido_:g}{unidad} · {l.descripcion}"
                    )

        # La situación dice qué está pasando Y por qué, para que la vendedora
        # pueda contestarle al cliente sin preguntarle a nadie más.
        hora_entrega = timezone.localtime(r.entregado_en).strftime("%H:%M") if r.entregado_en else None

        if r.estado == 'Entregado_Parcial':
            situacion = (
                f"Entregado incompleto a las {hora_entrega}: faltaron {len(faltantes)} producto(s)"
                if hora_entrega else "Entregado incompleto"
            )
        elif r.estado == 'No_Entregado':
            situacion = f"NO se pudo entregar" + (f" (se reportó a las {hora_entrega})" if hora_entrega else "")
        elif r.estado == 'Entregado':
            situacion = f"Entregado completo a las {hora_entrega}" if hora_entrega else "Entregado"
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
            "entregado_en": hora_entrega,
            "motivo": r.motivo,
            "motivo_texto": dict(Remision.MOTIVOS).get(r.motivo),
            "observaciones": r.observaciones,
            "recibio": r.recibio,
            "faltantes": faltantes,
            "foto": r.foto.url if r.foto else None,
        })
    return resultado
