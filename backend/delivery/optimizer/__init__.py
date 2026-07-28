"""El optimizador de rutas, partido por trabajo.

Antes era un solo archivo de 859 líneas que hacía cuatro cosas distintas. Se
reexporta la misma API pública, así que nada de lo que lo usa cambió:

    reglas.py    constantes y reglas del negocio (ventanas, paradas, pesos)
    modelo.py    arma el modelo que come OR-Tools
    solver.py    resuelve y guarda las rutas del día
    manual.py    ETAs con la hora real de salida y asignación a mano
"""
from .manual import (
    asignar_manualmente,
    recalcular_etas_desde_salida,
    sugerir_camiones_para_remision,
)
from .modelo import build_data_model
from .reglas import (
    MINUTOS_TURNO_MAXIMO,
    PESO_ESTIMADO_KG,
    TIEMPO_DESCARGA_MINUTOS,
    VELOCIDAD_PROMEDIO_KMH,
)
from .solver import solve_vrp

__all__ = [
    "solve_vrp",
    "build_data_model",
    "recalcular_etas_desde_salida",
    "sugerir_camiones_para_remision",
    "asignar_manualmente",
    "MINUTOS_TURNO_MAXIMO",
    "PESO_ESTIMADO_KG",
    "TIEMPO_DESCARGA_MINUTOS",
    "VELOCIDAD_PROMEDIO_KMH",
]
