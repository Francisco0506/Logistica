"""Lo que el despachador hace a mano sobre un plan ya generado.

Recalcular las ETAs con la hora real de salida, sugerir en qué camión cabe un
pedido que quedó fuera, y meterlo ahí aunque apriete.
"""
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone

from .. import fleet
from ..models import Remision, Ruta
from ..integrations.osrm import build_distance_time_matrices
from .reglas import (
    HORA_CERO,
    MINUTOS_TURNO_MAXIMO,
    PESO_ESTIMADO_KG,
    TIEMPO_DESCARGA_MINUTOS,
    VELOCIDAD_PROMEDIO_KMH,
    _clave_lugar,
    _horas_y_minutos,
    _ventana_en_minutos,
)

def recalcular_etas_desde_salida(ruta, depot_coords, salida_dt=None):
    """
    Recalcula las ETAs de una ruta a partir de la hora REAL de salida (cuando
    el despachador presiona "Salida"), no la hora teórica del plan.

    Motivo: el optimizador puede correr a las 8:00 pero la carga del camión
    termina a las 10:00 — sin esto, todas las ETAs prometidas quedan ~2 horas
    adelantadas respecto a la realidad. Se recorre la secuencia real de la
    ruta (CEDIS → paradas en orden) con tiempos de OSRM + descarga.

    Regresa cuántos pedidos se actualizaron.
    """
    remisiones = [
        r for r in ruta.remisiones.filter(destino__isnull=False)
        .select_related('destino').order_by('secuencia_ruta')
        if r.destino.latitude is not None and r.destino.longitude is not None
    ]
    if not remisiones:
        return 0
    # localtime() y no datetime.now(): con USE_TZ=True, `now()` da la hora del
    # SERVIDOR. En la compu de desarrollo coincide con Monterrey, pero en
    # cualquier hosting va en UTC y todas las ETAs saldrían 6 h adelantadas.
    salida_dt = salida_dt or timezone.localtime()

    # Paradas únicas en orden: documentos consecutivos que se entregan en el
    # mismo LUGAR comparten parada (el camión se estaciona una sola vez), aunque
    # sean clientes distintos de SAP. Mismo criterio que build_data_model.
    paradas = []
    for r in remisiones:
        clave = _clave_lugar(r.destino)
        if paradas and paradas[-1][0] == clave:
            paradas[-1][1].append(r)
        else:
            paradas.append((clave, [r], (r.destino.latitude, r.destino.longitude)))

    locations = [depot_coords] + [p[2] for p in paradas]
    _, time_matrix, _ = build_distance_time_matrices(locations, VELOCIDAD_PROMEDIO_KMH)

    t = salida_dt
    actualizadas = []
    for i, (_, rems, _) in enumerate(paradas):
        t += timedelta(minutes=time_matrix[i][i + 1])
        for r in rems:
            r.eta = t.strftime("%H:%M")
            actualizadas.append(r)
        t += timedelta(minutes=TIEMPO_DESCARGA_MINUTOS)
    Remision.objects.bulk_update(actualizadas, ['eta'])
    return len(actualizadas)


