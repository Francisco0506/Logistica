"""
Traer de SAP B1 las órdenes de entrega del día y volcarlas a la base local.

Es de SOLO LECTURA: este sistema nunca escribe en SAP.

Lo que depende de CÓMO está montado el SQL Server del cliente —driver,
timeouts, qué UDF existen, validación de coordenadas— vive en
`sap_conexion.py`. Aquí queda lo que se hace con los datos una vez traídos.
"""
from datetime import date

from django.db import transaction

from ..models import (
    ESTADOS_ENTREGA_FINAL, ESTADOS_RUTA_DESPACHADA, Destino, LineaRemision, Remision,
)
from .sap_conexion import (
    UDF_DIAS, CamposDisponibles, conectar, coordenada_creible, revisar_configuracion,
)


def _traer_de_sap(fecha: date):
    """
    Abre la conexión y corre las DOS consultas contra SAP: ODLN (las entregas
    del día) y DLN1 (sus líneas). Esto es TODO lo que puede fallar por red,
    credenciales o driver — por eso es lo único que `sync_from_sap` deja
    dentro de su try/except. Lo que pasa después con estos datos (mapeo a
    Destino/Remision/LineaRemision) es lógica de Python pura y, si truena,
    debe tronar con su propio traceback y no como "Falló la conexión".
    """
    conn = conectar()
    cursor = conn.cursor()

    campos = CamposDisponibles(cursor)
    has_geo_udf = campos.hay_geo
    has_window_udf = campos.hay_ventana
    extra_cols = campos.columnas_extra()

    # Se rutean las ÓRDENES DE ENTREGA (ODLN), SIEMPRE.
    #
    # Decisión de operación (Francisco y Sebastián, 27-jul-2026): el
    # planeador trabaja con órdenes de entrega y nada más. No agregar aquí un
    # respaldo por órdenes de venta "para cuando no haya entregas": si el
    # panel se ve vacío en la mañana es porque la entrega todavía no se ha
    # capturado, y eso se arregla adelantando la captura, no cambiando la
    # fuente. Ver docs/pendientes.md §3.
    #
    # Antes esto leía ORDR/RDR1 y por eso el panel se veía casi vacío: para
    # el 27-jul-2026 había 17 órdenes de venta abiertas contra 73 órdenes de
    # entrega. La orden de venta es lo que el cliente pidió; la entrega es lo
    # que de verdad sale del CEDIS ese día, que es lo que hay que repartir.
    # Un día normal trae entre 70 y 180 entregas.
    #
    # EL CONTADO SOLO ENTRA SI YA SE PAGÓ. Si el cliente es de contado y no
    # hay pago registrado (`ODLN.PaidToDate`), la mercancía no debe subir al
    # camión. Las condiciones de contado en esta instalación son tres —
    # CONTADO, CONTADO - TARJETA y CONTADO - CHEQUE— por eso se busca por
    # texto y no por número de grupo. Medido el 27-jul: de 73 entregas, 9
    # eran de contado y solo 2 estaban pagadas, así que se rutean 66.
    #
    # NO se filtra por DocStatus: una entrega cerrada es una ya facturada, y
    # esas también van en el camión. Verificado con el lunes 20-jul, un día
    # ya cerrado: sus 181 entregas siguen en SAP, todas en estado "Cerrado".
    # La entrega no desaparece al facturarse, solo cambia de estado.
    #
    # SE EXCLUYE lo que no es reparto, aunque SAP lo registre como entrega:
    #
    #   - Ventas a EMPLEADOS. El dato no está donde se ve en la pantalla de
    #     SAP ("Nombre Comercial"), sino en `OCRD.AliasName`. Son ~50 cada
    #     14 días y el empleado se lleva su mercancía él mismo.
    #   - "Recoge en LABEN": el cliente pasa por su pedido al CEDIS, así que
    #     no ocupa lugar en ningún camión. ~24 cada 14 días.
    #   - Muestras comerciales (C794, C794-1, C1444). ~2 al día.
    #
    # Sin estos filtros el promedio diario sale en 106 entregas; con ellos,
    # en 100, que es el número de reparto real. No cambia el panorama pero sí
    # mete paradas que el camión nunca va a hacer.
    #
    # A.Address es el ID real de la dirección del Ship-To en SAP (AdresID),
    # usado como identificador estable en vez del texto libre de la calle.
    #
    # El peso NO existe como campo de cabecera en SAP: se calcula sumando las
    # líneas de la entrega (DLN1). Si un artículo no tiene peso capturado en su
    # ficha, cuenta como 0 y el pedido queda con el peso parcial de lo que sí
    # está capturado (mejor una subestimación que un peso 100% inventado).
    #
    # OJO CON LAS UNIDADES — aquí había un error que inflaba los kilos hasta
    # 36 veces. `OITM.SWeight1` no es el peso de la pieza: es el peso de la
    # UNIDAD DE VENTA, que casi siempre es la caja. Y `RDR1.Quantity` viene
    # en la unidad DEL RENGLÓN, que no siempre es esa: el mismo artículo se
    # pide unas veces por caja y otras por pieza suelta.
    #
    # Ejemplo real (2000001, mantequilla "Caja 30 Pz", SWeight1 = 14.04 kg):
    #   renglón "1 Caja 30 Pz" -> 1 x 14.04  = 14 kg   correcto
    #   renglón "2 Pieza"      -> 2 x 14.04  = 28 kg   son 2 barras de 454 g
    #
    # `InvQty` siempre viene en unidad de inventario (la pieza), así que
    # dividir SWeight1 entre NumInSale (piezas por unidad de venta) da el
    # peso de la pieza y la cuenta cuadra en los dos casos.
    #
    # Y OJO CON LA UNIDAD DEL PESO: `SWeight1` no siempre está en kilos.
    # `SWght1Unit` apunta al catálogo OWGT (1 miligramo, 2 gramo, 3
    # kilogramo, 4 onza, 5 libra). Hoy hay dos artículos capturados en
    # LIBRAS, y uno de ellos —2113081, QUESO MOZZARELLA WHOLE MILK RALLADO—
    # es el que más se entrega de todo el catálogo: 359 renglones en 60
    # días. Sus 5.20 libras son 2.36 kg, no 5.20 kg, así que tomarlo como
    # kilos lo contaba al doble. Por eso se convierte siempre.
    #
    # CUÁL DE LOS DOS PESOS USAR — la regla, porque es fácil equivocarse:
    #
    #   Datos de ventas  -> SWeight1 + NumInSale   <- este, SIEMPRE
    #   Datos de compras -> BWeight1 + NumInBuy    <- solo de respaldo
    #
    # Se usa el de VENTAS porque el renglón de la entrega viene en la unidad
    # de venta (Pieza, Caja 6 Pz, Kilogramo). Tomar el peso de compras contra
    # una cantidad de venta mezcla dos escalas: 61 artículos tienen NumInSale
    # distinto de NumInBuy, empezando por el 2113081, que se compra en caja
    # de 6 y se vende por pieza.
    #
    # EL PESO Y LAS PIEZAS VAN EN PAREJA, de la misma pestaña. BWeight1 con
    # NumInSale da basura, y SWeight1 con NumInBuy también.
    #
    # El respaldo por compras solo entra cuando VENTAS no tiene nada
    # capturado (hoy 2 artículos). Es preferible el peso bruto de la caja del
    # proveedor —que además incluye el empaque, y el empaque también viaja en
    # el camión— a contar el renglón como cero.
    #
    # Ojo al leerlo en SAP: 224 de 283 artículos tienen el peso de ventas
    # IDÉNTICO al de compras porque alguien lo copió. Que coincidan no
    # significa que sean lo mismo.
    #
    # Medido contra 12,937 renglones de 60 días de la base productiva: la
    # fórmula anterior reportaba 1,457,832 kg contra los 808,469 kg reales
    # —1.8x— y en el peor pedido se equivocaba por 36x. Solo el 4% de los
    # renglones estaba mal, pero eran justo los de miles de piezas.
    query = f"""
        SELECT
            O.DocEntry,
            O.DocNum,
            O.CardCode,
            O.CardName,
            O.DocDate,
            O.DocDueDate,
            O.DocTotal,
            O.SlpCode,
            O.DocStatus,
            (SELECT SlpName FROM OSLP WHERE SlpCode = O.SlpCode) as SlpName,
            A.Address,
            A.Street,
            A.Block,
            A.City,
            A.ZipCode,
            (
                SELECT SUM(
                    ISNULL(L.InvQty, L.Quantity)
                    * CASE
                        -- IWeight1 es el peso por UNIDAD DE INVENTARIO (la
                        -- pieza), capturado directo — sin derivarlo de la
                        -- unidad de venta ni depender de NumInSale. Cuando
                        -- está capturado es la fuente más confiable, así
                        -- que gana sobre SWeight1. Medido con el queso
                        -- mozzarella (2113081): SWeight1/NumInSale con su
                        -- conversión de libras da 2.358 kg; IWeight1 (ya en
                        -- kilos) da 2.27 kg, que es el que trae el propio
                        -- nombre del artículo ("1 / 2.27 KG").
                        WHEN ISNULL(I.IWeight1, 0) > 0 THEN
                             I.IWeight1
                             * CASE ISNULL(I.IWght1Unit, 3)
                                   WHEN 1 THEN 0.000001    -- miligramo
                                   WHEN 2 THEN 0.001       -- gramo
                                   WHEN 4 THEN 0.0283495   -- onza
                                   WHEN 5 THEN 0.453592    -- libra
                                   ELSE 1 END              -- kilogramo
                        WHEN ISNULL(I.SWeight1, 0) > 0 THEN
                             (I.SWeight1 / NULLIF(ISNULL(I.NumInSale, 1), 0))
                             * CASE ISNULL(I.SWght1Unit, 3)
                                   WHEN 1 THEN 0.000001    -- miligramo
                                   WHEN 2 THEN 0.001       -- gramo
                                   WHEN 4 THEN 0.0283495   -- onza
                                   WHEN 5 THEN 0.453592    -- libra
                                   ELSE 1 END              -- kilogramo
                        ELSE
                             (ISNULL(I.BWeight1, 0) / NULLIF(ISNULL(I.NumInBuy, 1), 0))
                             * CASE ISNULL(I.BWght1Unit, 3)
                                   WHEN 1 THEN 0.000001
                                   WHEN 2 THEN 0.001
                                   WHEN 4 THEN 0.0283495
                                   WHEN 5 THEN 0.453592
                                   ELSE 1 END
                      END
                )
                FROM DLN1 L
                LEFT JOIN OITM I ON I.ItemCode = L.ItemCode
                WHERE L.DocEntry = O.DocEntry
            ) AS PesoTotalKg
            {extra_cols}
        FROM ODLN O
        INNER JOIN CRD1 A ON O.CardCode = A.CardCode AND O.ShipToCode = A.Address AND A.AdresType = 'S'
        INNER JOIN OCRD C ON C.CardCode = O.CardCode
        LEFT JOIN OCTG G ON G.GroupNum = O.GroupNum
        WHERE O.DocDate = ?
          AND (
                ISNULL(G.PymntGroup, '') NOT LIKE '%CONTADO%'
                OR ISNULL(O.PaidToDate, 0) > 0
              )
          AND ISNULL(C.AliasName, '') NOT LIKE '%EMPLEADO%'
          AND ISNULL(O.ShipToCode, '') NOT LIKE '%Recoge%'
          AND ISNULL(O.CardName, '') NOT LIKE '%MUESTRA%'
    """
    cursor.execute(query, str(fecha))
    rows = cursor.fetchall()

    # Las LÍNEAS de cada entrega (DLN1): qué producto y cuánto. Sin esto el
    # chofer no tiene qué marcar cuando una entrega sale incompleta —
    # "entregué el 60%" no le sirve a nadie; lo que sirve es "de las 2
    # bolsas de queso rallado solo aceptó 1.5".
    #
    # Va en UNA sola consulta para todos los pedidos del día en vez de una
    # por pedido: con 80 pedidos serían 80 viajes a SAP.
    doc_entries = [row.DocEntry for row in rows]
    lineas_por_pedido = {}
    if doc_entries:
        marcadores = ",".join("?" * len(doc_entries))
        cursor.execute(f"""
            SELECT L.DocEntry, L.LineNum, L.ItemCode, L.Dscription,
                   L.Quantity, L.unitMsr,
                   -- Piezas por unidad de venta: 6 para una "Caja 6 Pz", 1
                   -- para lo que se vende suelto o por kilo. Es lo que deja
                   -- decirle al chofer que sus 24 cajas son 144 piezas sin
                   -- cambiarle la unidad con la que reporta la entrega.
                   ISNULL(L.NumPerMsr, 1) AS PiezasPorUnidad,
                   -- peso de UNA unidad de este renglón, no de la caja:
                   -- misma cuenta que el total de arriba (IWeight1 primero,
                   -- por ser el peso de la unidad de inventario capturado
                   -- directo, sin depender de NumInSale), con su conversión
                   -- a kilos y su respaldo por datos de compras.
                   ISNULL(L.NumPerMsr, 1) * CASE
                       WHEN ISNULL(I.IWeight1, 0) > 0 THEN
                            I.IWeight1
                            * CASE ISNULL(I.IWght1Unit, 3)
                                  WHEN 1 THEN 0.000001
                                  WHEN 2 THEN 0.001
                                  WHEN 4 THEN 0.0283495
                                  WHEN 5 THEN 0.453592
                                  ELSE 1 END
                       WHEN ISNULL(I.SWeight1, 0) > 0 THEN
                            (I.SWeight1 / NULLIF(ISNULL(I.NumInSale, 1), 0))
                            * CASE ISNULL(I.SWght1Unit, 3)
                                  WHEN 1 THEN 0.000001
                                  WHEN 2 THEN 0.001
                                  WHEN 4 THEN 0.0283495
                                  WHEN 5 THEN 0.453592
                                  ELSE 1 END
                       ELSE
                            (ISNULL(I.BWeight1, 0) / NULLIF(ISNULL(I.NumInBuy, 1), 0))
                            * CASE ISNULL(I.BWght1Unit, 3)
                                  WHEN 1 THEN 0.000001
                                  WHEN 2 THEN 0.001
                                  WHEN 4 THEN 0.0283495
                                  WHEN 5 THEN 0.453592
                                  ELSE 1 END
                   END AS SWeight1
            FROM DLN1 L
            LEFT JOIN OITM I ON I.ItemCode = L.ItemCode
            WHERE L.DocEntry IN ({marcadores})
            ORDER BY L.DocEntry, L.LineNum
        """, *doc_entries)
        for linea in cursor.fetchall():
            lineas_por_pedido.setdefault(linea.DocEntry, []).append(linea)

    conn.close()

    return rows, lineas_por_pedido, has_geo_udf, has_window_udf


