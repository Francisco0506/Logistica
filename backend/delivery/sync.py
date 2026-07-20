import os
from datetime import date
from django.db import transaction
from .models import Remision, Destino
from dotenv import load_dotenv

load_dotenv()

# Intentar importar pyodbc para SQL Server (SAP B1 estándar)
try:
    import pyodbc
    HAS_PYODBC = True
except ImportError:
    HAS_PYODBC = False

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

    has_geo_udf = bool(udf_lat and udf_lng)
    has_window_udf = bool(udf_ini1 and udf_fin1)

    extra_cols = ""
    if has_geo_udf:
        extra_cols += f", A.{udf_lat} AS UdfLat, A.{udf_lng} AS UdfLng"
    if has_window_udf:
        extra_cols += f", A.{udf_ini1} AS UdfIni1, A.{udf_fin1} AS UdfFin1"
    extra_cols += f", A.{udf_ini2} AS UdfIni2, A.{udf_fin2} AS UdfFin2"
    for campo, udf in udf_dias.items():
        extra_cols += f", A.{udf} AS Udf_{campo}"
    if udf_contacto:
        extra_cols += f", A.{udf_contacto} AS UdfContacto"
    if udf_telefono:
        extra_cols += f", A.{udf_telefono} AS UdfTelefono"
    if udf_referencias:
        extra_cols += f", A.{udf_referencias} AS UdfReferencias"

    try:
        conn = pyodbc.connect(conn_str, timeout=5)
        cursor = conn.cursor()

        # Consulta SQL segura de lectura (SELECT) para obtener pedidos pendientes.
        # A.Address es el ID real de la dirección del Ship-To en SAP (AdresID),
        # usado como identificador estable en vez del texto libre de la calle.
        #
        # El peso NO existe como campo de cabecera en SAP: se calcula sumando, por
        # cada línea del pedido (RDR1), la cantidad pedida por el peso unitario real
        # del artículo (OITM.SWeight1, campo estándar del maestro de artículos de
        # SAP B1 — no requiere UDF). Si un artículo no tiene peso capturado en su
        # ficha, cuenta como 0 y el pedido queda con el peso parcial de lo que sí
        # está capturado (mejor una subestimación que un peso 100% inventado).
        query = f"""
            SELECT
                O.DocEntry,
                O.DocNum,
                O.CardCode,
                O.CardName,
                O.DocDueDate,
                O.DocTotal,
                O.SlpCode,
                (SELECT SlpName FROM OSLP WHERE SlpCode = O.SlpCode) as SlpName,
                A.Address,
                A.Street,
                A.Block,
                A.City,
                A.ZipCode,
                (
                    SELECT SUM(L.Quantity * ISNULL(I.SWeight1, 0))
                    FROM RDR1 L
                    LEFT JOIN OITM I ON I.ItemCode = L.ItemCode
                    WHERE L.DocEntry = O.DocEntry
                ) AS PesoTotalKg
                {extra_cols}
            FROM ORDR O
            INNER JOIN CRD1 A ON O.CardCode = A.CardCode AND O.ShipToCode = A.Address AND A.AdresType = 'S'
            WHERE O.DocStatus = 'O' AND O.DocDueDate = ?
        """
        cursor.execute(query, str(fecha))
        rows = cursor.fetchall()
        
        imported_count = 0
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
                destino.latitude = row.UdfLat
                destino.longitude = row.UdfLng
            # Si SAP no trae lat/long, NO se geocodifica contra ningún servicio
            # externo (eso mandaría la dirección del cliente a un tercero sin
            # avisar). Se deja sin coordenada y el panel lo marca como alerta
            # ("Sin georreferencia en SAP B1", ver api.py) hasta que Carlos
            # llene U_Latitud/U_Longitud en CRD1.

            destino.save()

            # Crear o actualizar Remision
            Remision.objects.update_or_create(
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
                    "estado": "Pendiente"
                }
            )
            imported_count += 1
            
        conn.close()
        return {"status": "success", "message": f"Sincronizados {imported_count} pedidos reales desde SAP B1."}
        
    except Exception as e:
        return {"status": "error", "message": f"Falló la conexión con SAP B1: {e}"}
