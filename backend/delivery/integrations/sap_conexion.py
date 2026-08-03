"""
Cómo se conecta uno a SAP B1 y qué campos tiene ESTA instalación.

Vive aparte de `sap.py` porque son dos cosas distintas: aquí está todo lo que
depende de CÓMO está montado el SQL Server del cliente —driver, timeouts, qué
UDF existen— y allá lo que se hace con los datos. Cuando algo falla al conectar,
el problema está en este archivo y no hay que leer 500 líneas de mapeo para
descartarlo.

TODO AQUÍ ES DE SOLO LECTURA. Este sistema nunca escribe en SAP.
"""
import os

from dotenv import load_dotenv

load_dotenv()

# pyodbc puede no estar: en macOS el driver de Microsoft se instala aparte y es
# el punto más probable de falla al mover esto a la Mac del cliente.
try:
    import pyodbc
    HAS_PYODBC = True
except ImportError:
    HAS_PYODBC = False


# Segundos que se espera una CONSULTA. Es distinto del timeout de conexión, que
# es solo el de login.
#
# Sin esto las dos consultas grandes se podían colgar INDEFINIDAMENTE —un SQL
# Server bloqueado, la red que se cae a media sesión TCP— y como el panel
# sincroniza cada 45 s, cada minuto se acumulaba otra petición muerta.
#
# 45 s es holgado para lo medido (12,937 renglones de 60 días sin problema) y
# corta en seco lo que ya no va a contestar.
TIMEOUT_CONSULTA = int(os.getenv("SAP_TIMEOUT_CONSULTA", "45"))
TIMEOUT_LOGIN = 5

# Nombres de los UDF (campos definidos por el usuario) del Ship-To en `CRD1`.
# Se configuran por .env porque cada instalación de SAP los nombra distinto.
UDF = {
    "lat": os.getenv("SAP_UDF_LATITUDE", "U_Latitud"),
    "lng": os.getenv("SAP_UDF_LONGITUDE", "U_Longitud"),
    "ini1": os.getenv("SAP_UDF_HORA_INI1", "U_IniRecibo1"),
    "fin1": os.getenv("SAP_UDF_HORA_FIN1", "U_FinRecibo1"),
    "ini2": os.getenv("SAP_UDF_HORA_INI2", "U_IniRecibo2"),
    "fin2": os.getenv("SAP_UDF_HORA_FIN2", "U_FinRecibo2"),
    # A diferencia de los de arriba, estos NO existen (aún) en la base de
    # pruebas — por eso el default es vacío en vez de un nombre adivinado, y
    # solo se piden si se configuran explícitamente en .env.
    "contacto": os.getenv("SAP_UDF_CONTACTO", ""),
    "telefono": os.getenv("SAP_UDF_TELEFONO", ""),
    "referencias": os.getenv("SAP_UDF_REFERENCIAS", ""),
}

# Los días en que el cliente recibe. El optimizador ya los respeta; la base
# productiva todavía no los tiene capturados.
UDF_DIAS = {
    "ent_lun": os.getenv("SAP_UDF_ENT_LUN", "U_EntLun"),
    "ent_mar": os.getenv("SAP_UDF_ENT_MAR", "U_EntMar"),
    "ent_mie": os.getenv("SAP_UDF_ENT_MIE", "U_EntMie"),
    "ent_jue": os.getenv("SAP_UDF_ENT_JUE", "U_EntJue"),
    "ent_vie": os.getenv("SAP_UDF_ENT_VIE", "U_EntVie"),
    "ent_sab": os.getenv("SAP_UDF_ENT_SAB", "U_EntSab"),
}


def revisar_configuracion():
    """
    ¿Se puede siquiera intentar conectar? Devuelve un mensaje si NO, o None.

    El mensaje va directo a la pantalla del despachador, así que dice qué falta
    y dónde se pone. Antes mandaba al botón "Cargar pedidos de prueba" y al
    módulo `test_data.py`, los DOS eliminados: era la única instrucción que
    recibía quien abría el panel sin SAP, apuntando a algo que no existe.
    """
    password = os.getenv("SAP_DB_PASSWORD")
    if not HAS_PYODBC:
        falta = "el driver ODBC (pyodbc)"
    elif not os.getenv("SAP_DB_HOST") or not password or "your_sap" in password:
        falta = "SAP_DB_HOST y SAP_DB_PASSWORD en backend/.env"
    else:
        return None
    return (
        f"SAP B1 no está configurado: falta {falta}. "
        "Los pedidos que se ven son los que ya estaban en la base."
    )


