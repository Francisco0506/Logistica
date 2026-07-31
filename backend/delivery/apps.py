import os
import sys

from django.apps import AppConfig
from django.conf import settings


class DeliveryConfig(AppConfig):
    name = 'delivery'

    def ready(self):
        """
        Comprobar al arrancar que Postgres de verdad responde.

        Vivía en `core/settings.py`, a nivel de módulo: se abría una conexión
        con solo IMPORTAR la configuración. Eso rompía `collectstatic`,
        `makemigrations --check`, los tests y cualquier CI —comandos que no
        necesitan base de datos— y abría una conexión de más por cada worker de
        gunicorn.

        Aquí corre una sola vez al levantar la app, que es cuando de verdad
        importa. La intención original se respeta: si Postgres no está, se
        truena con instrucciones claras en vez de trabajar contra datos
        equivocados.
        """
        # Comandos que legítimamente corren sin base de datos.
        comando = sys.argv[1] if len(sys.argv) > 1 else ""
        if comando in ("collectstatic", "makemigrations", "check", "shell", "test"):
            return
        if os.getenv("DJANGO_TEST_DB") == "sqlite" or "pytest" in sys.modules:
            return
        if settings.DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
            return

        import psycopg2

        cfg = settings.DATABASES["default"]
        try:
            conn = psycopg2.connect(
                dbname=cfg["NAME"], user=cfg["USER"], password=cfg["PASSWORD"],
                host=cfg["HOST"], port=cfg["PORT"], connect_timeout=5,
            )
            conn.close()
        except Exception as e:
            raise RuntimeError(
                f"PostgreSQL no está disponible en {cfg['HOST']}:{cfg['PORT']} ({e}). "
                "Levántalo con: cd docker && docker compose up -d db"
            )
