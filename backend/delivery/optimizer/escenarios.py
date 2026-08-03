"""
"¿Qué hago para que quepan todos?"

Corre el optimizador varias veces cambiando UNA COSA A LA VEZ —salir antes, más
turno, otro camión— y reporta cuántos pedidos entrarían en cada caso. Cambiar
una sola variable por corrida es lo que hace que la respuesta sea accionable:
"ampliar el turno a 8 h mete 7 pedidos más" es una decisión que alguien puede
tomar; "cambiando tres cosas caben 12" no lo es.

VIVE AQUÍ Y NO EN `api/dispatcher.py`.

Eran 128 líneas dentro de un handler HTTP, y no tienen nada que ver con servir
peticiones: es lógica de optimización que decide qué escenarios vale la pena
probar y cómo compararlos. Sacarla del endpoint permite además probarla
directamente, sin levantar un cliente de Django.

Las corridas se SIMULAN: `solve_vrp(simular=True)` escribe dentro de una
transacción que se revierte, así que el plan que el despachador está viendo no
se toca.
"""
from datetime import datetime, timedelta
from typing import List, Optional

from .. import fleet
from ..models import ESTADOS_RUTA_DESPACHADA, Remision
from .solver import SEGUNDOS_SOLVER, solve_vrp

# Segundos de solver por escenario. Corto porque se corren varios seguidos y lo
# que interesa es comparar cuántos pedidos caben, no exprimir cada ruta.
# Se acota al límite general del solver: si alguien lo baja (pruebas, máquina
# lenta), no tiene sentido que un escenario tarde más que una corrida completa.
SEGUNDOS_POR_ESCENARIO = min(6, SEGUNDOS_SOLVER)

# La hora más temprano a la que tiene sentido proponer una salida. Medido con
# GPS: el camión más madrugador salió 07:03, así que proponer antes de las 7
# sería proponer algo que el almacén nunca ha hecho.
HORA_MAS_TEMPRANA = 6


def evaluar_escenarios(
    fecha,
    camiones: List[str],
    horas_turno: float = 6.0,
    hora_salida: str = "09:00",
    depot_coords=None,
) -> dict:
    """Qué se puede cambiar para que quepan más pedidos, y cuánto gana cada cosa."""
    if not camiones:
        return {"status": "error", "message": "Activa al menos un camión."}

    camiones = list(dict.fromkeys(camiones))
    depot_coords = depot_coords or fleet.CEDIS

    # Solo lo que este análisis puede mover: los pedidos que NO van ya en un
    # camión despachado. Antes se contaban TODAS las remisiones del día contra
    # un `base` que sí excluye las rutas congeladas, así que dos camiones en la
    # calle con 40 pedidos salían reportados como "40 sin asignar, hay que
    # acomodarlos a mano" cuando se estaban entregando en ese momento.
    total_pedidos = (
        Remision.objects.reales()
        .filter(doc_date=fecha)
        .exclude(ruta__estado__in=ESTADOS_RUTA_DESPACHADA)
        .count()
    )

    def cuantos_caben(placas, horas, salida) -> Optional[int]:
        res = solve_vrp(
            fecha=fecha, placas=placas, depot_coords=depot_coords,
            horas_turno=horas, hora_salida=salida,
            simular=True, segundos_solver=SEGUNDOS_POR_ESCENARIO,
        )
        if res.get("status") != "success":
            return None
        return sum(r["pedidos"] for r in res.get("rutas", []))

    base = cuantos_caben(camiones, horas_turno, hora_salida)
    if base is None:
        return {"status": "error", "message": "No se pudo evaluar el plan actual."}

    opciones = []

    # 1. Salir más temprano. Es la palanca más fuerte medida (ver docs/flota.md)
    #    porque las ventanas de los clientes son horas de reloj fijas: salir una
    #    hora antes no da una hora más de manejo, da una hora más DENTRO del
    #    horario en que los clientes reciben.
    hora_actual = datetime.strptime(hora_salida, "%H:%M")
    if hora_actual.hour > HORA_MAS_TEMPRANA:
        una_hora_antes = (hora_actual - timedelta(hours=1)).strftime("%H:%M")
        caben = cuantos_caben(camiones, horas_turno, una_hora_antes)
        if caben is not None:
            opciones.append({
                "accion": "salir_antes",
                "valor": una_hora_antes,
                "titulo": f"Salir a las {una_hora_antes} en vez de {hora_salida}",
                "detalle": "Cargar más rápido en el CEDIS para que el primer camión salga una hora antes.",
                "pedidos": caben,
                "dificultad": "Depende del almacén, no del sistema",
            })

    # 2. Más turno: el máximo posible. Si ni con el máximo mejora, tampoco
    #    mejoraría con un escalón intermedio, así que con una corrida basta.
    if horas_turno < 8:
        caben = cuantos_caben(camiones, 8.0, hora_salida)
        if caben is not None:
            opciones.append({
                "accion": "mas_turno",
                "valor": 8.0,
                "titulo": "Ampliar el turno a 8 horas",
                "detalle": f"Los choferes trabajarían {8 - horas_turno:g} h más que hoy.",
                "pedidos": caben,
                "dificultad": "Hay que confirmarlo con los choferes",
            })

    # 3. Activar un camión más. Se prueba el de MAYOR capacidad de los apagados:
    #    si ese no ayuda, ninguno de los más chicos va a ayudar. Probar los tres
    #    triplicaba el tiempo de espera para dar casi la misma respuesta.
    apagados = [c for c in fleet.CAMIONES if c["placa"] not in camiones]
    if apagados:
        mejor_apagado = max(apagados, key=lambda c: (c["capacidad_kg"], c["max_paradas"]))
        placa = mejor_apagado["placa"]
        caben = cuantos_caben(camiones + [placa], horas_turno, hora_salida)
        if caben is not None:
            otros = len(apagados) - 1
            opciones.append({
                "accion": "activar_camion",
                "valor": placa,
                "titulo": f"Activar el {placa}",
                "detalle": (
                    f"{mejor_apagado['modelo']}, {mejor_apagado['capacidad_kg']:,} kg, "
                    f"hasta {mejor_apagado['max_paradas']} paradas."
                    + (f" Hay {otros} camión(es) apagado(s) más." if otros else "")
                ),
                "pedidos": caben,
                "dificultad": "Requiere unidad y chofer disponibles",
            })

    # El "gana" es contra el plan actual. Se ordena por lo que más mete, y las
    # que no mejoran nada se marcan pero NO se esconden: saber que ampliar el
    # turno no sirve es tan útil como saber qué sí sirve.
    for o in opciones:
        o["gana"] = o["pedidos"] - base
    opciones.sort(key=lambda o: -o["gana"])

    mejor = opciones[0] if opciones and opciones[0]["gana"] > 0 else None

    return {
        "status": "success",
        "total_pedidos": total_pedidos,
        "asignados_ahora": base,
        "sin_asignar": total_pedidos - base,
        "opciones": opciones,
        "recomendacion": (
            f"{mejor['titulo']}: mete {mejor['gana']} pedido(s) más." if mejor
            else "Ninguna de estas opciones mete más pedidos. Los que faltan hay que "
                 "asignarlos a mano o moverlos a otro día."
        ),
    }
