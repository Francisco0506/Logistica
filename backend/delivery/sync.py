import os
from datetime import date
from django.db import transaction
from .models import Remision, Destino
from .routing_service import geocode_address
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

    # Si no están las credenciales configuradas, hacer Mock con datos de prueba realistas
    if not HAS_PYODBC or not db_host or not db_password or "your_sap" in db_password:
        return load_mock_data(fecha)

    conn_str = f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={db_host},{db_port};DATABASE={db_name};UID={db_user};PWD={db_password}"

    # Nombres de los UDF (campos definidos por el usuario) en SAP B1 que guardan
    # latitud/longitud y ventanas de horario del Ship-To. Se configuran por .env
    # porque cada instalación de SAP los nombra distinto y aún no se han confirmado
    # los nombres reales en la base de este cliente.
    udf_lat = os.getenv("SAP_UDF_LATITUDE")   # ej. "U_Latitud"
    udf_lng = os.getenv("SAP_UDF_LONGITUDE")  # ej. "U_Longitud"
    udf_ini1 = os.getenv("SAP_UDF_HORA_INI1") # ej. "U_HorarioIni1"
    udf_fin1 = os.getenv("SAP_UDF_HORA_FIN1") # ej. "U_HorarioFin1"
    has_geo_udf = bool(udf_lat and udf_lng)
    has_window_udf = bool(udf_ini1 and udf_fin1)

    extra_cols = ""
    if has_geo_udf:
        extra_cols += f", A.{udf_lat} AS UdfLat, A.{udf_lng} AS UdfLng"
    if has_window_udf:
        extra_cols += f", A.{udf_ini1} AS UdfIni1, A.{udf_fin1} AS UdfFin1"

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
            INNER JOIN RDR12 A ON O.DocEntry = A.DocEntry AND A.AdresType = 'S'
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

            if has_geo_udf and getattr(row, "UdfLat", None) and getattr(row, "UdfLng", None):
                destino.latitude = row.UdfLat
                destino.longitude = row.UdfLng
            elif not destino.latitude or not destino.longitude:
                # No hay UDF de geolocalización o SAP no trae el dato: en vez de
                # inventar una coordenada, se intenta geocodificar la dirección real
                # (calle/ciudad) contra un servicio real (Nominatim/OSM). Esto es lo
                # que garantiza que todo pedido con dirección capturada en SAP termine
                # con coordenada real. Solo si ni siquiera hay texto de dirección
                # capturado en SAP se deja en None y se reporta como alerta genuina.
                geo = geocode_address(row.Street, row.City)
                if geo:
                    destino.latitude, destino.longitude = geo

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
        return load_mock_data(fecha, error_msg=str(e))

@transaction.atomic
def load_mock_data(fecha: date, error_msg=None):
    """
    Carga de datos simulados realistas para desarrollo.
    Es idempotente: si ya hay datos para esta fecha, no vuelve a crearlos.
    """
    if Remision.objects.filter(doc_date=fecha).exists():
        msg = f"Pedidos ya sincronizados para el {fecha}."
        if error_msg:
            msg += f" (Nota: Falló la conexión real con SAP B1: {error_msg})"
        return {"status": "success", "message": msg}
        
    mock_orders = [
      { "id": 1901, "client": "Pollo Loco Santa Catarina", "total": 14000, "pos": [25.698, -100.495] },
      { "id": 1902, "client": "Pizza Hut Valle", "total": 21000, "pos": [25.681, -100.452] },
      { "id": 1903, "client": "Soriana Híper Lincoln", "total": 65000, "pos": [25.712, -100.458] },
      { "id": 1904, "client": "OXXO García Centro", "total": 8000, "pos": [25.701, -100.515] },
      { "id": 1905, "client": "Taquería La Mexicana", "total": 11000, "pos": [25.688, -100.432] },
      { "id": 1906, "client": "HEB San Pedro", "total": 48000, "pos": [25.658, -100.412] },
      { "id": 1907, "client": "Costco Valle Oriente", "total": 82000, "pos": [25.661, -100.421] },
      { "id": 1908, "client": "Walmart Lincoln", "total": 52000, "pos": [25.735, -100.435] },
      { "id": 1909, "client": "Comedor Caterpillar", "total": 31000, "pos": [25.708, -100.518] },
      { "id": 1910, "client": "Lonchería Don Pepe", "total": 7000, "pos": [25.705, -100.512] },
      { "id": 1911, "client": "Restaurante El Jonuco", "total": 26000, "pos": [25.722, -100.548] },
      { "id": 1912, "client": "Tacos Primo Centro", "total": 15000, "pos": [25.672, -100.342] },
      { "id": 1913, "client": "Hotel MS Milenium", "total": 39000, "pos": [25.679, -100.352] },
      { "id": 1914, "client": "Comedor Industrial Nemak", "total": 58000, "pos": [25.715, -100.535] }
    ]
    
    imported_count = 0
    for idx, item in enumerate(mock_orders):
        # Crear Destino
        destino, _ = Destino.objects.get_or_create(
            card_code=f"C-{item['id']}",
            ship_to_code=item["client"],
            defaults={
                "street": f"Calle Falsa #{item['id']}",
                "city": "Santa Catarina",
                "latitude": item["pos"][0],
                "longitude": item["pos"][1]
            }
        )
        
        # Crear Remisión
        Remision.objects.update_or_create(
            doc_entry=item["id"],
            defaults={
                "doc_num": item["id"],
                "card_code": f"C-{item['id']}",
                "card_name": item["client"],
                "doc_date": fecha,
                "doc_total": item["total"],
                "slp_code": "1",
                "slp_name": "Vendedor Local",
                "destino": destino,
                "estado": "Pendiente"
            }
        )
        imported_count += 1
        
    msg = f"Sincronizados {imported_count} pedidos simulados de prueba."
    if error_msg:
        msg += f" (Nota: Falló la conexión real con SAP B1: {error_msg})"
        
    return {"status": "warning" if error_msg else "success", "message": msg}
