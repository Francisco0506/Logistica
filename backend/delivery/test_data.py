import random

from django.db.models import Q

from .models import Destino, Remision, Ruta, LineaRemision


def cargar_pedidos_prueba(fecha, n, solo_locales=True):
    """
    Carga N pedidos de prueba (con destinos reales ya importados del Excel de
    SAP) para una fecha dada, para poder correr el optimizador contra datos
    reales sin depender de la conexión a SAP.

    Usado tanto por el comando de management `cargar_prueba` (para pruebas
    desde terminal) como por el endpoint /dispatcher/pedidos/cargar-prueba
    (para pruebas desde el panel del dispatcher), para no duplicar esta lógica
    en dos lugares.

    ADVERTENCIA: borra TODAS las rutas de ese día (incluidas las ya
    despachadas) antes de crear los pedidos de prueba, para dejar el día en un
    estado limpio y reproducible. Quien llame a esto debe confirmar con el
    usuario antes si ya había despachos reales en curso para esa fecha.
    """
    # Nunca mezclar con el mock hardcodeado de sync.py (load_mock_data usa
    # direcciones "Calle Falsa #..." y card_code "C-19XX") aunque haya
    # quedado pegado en la tabla Destino de una sincronización vieja.
    destinos = Destino.objects.exclude(street__startswith="Calle Falsa")
    if solo_locales:
        destinos = destinos.filter(
            Q(latitude__range=(25.3, 26.0)) & Q(longitude__range=(-100.8, -100.0))
        )
    destinos = list(destinos)

    if not destinos:
        return {
            "status": "error",
            "message": "No hay destinos importados todavía. Corre primero la importación del Excel de SAP.",
        }

    random.seed(fecha.toordinal())  # reproducible: misma fecha -> mismos pedidos
    random.shuffle(destinos)

    Ruta.objects.filter(fecha=fecha).delete()
    Remision.objects.filter(doc_date=fecha, slp_name="PRUEBA_TEMPORAL").delete()

    # Productos de mentiras pero verosímiles, para poder probar la app del
    # chofer sin SAP: lo que importa es que haya renglones con cantidades y
    # unidades distintas, que es lo que el chofer tiene que ajustar cuando una
    # entrega sale incompleta.
    CATALOGO = [
        ("QUE-RALL-1K", "Queso rallado bolsa 1 kg", "BOLSA"),
        ("QUE-MANCH-3K", "Queso manchego bloque 3 kg", "PZA"),
        ("JAM-PIERNA-4K", "Jamón de pierna 4 kg", "PZA"),
        ("PEP-REB-500G", "Pepperoni rebanado 500 g", "BOLSA"),
        ("SAL-TOM-10K", "Salsa de tomate cubeta 10 kg", "CUBETA"),
        ("HAR-PIZ-25K", "Harina para pizza saco 25 kg", "SACO"),
        ("ACE-OLI-5L", "Aceite de oliva 5 L", "BIDON"),
        ("CHA-CHED-2K", "Cheddar en rebanadas 2 kg", "CAJA"),
    ]

    base_doc_entry = 8_500_000
    for i in range(n):
        d = destinos[i % len(destinos)]
        doc = base_doc_entry + i
        Remision.objects.update_or_create(
            doc_entry=doc,
            defaults={
                "doc_num": doc,
                "card_code": d.card_code,
                "card_name": d.ship_to_code or "Cliente de prueba",
                "doc_date": fecha,
                "doc_total": random.randint(3000, 40000),
                "slp_code": "99",
                "slp_name": "PRUEBA_TEMPORAL",
                "destino": d,
                "peso_kg": round(random.uniform(20, 200), 1),
                "estado": "Pendiente",
                # Los folios de prueba se reciclan entre fechas: hay que soltar
                # la ruta/secuencia/ETA de la corrida anterior o el pedido queda
                # pegado a una ruta de otro día (con su ETA vieja).
                "ruta": None,
                "secuencia_ruta": None,
                "eta": None,
                # Se limpia también lo que hubiera reportado el chofer en una
                # corrida anterior: los folios de prueba se reciclan entre
                # fechas y si no, el pedido "nuevo" nacería ya entregado.
                "entregado_en": None,
                "motivo": None,
                "observaciones": None,
                "recibio": None,
            },
        )

        remision = Remision.objects.get(doc_entry=doc)
        remision.lineas.all().delete()
        for line_num, (item, desc, unidad) in enumerate(random.sample(CATALOGO, random.randint(2, 5))):
            LineaRemision.objects.create(
                remision=remision,
                line_num=line_num,
                item_code=item,
                descripcion=desc,
                unidad=unidad,
                cantidad=random.choice([1, 2, 2, 3, 4, 6, 10]),
                peso_unitario_kg=round(random.uniform(0.5, 25), 2),
            )

    return {"status": "success", "message": f"{n} pedidos de prueba cargados para {fecha}.", "n": n}