def _mapear_destinos(rows, has_geo_udf, has_window_udf):
    """
    Crea o actualiza el Destino de cada renglón traído de SAP. Devuelve un
    dict {DocEntry: Destino} para que `_mapear_remisiones` no tenga que
    volver a tocar CRD1, y la lista de coordenadas que SAP trae imposibles
    (para avisar en el mensaje final, en vez de descartarlas en silencio).
    """
    destinos_por_doc_entry = {}
    coordenadas_invalidas = []

    for row in rows:
        # Crear o actualizar Destino, usando el AdresID real de SAP como clave estable
        destino, _ = Destino.objects.get_or_create(
            card_code=row.CardCode,
            ship_to_code=row.Address or "Dirección Principal",
            defaults={
                "street": row.Street,
                "block": row.Block,
                "city": row.City,
                "zip_code": row.ZipCode
            }
        )

        # REGLA DE ORO DE ESTE BLOQUE: solo se escribe lo que SAP realmente
        # mandó. Si un UDF no existe en esta base, el campo NO se toca.
        #
        # Antes solo la primera ventana tenía esa guardia. La segunda
        # ventana y contacto/teléfono/referencias se asignaban a pelo, y
        # como `getattr(row, "UdfIni2", None)` devuelve None cuando la
        # columna no vino en el SELECT, cada sync los ponía en NULL.
        # Efecto real: importas los 195 destinos del Excel con sus
        # horarios, el primer sync contra la base productiva —que no tiene
        # esos UDF— los borra todos, y el optimizador vuelve a planear como
        # si todo el mundo recibiera a cualquier hora. El auto-sync corre
        # cada 45 s, así que no había forma de notar de dónde salió.
        def _si_vino(campo_modelo, nombre_columna):
            if hasattr(row, nombre_columna):
                setattr(destino, campo_modelo, getattr(row, nombre_columna))

        if has_window_udf:
            destino.ini_recibo_1 = getattr(row, "UdfIni1", None)
            destino.fin_recibo_1 = getattr(row, "UdfFin1", None)

        _si_vino("ini_recibo_2", "UdfIni2")
        _si_vino("fin_recibo_2", "UdfFin2")

        # Días de entrega permitidos: SAP guarda 'S'/'N' en cada UDF.
        # Igual que arriba: si el UDF no existe en esta base, se deja lo que
        # ya estuviera guardado (que puede venir del Excel) en vez de
        # ponerlo todo en True y perder las restricciones.
        for campo in UDF_DIAS:
            columna = f"Udf_{campo}"
            if hasattr(row, columna):
                valor = getattr(row, columna)
                setattr(destino, campo, str(valor).strip().upper() == "S" if valor is not None else True)

        _si_vino("contacto", "UdfContacto")
        _si_vino("telefono", "UdfTelefono")
        _si_vino("referencias", "UdfReferencias")

        if has_geo_udf and getattr(row, "UdfLat", None) and getattr(row, "UdfLng", None):
            if coordenada_creible(row.UdfLat, row.UdfLng):
                destino.latitude = row.UdfLat
                destino.longitude = row.UdfLng
            else:
                # Coordenada imposible: se descarta y el destino queda como
                # "sin georreferencia", que es la alerta que el despachador
                # ya sabe leer. Guardarla sería peor que no tenerla —
                # mandaría al camión a otro país sin avisar.
                coordenadas_invalidas.append(
                    f"{row.CardCode} {row.Address}: {row.UdfLat}, {row.UdfLng}"
                )
        # Si SAP no trae lat/long, NO se geocodifica contra ningún servicio
        # externo (eso mandaría la dirección del cliente a un tercero sin
        # avisar). Se deja sin coordenada y el panel lo marca como alerta
        # ("Sin georreferencia en SAP B1", ver api.py) hasta que Carlos
        # llene U_Latitud/U_Longitud en CRD1.

        destino.save()
        destinos_por_doc_entry[row.DocEntry] = destino

    return destinos_por_doc_entry, coordenadas_invalidas


