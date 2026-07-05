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

    # Si no están las credenciales configuradas, hacer Mock con datos de prueba realistas
    if not HAS_PYODBC or not db_host or "your_sap" in db_password:
        return load_mock_data(fecha)

    conn_str = f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={db_host},{db_port};DATABASE={db_name};UID={db_user};PWD={db_password}"
    
    try:
        conn = pyodbc.connect(conn_str, timeout=5)
        cursor = conn.cursor()
        
        # Consulta SQL segura de lectura (SELECT) para obtener pedidos pendientes
        query = """
            SELECT 
                O.DocEntry, 
                O.DocNum, 
                O.CardCode, 
                O.CardName, 
                O.DocDueDate, 
                O.DocTotal, 
                O.SlpCode,
                (SELECT SlpName FROM OSLP WHERE SlpCode = O.SlpCode) as SlpName,
                A.Street,
                A.Block,
                A.City,
                A.ZipCode
            FROM ORDR O
            INNER JOIN RDR12 A ON O.DocEntry = A.DocEntry AND A.AdresType = 'S'
            WHERE O.DocStatus = 'O' AND O.DocDueDate = ?
        """
        cursor.execute(query, str(fecha))
        rows = cursor.fetchall()
        
        imported_count = 0
        for row in rows:
            # Crear o actualizar Destino
            destino, _ = Destino.objects.get_or_create(
                card_code=row.CardCode,
                ship_to_code=row.Street or "Dirección Principal",
                defaults={
                    "street": row.Street,
                    "block": row.Block,
                    "city": row.City,
                    "zip_code": row.ZipCode
                }
            )

            # Si no tiene coordenadas, simulamos una
            if not destino.latitude or not destino.longitude:
                import random
                lat = 25.6932 + random.uniform(-0.05, 0.05)
                lng = -100.4816 + random.uniform(-0.05, 0.05)
                destino.latitude = lat
                destino.longitude = lng
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
    """
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