# ==========================================
# 4. ASIGNACIÓN MANUAL DE UN PEDIDO SUELTO
# ==========================================
def sugerir_camiones_para_remision(remision, depot_coords):
    """
    Para un pedido que el optimizador dejó sin asignar, calcula en qué punto de
    cada ruta del día (que no esté ya despachada/congelada) conviene más
    insertarlo — el de menor tiempo agregado ("cheapest insertion") — y si
    cabe en tiempo (turno) y peso, o si se pasaría de alguno.

    No modifica nada en la BD: solo calcula y regresa las opciones para que el
    despachador decida. Siempre regresa las 5 rutas evaluadas, incluso las que
    no caben, marcadas con el motivo, para que el despachador pueda forzar la
    asignación de todos modos si así lo decide (ej. cliente urgente).
    """
    destino = remision.destino
    if not destino or destino.latitude is None or destino.longitude is None:
        return {"error": "Este pedido no tiene coordenadas; no se puede sugerir un camión."}

    rutas = list(
        Ruta.objects.filter(fecha=remision.doc_date)
        .exclude(estado__in=['En_Ruta', 'Finalizada'])
        .prefetch_related('remisiones__destino')
    )
    if not rutas:
        return {"error": "No hay rutas generadas todavía para este día. Corre el optimizador primero."}

    peso_pedido = remision.peso_kg if remision.peso_kg else PESO_ESTIMADO_KG

    opciones = []
    for ruta in rutas:
        remisiones_ruta = sorted(
            [r for r in ruta.remisiones.all() if r.destino and r.destino.latitude is not None],
            key=lambda r: r.secuencia_ruta or 0,
        )

        # Puntos de la ruta actual: CEDIS -> paradas existentes -> CEDIS.
        # Las remisiones que caen en el mismo lugar cuentan como UNA parada; si
        # no, una ruta con tres documentos al mismo domicilio se evaluaba como
        # tres puntos y el tiempo agregado salía inflado.
        paradas_ruta = []
        for r in remisiones_ruta:
            clave = _clave_lugar(r.destino)
            if not paradas_ruta or paradas_ruta[-1][0] != clave:
                paradas_ruta.append((clave, (r.destino.latitude, r.destino.longitude)))
        puntos = [depot_coords] + [p[1] for p in paradas_ruta] + [depot_coords]
        locations_con_nuevo = puntos + [(destino.latitude, destino.longitude)]
        idx_nuevo = len(puntos)  # último índice = el pedido a insertar

        distance_matrix, time_matrix, _ = build_distance_time_matrices(locations_con_nuevo, VELOCIDAD_PROMEDIO_KMH)

        ini_ventana, fin_ventana = _ventana_en_minutos(destino)

        # Probar insertar el nuevo punto entre CADA par consecutivo de la ruta
        # (incluye antes de la primera parada y después de la última) y quedarse
        # con la mejor. "Mejor" NO es solo la más barata en tiempo: primero se
        # prefiere una posición donde el camión llegue DENTRO de la ventana de
        # recibo del cliente, y entre esas, la más barata.
        #
        # Antes solo se evaluaba la inserción más barata y se revisaba si esa
        # caía en ventana. Para un cliente que abre tarde (ej. Mangioz, 15:00 a
        # 22:00) la posición más barata casi siempre queda a media mañana, así
        # que salían todos los camiones en rojo aunque el pedido sí cupiera más
        # adelante en la ruta. Ahora se busca ese hueco.
        candidatas = []
        for i in range(len(puntos) - 1):
            costo_actual = time_matrix[i][i + 1]
            costo_con_insercion = (
                time_matrix[i][idx_nuevo] + TIEMPO_DESCARGA_MINUTOS + time_matrix[idx_nuevo][i + 1]
            )
            minutos_agregados = costo_con_insercion - costo_actual

            # Hora de llegada al NUEVO cliente si se inserta en esta posición:
            # manejo de parada en parada hasta la parada `i`, más la descarga de
            # cada parada previa, más el tramo de `i` al cliente nuevo.
            #
            # Ese último tramo es el que estaba mal: se sumaba
            # time_matrix[i][i+1] —el tramo a la parada SIGUIENTE ya existente,
            # o el regreso al CEDIS— en vez de time_matrix[i][idx_nuevo], que es
            # el que de verdad se va a recorrer. Con el pedido nuevo lejos de la
            # ruta el error llega a media hora, y como de esa hora depende el
            # flag `en_ventana`, el panel decía "sí cabe" para un cliente al que
            # el camión llega después de que cierra.
            minutos_llegada = (
                sum(time_matrix[k][k + 1] for k in range(i))
                + i * TIEMPO_DESCARGA_MINUTOS
                + time_matrix[i][idx_nuevo]
            )
            candidatas.append({
                "posicion": i,
                "minutos_agregados": minutos_agregados,
                "minutos_llegada": minutos_llegada,
                "en_ventana": ini_ventana <= minutos_llegada <= fin_ventana,
            })

        # Ordena: primero las que caen en ventana, luego por tiempo agregado.
        candidatas.sort(key=lambda c: (not c["en_ventana"], c["minutos_agregados"]))
        elegida = candidatas[0] if candidatas else None
        mejor_costo = elegida["minutos_agregados"] if elegida else None
        mejor_posicion = elegida["posicion"] if elegida else None  # se inserta después de la parada i (0 = después del CEDIS)

        peso_actual = sum((r.peso_kg if r.peso_kg else PESO_ESTIMADO_KG) for r in remisiones_ruta)
        # Capacidad REAL del camión de esta ruta. Antes se usaba un 3,000 kg
        # parejo para toda la flota, así que al 013 (1,500 kg) se le decía que
        # sí cabía cuando ya iba sobrecargado, y al 027 (6,000 kg) que no cabía
        # con la mitad del camión libre.
        capacidad = fleet.capacidad_kg(ruta.camion)

        # Tiempo total de la ruta si se agrega este pedido, contra el turno del
        # chofer. Cuenta manejo Y descarga: antes solo sumaba el manejo, así que
        # una ruta de 18 paradas se reportaba en 200 min cuando de verdad va en
        # 200 + 18x12 = 416 —ya fuera del turno de 360— y el panel decía que
        # todavía cabían dos horas más de pedidos.
        duracion_actual = (
            sum(time_matrix[i][i + 1] for i in range(len(puntos) - 1))
            + len(paradas_ruta) * TIEMPO_DESCARGA_MINUTOS
        )
        duracion_con_insercion = duracion_actual + mejor_costo

        motivos = []
        cabe_tiempo = duracion_con_insercion <= MINUTOS_TURNO_MAXIMO
        if not cabe_tiempo:
            motivos.append(
                f"se pasaría del turno de {MINUTOS_TURNO_MAXIMO // 60}h "
                f"(quedaría en {int(duracion_con_insercion)} min)"
            )

        cabe_peso = (peso_actual + peso_pedido) <= capacidad
        if not cabe_peso:
            motivos.append(f"se pasaría del peso máximo del camión ({capacidad} kg)")

        # Choque de ventana de horario del propio destino nuevo. El mensaje dice
        # de QUÉ LADO se pasa y por cuánto: "fuera de la ventana" a secas hacía
        # pensar que el camión llegaba tarde cuando el caso más común es que
        # llega demasiado temprano, y son problemas distintos (llegar temprano
        # se arregla metiéndolo más adelante en la ruta; llegar tarde, no).
        minutos_llegada_estimados = elegida["minutos_llegada"] if elegida else 0
        choca_ventana = not (elegida["en_ventana"] if elegida else False)
        if choca_ventana:
            hora_ini = (HORA_CERO + timedelta(minutes=ini_ventana)).strftime("%H:%M")
            hora_fin = (HORA_CERO + timedelta(minutes=fin_ventana)).strftime("%H:%M")
            if minutos_llegada_estimados < ini_ventana:
                # Llegar temprano NO es imposible: el camión puede esperar en la
                # puerta. Es caro (deja al camión parado) pero es una salida real,
                # así que se dice en vez de solo marcarlo en rojo. Ya se buscó en
                # toda la ruta, incluido el final, y esta fue la hora más tardía
                # que se pudo conseguir.
                falta = ini_ventana - minutos_llegada_estimados
                motivos.append(
                    f"llegaría {_horas_y_minutos(falta)} antes de que abran "
                    f"(reciben {hora_ini}-{hora_fin}); es lo más tarde que se puede "
                    f"acomodar, así que el camión tendría que esperar ese rato en la puerta"
                )
            else:
                tarde = minutos_llegada_estimados - fin_ventana
                motivos.append(
                    f"llegaría {_horas_y_minutos(tarde)} DESPUÉS de que cierren "
                    f"(reciben {hora_ini}-{hora_fin})"
                )

        eta_estimada = (HORA_CERO + timedelta(minutes=minutos_llegada_estimados)).strftime("%H:%M")

        opciones.append({
            "ruta_id": ruta.id,
            "camion": ruta.camion,
            "chofer": ruta.chofer,
            "estado_ruta": ruta.estado,
            "factible": cabe_tiempo and cabe_peso and not choca_ventana,
            "minutos_agregados": int(mejor_costo) if mejor_costo is not None else None,
            "eta_estimada": eta_estimada,
            "posicion_sugerida": mejor_posicion + 1 if mejor_posicion is not None else None,
            "motivos_riesgo": motivos,  # vacío si cabe perfecto; si no, se puede forzar de todos modos
        })

    opciones.sort(key=lambda o: (not o["factible"], o["minutos_agregados"] if o["minutos_agregados"] is not None else 9999))
    return {"pedido": remision.doc_num, "cliente": remision.card_name, "opciones": opciones}