def _mapear_remisiones(rows, destinos_por_doc_entry, lineas_por_pedido):
    """
    Crea o actualiza la Remision y sus LineaRemision de cada renglón traído
    de SAP, usando los Destino ya resueltos por `_mapear_destinos`.
    Devuelve cuántas remisiones se procesaron.
    """
    imported_count = 0

    for row in rows:
        destino = destinos_por_doc_entry[row.DocEntry]

        # Crear o actualizar Remision. "estado" NO va en defaults a propósito:
        # el auto-sync del frontend llama esto cada 45s para TODOS los
        # pedidos del día, no solo los nuevos. Si "estado" fuera parte de
        # defaults, cada corrida regresaría a "Pendiente" hasta los pedidos
        # que el optimizador ya había dejado "Asignado" segundos antes. El
        # modelo ya trae default='Pendiente' para cuando el registro es
        # nuevo; en un update simplemente no se toca el estado actual.
        remision, _ = Remision.objects.update_or_create(
            doc_entry=row.DocEntry,
            defaults={
                "doc_num": row.DocNum,
                "card_code": row.CardCode,
                "card_name": row.CardName,
                # DocDate = el día en que se CAPTURÓ la entrega, que es por
                # el que filtra la consulta de arriba (WHERE O.DocDate = ?)
                # y por el que pregunta todo el panel (`doc_date=fecha`).
                #
                # Antes aquí se guardaba `DocDueDate`, la fecha de
                # vencimiento. Hoy funciona de casualidad porque SAP copia
                # una en la otra al crear el documento; el día que un
                # capturista toque el vencimiento a mano, ese pedido se
                # pide con una fecha y se guarda con otra, así que
                # DESAPARECE del panel — y peor, la limpieza de sobrantes
                # del final (que filtra por doc_date) podría borrar pedidos
                # buenos de otro día.
                #
                # La regla del negocio "la entrega capturada hoy sale
                # mañana" NO se guarda aquí: vive en el endpoint /jornada,
                # que traduce día de captura -> día de reparto. Esta columna
                # es el dato crudo de SAP y nada más.
                "doc_date": row.DocDate,
                "doc_total": row.DocTotal,
                "slp_code": str(row.SlpCode),
                "slp_name": row.SlpName or "Vendedor General",
                "destino": destino,
                "peso_kg": float(row.PesoTotalKg) if getattr(row, "PesoTotalKg", None) else None,
            }
        )

        # Las líneas del pedido. `cantidad_entregada` NO va en defaults: el
        # auto-sync corre cada 45 s y borraría lo que el chofer ya confirmó
        # en la calle. Es el mismo cuidado que se tiene con `estado`.
        for linea in lineas_por_pedido.get(row.DocEntry, []):
            LineaRemision.objects.update_or_create(
                remision=remision,
                line_num=linea.LineNum,
                defaults={
                    "item_code": linea.ItemCode,
                    "descripcion": linea.Dscription or linea.ItemCode,
                    "unidad": linea.unitMsr,
                    "cantidad": linea.Quantity,
                    "piezas_por_unidad": linea.PiezasPorUnidad,
                    "peso_unitario_kg": float(linea.SWeight1) if linea.SWeight1 else None,
                },
            )

        imported_count += 1

    return imported_count


