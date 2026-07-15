from datetime import date

from django.core.management.base import BaseCommand

from delivery.test_data import cargar_pedidos_prueba


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
        resultado = cargar_pedidos_prueba(fecha, options["n"], options["solo_locales"])
        if resultado["status"] == "error":
            self.stderr.write(resultado["message"])
        else:
            self.stdout.write(self.style.SUCCESS(resultado["message"]))