@transaction.atomic
def asignar_manualmente(remision, ruta_id, posicion=None, forzar=False):
    """
    Mete un pedido a una ruta específica a mano, en la posición sugerida (o al
    final si no se da). Si hay riesgo (fuera de turno/peso/ventana) y no se
    pasa forzar=True, rechaza la asignación explicando por qué — el
    despachador debe confirmar explícitamente que quiere forzarla.
    """
    try:
        ruta = Ruta.objects.get(id=ruta_id)
    except Ruta.DoesNotExist:
        return {"status": "error", "message": "Esa ruta ya no existe."}

    if ruta.estado in ['En_Ruta', 'Finalizada']:
        return {"status": "error", "message": "Ese camión ya salió a la calle o terminó su ruta, no se le puede agregar nada."}

    if not forzar:
        # El CEDIS sale de fleet.py, que es su única fuente de verdad. Aquí
        # estaba escrito a mano otra vez: si algún día se muda la bodega, una
        # copia se actualiza y la otra no.
        sugerencias = sugerir_camiones_para_remision(remision, fleet.CEDIS)
        opcion = next((o for o in sugerencias.get("opciones", []) if o["ruta_id"] == ruta_id), None)
        if opcion and not opcion["factible"]:
            return {
                "status": "requiere_confirmacion",
                "message": "Este pedido no cabe limpio en esta ruta: " + "; ".join(opcion["motivos_riesgo"]),
                "motivos_riesgo": opcion["motivos_riesgo"],
            }

    remisiones_ruta = list(ruta.remisiones.order_by('secuencia_ruta'))
    if posicion is None or posicion > len(remisiones_ruta):
        posicion = len(remisiones_ruta) + 1
    # Una posición 0 o negativa dejaría dos pedidos con la misma secuencia y el
    # orden de la ruta pasaría a depender del doc_num, no del plan.
    posicion = max(1, posicion)

    # Recorrer secuencia para abrir espacio en la posición indicada.
    # `secuencia_ruta` puede venir en null (un pedido metido a la ruta sin
    # secuencia), y `None >= 1` truena con TypeError en Python 3. Se tratan
    # como "sin lugar todavía": no estorban, así que no se recorren.
    for r in remisiones_ruta:
        if r.secuencia_ruta is not None and r.secuencia_ruta >= posicion:
            r.secuencia_ruta += 1
    Remision.objects.bulk_update(remisiones_ruta, ['secuencia_ruta'])

    remision.ruta = ruta
    remision.secuencia_ruta = posicion
    remision.estado = 'Asignado'
    remision.save()

    return {"status": "success", "message": f"Pedido #{remision.doc_num} asignado a {ruta.camion} en la posición {posicion}."}