def _limpiar_sobrantes(fecha: date, doc_entries_sap):
    """
    Lo que ya no está en SAP, tampoco debe quedar aquí.

    Sin esto la base solo crece: guarda lo que llega y nunca suelta lo que
    dejó de venir. Así quedaron 19 registros del 29-jul con folios 250xxx
    y 251xxx, sobrevivientes de cuando esto leía órdenes de VENTA. Los
    números se repiten entre tipos de documento —la orden de venta 251038
    de julio y la entrega 251038 de febrero son documentos distintos con el
    mismo folio— así que en el panel se veían como entregas de hoy y en SAP
    aparecían con fecha de febrero.

    NO se toca lo que ya salió: si una ruta está Cargando, Listo, En_Ruta o
    Finalizada, sus pedidos se quedan aunque SAP ya no los mande. Borrar un
    pedido que va en un camión sería peor que dejar uno de más.

    Y TAMPOCO lo que ya se entregó, que es un candado aparte y hace falta.
    El de arriba mira el estado de la RUTA, y con eso no basta por dos
    razones: una remisión puede quedar con `ruta = NULL` (al re-optimizar
    se borran las rutas Borrador y el `SET_NULL` las suelta), y con la ruta
    en NULL el `exclude` de arriba no la excluye — el join no encuentra
    nada y pasa derecho al delete. Lo que se perdía era la foto, la firma,
    la hora y las cantidades por renglón: la ÚNICA prueba de que la
    mercancía se entregó, y no se puede volver a pedir a SAP.

    Un pedido de más en el panel se ve y se corrige. Una entrega borrada
    no deja rastro: el mensaje solo diría "se quitó 1 que ya no está".
    """
    sobrantes = (
        Remision.objects
        .filter(doc_date=fecha)
        .exclude(doc_entry__in=doc_entries_sap)
        .exclude(ruta__estado__in=ESTADOS_RUTA_DESPACHADA)
        .exclude(estado__in=ESTADOS_ENTREGA_FINAL)
    )
    borradas = sobrantes.count()
    sobrantes.delete()
    return borradas


