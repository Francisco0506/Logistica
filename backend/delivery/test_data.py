import random

from django.db.models import Q

from .models import Destino, Remision, Ruta


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
            },
        )

    return {"status": "success", "message": f"{n} pedidos de prueba cargados para {fecha}.", "n": n}
