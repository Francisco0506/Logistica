"""La API del sistema, partida por rol.

Antes esto era un solo archivo de 960 líneas con los tres paneles revueltos.
Cada rol vive ahora en su módulo y aquí solo se montan:

    /api/dispatcher/...   dispatcher.py
    /api/ventas/...       ventas.py
    /api/chofer/...       chofer.py

`api` se sigue exportando con el mismo nombre, así que core/urls.py no cambia.
"""
from ninja import NinjaAPI

from .chofer import router as chofer_router
from .dispatcher import router as dispatcher_router
from .ventas import router as ventas_router

api = NinjaAPI(title="Laben Routing API", version="1.0.0")

api.add_router("/dispatcher", dispatcher_router)
api.add_router("/ventas", ventas_router)
api.add_router("/chofer", chofer_router)
