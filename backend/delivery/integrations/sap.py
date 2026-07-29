import os
from datetime import date
from django.db import transaction
from ..models import Remision, Destino, LineaRemision
from dotenv import load_dotenv

load_dotenv()

# Intentar importar pyodbc para SQL Server (SAP B1 estándar)
try:
    import pyodbc
    HAS_PYODBC = True
except ImportError:
    HAS_PYODBC = False


# México va de la longitud -118 (Baja California) a la -86 (Quintana Roo), y de
# la latitud 14 (Chiapas) a la 33 (frontera norte). Cualquier cosa fuera de ahí
# es un error de captura, no un cliente lejano.
#
# El caso que lo destapó (28-jul-2026): RANCHO DE LA CRUZ tenía la longitud
# 100.376191 SIN el signo menos, así que caía en China. OSRM no podía llegar,
# devolvía tramos nulos y tumbaba el optimizador entero con un error 500 —el
# despachador solo veía "falló" sin saber por qué.
#
# El rango se deja a nivel país a propósito, no al área metropolitana: hay
# clientes reales en Nuevo Laredo (a 200 km) y en Ciudad Victoria, y acotarlo a
# Monterrey los estaría tirando por buenos.
LAT_MEXICO = (14.0, 33.0)
LNG_MEXICO = (-118.0, -86.0)


def _coordenada_creible(lat, lng):
    """¿Esta coordenada puede ser de un cliente en México?"""
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    if lat == 0 or lng == 0:
        return False
    return (LAT_MEXICO[0] <= lat <= LAT_MEXICO[1]
            and LNG_MEXICO[0] <= lng <= LNG_MEXICO[1])

