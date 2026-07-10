import random
from datetime import date

from django.core.management.base import BaseCommand
from django.db.models import Q

from delivery.models import Destino, Remision, Ruta


class Command(BaseCommand):
    help = (
        "Carga N pedidos de prueba (con destinos reales ya importados del Excel de "
        "SAP) para una fecha dada, para poder correr el optimizador contra datos "
        "reales sin depender de la conexión a SAP. Uso:\n"
        "  python manage.py cargar_prueba --fecha 2026-07-10 --n 85"
    )

    def add_arguments(self, parser):
        parser.add_argument("--fecha", required=True, help="YYYY-MM-DD")
        parser.add_argument("--n", type=int, default=85, help="Cuántos pedidos de prueba crear")
        parser.add_argument(
            "--solo-locales",
            action="store_true",
            default=True,
            help="Excluir destinos foráneos (Saltillo, Nuevo Laredo, etc.) del área metropolitana",
        )

    def handle(self, *args, **options):
        fecha = date.fromisoformat(options["fecha"])
        n = options["n"]

        destinos = Destino.objects.all()
        if options["solo_locales"]:
            destinos = destinos.filter(
                Q(latitude__range=(25.3, 26.0)) & Q(longitude__range=(-100.8, -100.0))
            )
        destinos = list(destinos)

        if not destinos:
            self.stderr.write("No hay destinos importados todavía. Corre primero la importación del Excel de SAP.")
            return

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
                },
            )

        self.stdout.write(self.style.SUCCESS(f"{n} pedidos de prueba cargados para {fecha}."))