@transaction.atomic
def sync_from_sap(fecha: date):
    """
    Sincroniza pedidos pendientes de entregar desde la base de datos de SAP B1.

    Si no está configurada o falla la conexión, lo REPORTA. No inventa nada: la
    vía de datos de prueba se eliminó junto con `test_data.py`, y tener dos
    fuentes de verdad era justo lo que hacía que un sync borrara lo cargado por
    el otro lado.
    """
    sin_configurar = revisar_configuracion()
    if sin_configurar:
        return {"status": "warning", "message": sin_configurar}

    # SOLO conectar() y las dos consultas SQL van dentro de este try: eso es
    # lo único que de verdad puede ser un problema de red, credenciales o
    # driver ODBC. El mapeo de después (Destino, Remision, LineaRemision, la
    # limpieza de sobrantes) es lógica de Python pura y queda FUERA a
    # propósito: si algo ahí truena —un AttributeError, un IntegrityError por
    # folio duplicado, un None donde se esperaba número— tiene que salir como
    # el bug de Python que es, con su propio traceback, y no reportado como
    # "Falló la conexión con SAP B1" (que manda a quien lo lea a revisar la
    # red y el cable en vez del bug real).
    try:
        rows, lineas_por_pedido, has_geo_udf, has_window_udf = _traer_de_sap(fecha)
    except Exception as e:
        return {"status": "error", "message": f"Falló la conexión con SAP B1: {e}"}

    # Los DocEntry que SAP mandó para este día. Sirve al final para quitar de
    # la base lo que ya no viene (ver `_limpiar_sobrantes`).
    doc_entries_sap = {row.DocEntry for row in rows}

    destinos_por_doc_entry, coordenadas_invalidas = _mapear_destinos(rows, has_geo_udf, has_window_udf)
    imported_count = _mapear_remisiones(rows, destinos_por_doc_entry, lineas_por_pedido)
    borradas = _limpiar_sobrantes(fecha, doc_entries_sap)

    mensaje = f"Sincronizados {imported_count} pedidos reales desde SAP B1."
    if borradas:
        mensaje += f" Se quitaron {borradas} que ya no están en SAP."
    if coordenadas_invalidas:
        mensaje += (
            f" OJO: {len(coordenadas_invalidas)} destino(s) traen coordenadas"
            f" imposibles en SAP y se dejaron sin ubicar: "
            + "; ".join(coordenadas_invalidas[:3])
            + ("…" if len(coordenadas_invalidas) > 3 else "")
        )
    return {"status": "success", "message": mensaje}