def cadena_de_conexion():
    """
    El driver varía por versión de SQL Server y por sistema operativo:

      · SQL Server 2012 (la base de pruebas) NO soporta "ODBC Driver 17":
        solo el Native Client 11.0 que se instala junto con SSMS.
      · En macOS el Native Client no existe. Ahí es el 18, que además exige TLS
        y necesita `;Encrypt=no;TrustServerCertificate=yes`.
    """
    driver = os.getenv("SAP_ODBC_DRIVER") or "ODBC Driver 17 for SQL Server"
    return (
        f"DRIVER={{{driver}}};"
        f"SERVER={os.getenv('SAP_DB_HOST')},{os.getenv('SAP_DB_PORT', '1433')};"
        f"DATABASE={os.getenv('SAP_DB_NAME')};"
        f"UID={os.getenv('SAP_DB_USER')};"
        f"PWD={os.getenv('SAP_DB_PASSWORD')}"
    )


def conectar():
    """Abre la conexión con los dos timeouts puestos."""
    conn = pyodbc.connect(cadena_de_conexion(), timeout=TIMEOUT_LOGIN)
    conn.timeout = TIMEOUT_CONSULTA
    return conn


class CamposDisponibles:
    """
    Qué UDF existen DE VERDAD en esta base, en vez de darlos por hecho.

    No todas las instalaciones tienen los mismos: la base de pruebas tiene las
    ventanas de recibo y los días de entrega (`U_IniRecibo1`, `U_EntLun`…)
    porque se crearon para este proyecto, pero **la productiva no los tiene** —
    ahí solo están `U_Latitud` y `U_Longitud`.

    Pedir una columna que no existe tumba la consulta ENTERA con "Invalid column
    name", y el despachador se queda sin pedidos y sin saber por qué.
    Preguntando primero, la misma consulta sirve en las dos bases: donde el
    campo existe se usa, y donde no, el destino queda sin ventana y el
    optimizador lo trata como disponible todo el turno.
    """

    def __init__(self, cursor):
        cursor.execute("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('CRD1')")
        self._columnas = {r[0].lower() for r in cursor.fetchall()}

    def existe(self, udf):
        return bool(udf) and udf.lower() in self._columnas

    @property
    def hay_geo(self):
        return self.existe(UDF["lat"]) and self.existe(UDF["lng"])

    @property
    def hay_ventana(self):
        return self.existe(UDF["ini1"]) and self.existe(UDF["fin1"])

    def columnas_extra(self):
        """El fragmento de SELECT con solo los UDF que esta base sí tiene."""
        cols = ""
        if self.hay_geo:
            cols += f", A.{UDF['lat']} AS UdfLat, A.{UDF['lng']} AS UdfLng"
        if self.hay_ventana:
            cols += f", A.{UDF['ini1']} AS UdfIni1, A.{UDF['fin1']} AS UdfFin1"
        if self.existe(UDF["ini2"]) and self.existe(UDF["fin2"]):
            cols += f", A.{UDF['ini2']} AS UdfIni2, A.{UDF['fin2']} AS UdfFin2"
        for campo, udf in UDF_DIAS.items():
            if self.existe(udf):
                cols += f", A.{udf} AS Udf_{campo}"
        for nombre, alias in (("contacto", "UdfContacto"),
                              ("telefono", "UdfTelefono"),
                              ("referencias", "UdfReferencias")):
            if self.existe(UDF[nombre]):
                cols += f", A.{UDF[nombre]} AS {alias}"
        return cols


# México va de la longitud -118 (Baja California) a la -86 (Quintana Roo), y de
# la latitud 14 (Chiapas) a la 33 (frontera norte). Cualquier cosa fuera de ahí
# es un error de captura, no un cliente lejano.
#
# El caso que lo destapó (28-jul-2026): RANCHO DE LA CRUZ tenía la longitud
# 100.376191 SIN el signo menos, así que caía en China. OSRM no podía llegar,
# devolvía tramos nulos y tumbaba el optimizador entero con un error 500 — el
# despachador solo veía "falló" sin saber por qué.
#
# El rango se deja a nivel país a propósito, no al área metropolitana: hay
# clientes reales en Nuevo Laredo (a 200 km) y en Ciudad Victoria, y acotarlo a
# Monterrey los estaría tirando por buenos.
LAT_MEXICO = (14.0, 33.0)
LNG_MEXICO = (-118.0, -86.0)


def coordenada_creible(lat, lng):
    """¿Esta coordenada puede ser de un cliente en México?"""
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    if lat == 0 or lng == 0:
        return False
    return (LAT_MEXICO[0] <= lat <= LAT_MEXICO[1]
            and LNG_MEXICO[0] <= lng <= LNG_MEXICO[1])