@transaction.atomic
def sync_from_sap(fecha: date):
    """
    Sincroniza pedidos pendientes de entregar desde la base de datos de SAP B1.
    Si no está configurada o falla la conexión, usa datos de prueba.
    """
    db_host = os.getenv("SAP_DB_HOST")
    db_name = os.getenv("SAP_DB_NAME")
    db_user = os.getenv("SAP_DB_USER")
    db_password = os.getenv("SAP_DB_PASSWORD")
    db_port = os.getenv("SAP_DB_PORT", "1433")

    # Si no están las credenciales configuradas, no inventar pedidos: reportarlo
    # tal cual. Para probar el optimizador sin SAP, usar "Cargar pedidos de
    # prueba" (cargar_pedidos_prueba en test_data.py), que usa destinos reales
    # ya importados en vez de datos inventados.
    if not HAS_PYODBC or not db_host or not db_password or "your_sap" in db_password:
        return {"status": "warning", "message": "SAP B1 no está configurado. Usa 'Cargar pedidos de prueba' para probar sin SAP."}

    # El driver varía por versión de SQL Server: SQL Server 2012 (la base de
    # pruebas) no soporta "ODBC Driver 17", solo el Native Client 11.0 que
    # instala junto con SSMS/SQL Server. Configurable porque producción puede
    # correr una versión distinta.
    odbc_driver = os.getenv("SAP_ODBC_DRIVER", "ODBC Driver 17 for SQL Server")
    conn_str = f"DRIVER={{{odbc_driver}}};SERVER={db_host},{db_port};DATABASE={db_name};UID={db_user};PWD={db_password}"

    # Nombres de los UDF (campos definidos por el usuario) en SAP B1 que guardan
    # latitud/longitud y ventanas de horario del Ship-To. Se configuran por .env
    # porque cada instalación de SAP los nombra distinto y aún no se han confirmado
    # los nombres reales en la base de este cliente.
    udf_lat = os.getenv("SAP_UDF_LATITUDE", "U_Latitud")
    udf_lng = os.getenv("SAP_UDF_LONGITUDE", "U_Longitud")
    udf_ini1 = os.getenv("SAP_UDF_HORA_INI1", "U_IniRecibo1")
    udf_fin1 = os.getenv("SAP_UDF_HORA_FIN1", "U_FinRecibo1")
    udf_ini2 = os.getenv("SAP_UDF_HORA_INI2", "U_IniRecibo2")
    udf_fin2 = os.getenv("SAP_UDF_HORA_FIN2", "U_FinRecibo2")
    udf_dias = {
        "ent_lun": os.getenv("SAP_UDF_ENT_LUN", "U_EntLun"),
        "ent_mar": os.getenv("SAP_UDF_ENT_MAR", "U_EntMar"),
        "ent_mie": os.getenv("SAP_UDF_ENT_MIE", "U_EntMie"),
        "ent_jue": os.getenv("SAP_UDF_ENT_JUE", "U_EntJue"),
        "ent_vie": os.getenv("SAP_UDF_ENT_VIE", "U_EntVie"),
        "ent_sab": os.getenv("SAP_UDF_ENT_SAB", "U_EntSab"),
    }
    # A diferencia de lat/long y ventanas de horario, estos UDF no existen (aún)
    # en CRD1 de la base de pruebas — por eso el default es vacío en vez de un
    # nombre adivinado, y solo se piden si se configuran explícitamente en .env.
    udf_contacto = os.getenv("SAP_UDF_CONTACTO", "")
    udf_telefono = os.getenv("SAP_UDF_TELEFONO", "")
    udf_referencias = os.getenv("SAP_UDF_REFERENCIAS", "")

    try:
        conn = pyodbc.connect(conn_str, timeout=5)
        cursor = conn.cursor()

        # Qué UDF existen DE VERDAD en esta base, en vez de darlos por hecho.
        #
        # No todas las instalaciones tienen los mismos: la base de pruebas tiene
        # las ventanas de recibo y los días de entrega (U_IniRecibo1, U_EntLun…)
        # porque se crearon para este proyecto, pero LA PRODUCTIVA NO LOS TIENE
        # — ahí solo están U_Latitud y U_Longitud. Pedir una columna que no
        # existe tumba la consulta entera con "Invalid column name" y el
        # despachador se queda sin pedidos, sin saber por qué.
        #
        # Preguntando primero, la misma consulta sirve en las dos bases: donde
        # el campo existe se usa, y donde no, el destino queda sin ventana y el
        # optimizador lo trata como disponible todo el turno.
        cursor.execute(
            "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('CRD1')"
        )
        columnas_crd1 = {r[0].lower() for r in cursor.fetchall()}

        def existe(udf):
            return bool(udf) and udf.lower() in columnas_crd1

        has_geo_udf = existe(udf_lat) and existe(udf_lng)
        has_window_udf = existe(udf_ini1) and existe(udf_fin1)

        extra_cols = ""
        if has_geo_udf:
            extra_cols += f", A.{udf_lat} AS UdfLat, A.{udf_lng} AS UdfLng"
        if has_window_udf:
            extra_cols += f", A.{udf_ini1} AS UdfIni1, A.{udf_fin1} AS UdfFin1"
        if existe(udf_ini2) and existe(udf_fin2):
            extra_cols += f", A.{udf_ini2} AS UdfIni2, A.{udf_fin2} AS UdfFin2"
        for campo, udf in udf_dias.items():
            if existe(udf):
                extra_cols += f", A.{udf} AS Udf_{campo}"
        if existe(udf_contacto):
            extra_cols += f", A.{udf_contacto} AS UdfContacto"
        if existe(udf_telefono):
            extra_cols += f", A.{udf_telefono} AS UdfTelefono"
        if existe(udf_referencias):
            extra_cols += f", A.{udf_referencias} AS UdfReferencias"

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
                       -- peso de UNA unidad de este renglón, no de la caja:
                       -- misma cuenta que el total de arriba, con su conversión
                       -- a kilos y su respaldo por datos de compras.
                       ISNULL(L.NumPerMsr, 1) * CASE
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

        imported_count = 0
        # Coordenadas que SAP trae mal capturadas: se juntan para avisar en
        # el mismo mensaje del panel, en vez de descartarlas en silencio.
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

            if has_window_udf:
                destino.ini_recibo_1 = getattr(row, "UdfIni1", None)
                destino.fin_recibo_1 = getattr(row, "UdfFin1", None)

            destino.ini_recibo_2 = getattr(row, "UdfIni2", None)
            destino.fin_recibo_2 = getattr(row, "UdfFin2", None)

            # Días de entrega permitidos: SAP guarda 'S'/'N' en cada UDF
            for campo in udf_dias:
                valor = getattr(row, f"Udf_{campo}", None)
                setattr(destino, campo, str(valor).strip().upper() == "S" if valor is not None else True)

            destino.contacto = getattr(row, "UdfContacto", None)
            destino.telefono = getattr(row, "UdfTelefono", None)
            destino.referencias = getattr(row, "UdfReferencias", None)

            if has_geo_udf and getattr(row, "UdfLat", None) and getattr(row, "UdfLng", None):
                if _coordenada_creible(row.UdfLat, row.UdfLng):
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
                    "doc_date": row.DocDueDate,
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
                        "peso_unitario_kg": float(linea.SWeight1) if linea.SWeight1 else None,
                    },
                )

            imported_count += 1
            
        conn.close()
        mensaje = f"Sincronizados {imported_count} pedidos reales desde SAP B1."
        if coordenadas_invalidas:
            mensaje += (
                f" OJO: {len(coordenadas_invalidas)} destino(s) traen coordenadas"
                f" imposibles en SAP y se dejaron sin ubicar: "
                + "; ".join(coordenadas_invalidas[:3])
                + ("…" if len(coordenadas_invalidas) > 3 else "")
            )
        return {"status": "success", "message": mensaje}
        
    except Exception as e:
        return {"status": "error", "message": f"Falló la conexión con SAP B1: {e}"}
