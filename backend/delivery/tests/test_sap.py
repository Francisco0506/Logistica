"""
El sync de SAP: lo que NO debe borrar.

Los dos bugs más caros del proyecto vivían aquí, y los dos eran destructivos y
silenciosos: uno borraba pedidos buenos, el otro borraba las ventanas de recibo
cargadas por otro lado. Ninguno truena — simplemente al día siguiente falta
información y nadie sabe desde cuándo.

Como el sync habla con SQL Server, aquí se prueba contra una conexión de
mentiras que devuelve renglones controlados. Lo que se está probando es la
LÓGICA de qué se guarda y qué se borra, que es donde estaban los errores.
"""
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import TestCase

from delivery.integrations import sap
from delivery.models import Destino, Remision

from .factories import CENTRO, FECHA, crear_destino, crear_pedido, crear_ruta


def renglon(doc_entry, doc_num, **extra):
    """Un renglón como los que devuelve pyodbc: atributos por nombre de columna."""
    base = dict(
        DocEntry=doc_entry, DocNum=doc_num,
        CardCode="C1192", CardName="AMALAY FOODS",
        DocDate=FECHA, DocDueDate=date(2026, 7, 28),
        DocTotal=1500, SlpCode=7, DocStatus="O", SlpName="Vendedora",
        Address="AMALAY VALLE", Street="Calzada San Pedro", Block="Del Valle",
        City="Monterrey", ZipCode="66220", PesoTotalKg=123.4,
    )
    base.update(extra)
    return SimpleNamespace(**base)


class SyncFalso:
    """Prepara el sync para correr sin SQL Server."""

    def __init__(self, filas, columnas_crd1=(), lineas=()):
        self.filas = filas
        self.columnas_crd1 = columnas_crd1
        self.lineas = lineas

    def __enter__(self):
        cursor = MagicMock()
        # 1ª consulta: qué UDF existen. 2ª: los pedidos. 3ª: las líneas.
        cursor.fetchall.side_effect = [
            [(c,) for c in self.columnas_crd1],
            self.filas,
            list(self.lineas),
        ]
        conexion = MagicMock()
        conexion.cursor.return_value = cursor

        self._parches = [
            patch.object(sap, "HAS_PYODBC", True),
            patch.object(sap, "pyodbc", MagicMock(connect=MagicMock(return_value=conexion)), create=True),
            patch.dict("os.environ", {
                "SAP_DB_HOST": "servidor", "SAP_DB_NAME": "base",
                "SAP_DB_USER": "u", "SAP_DB_PASSWORD": "secreto",
            }),
        ]
        for p in self._parches:
            p.start()
        return self

    def __exit__(self, *a):
        for p in self._parches:
            p.stop()


class LaFechaConLaQueSeGuarda(TestCase):
    def test_se_guarda_la_fecha_de_CAPTURA_la_misma_por_la_que_se_filtro(self):
        """
        La consulta filtra `WHERE O.DocDate = ?` y el panel pregunta por
        `doc_date`. Guardar `DocDueDate` —que es otra columna— hacía que el
        pedido se pidiera con una fecha y se guardara con otra: desaparecía del
        panel, y la limpieza de sobrantes (que filtra por doc_date) podía
        borrar pedidos buenos de otro día.

        Hoy funciona de casualidad porque SAP copia una fecha en la otra al
        crear el documento. Esta prueba fija la intención: manda la de captura.
        """
        with SyncFalso([renglon(1, 250001)]):
            res = sap.sync_from_sap(FECHA)

        self.assertEqual(res["status"], "success")
        self.assertEqual(Remision.objects.get(doc_num=250001).doc_date, FECHA)


class UdfQueNoExistenEnEstaBase(TestCase):
    """
    La base productiva NO tiene los UDF de ventanas de recibo ni de contacto:
    solo U_Latitud y U_Longitud. El sync tiene que trabajar con lo que haya.
    """

    def test_no_se_piden_columnas_que_no_existen(self):
        """Pedir una columna inexistente tumba la consulta entera con
        'Invalid column name' y el despachador se queda sin pedidos."""
        with SyncFalso([renglon(1, 250001)], columnas_crd1=["u_latitud", "u_longitud"]):
            res = sap.sync_from_sap(FECHA)
        self.assertEqual(res["status"], "success")

    def test_un_sync_sin_esos_udf_NO_borra_los_horarios_ya_cargados(self):
        """
        El bug más caro del archivo. Los horarios se cargaban por otro lado, y
        como `getattr(row, "UdfIni2", None)` devuelve None cuando la columna no
        vino, cada sync los ponía en NULL: el optimizador volvía a planear como
        si todos los clientes recibieran a cualquier hora.

        Y como el panel auto-sincroniza cada 45 s, no había forma de ver de
        dónde salió.
        """
        destino = Destino.objects.create(
            card_code="C1192", ship_to_code="AMALAY VALLE",
            latitude=CENTRO[0], longitude=CENTRO[1],
            ini_recibo_2=time(16, 0), fin_recibo_2=time(20, 0),
            contacto="Sra. Martha", telefono="8112345678",
            referencias="Portón azul", ent_sab=False,
        )

        with SyncFalso([renglon(1, 250001)], columnas_crd1=["u_latitud", "u_longitud"]):
            sap.sync_from_sap(FECHA)

        destino.refresh_from_db()
        self.assertEqual(destino.ini_recibo_2, time(16, 0))
        self.assertEqual(destino.fin_recibo_2, time(20, 0))
        self.assertEqual(destino.contacto, "Sra. Martha")
        self.assertEqual(destino.telefono, "8112345678")
        self.assertEqual(destino.referencias, "Portón azul")
        self.assertFalse(destino.ent_sab, "el sábado restringido se perdía")


class CoordenadasImposibles(TestCase):
    def test_una_coordenada_fuera_de_mexico_se_descarta_y_se_avisa(self):
        """
        RANCHO DE LA CRUZ tenía la longitud SIN el signo menos, así que caía en
        China: OSRM no podía llegar, devolvía tramos nulos y tumbaba el
        optimizador con un 500 que no decía qué destino lo causaba.

        Guardarla sería peor que no tenerla: mandaría al camión a otro país.
        """
        with SyncFalso(
            [renglon(1, 250001, UdfLat=25.67, UdfLng=100.3762)],   # sin el menos
            columnas_crd1=["u_latitud", "u_longitud"],
        ):
            res = sap.sync_from_sap(FECHA)

        self.assertIn("coordenadas", res["message"])
        self.assertIsNone(Destino.objects.get(card_code="C1192").longitude)

    def test_una_coordenada_valida_si_se_guarda(self):
        with SyncFalso(
            [renglon(1, 250001, UdfLat=25.67, UdfLng=-100.3762)],
            columnas_crd1=["u_latitud", "u_longitud"],
        ):
            sap.sync_from_sap(FECHA)
        self.assertAlmostEqual(Destino.objects.get(card_code="C1192").longitude, -100.3762)

    def test_las_coordenadas_en_cero_no_cuentan_como_ubicacion(self):
        self.assertFalse(sap._coordenada_creible(0, 0))
        self.assertFalse(sap._coordenada_creible(None, None))
        self.assertFalse(sap._coordenada_creible("", ""))
        self.assertTrue(sap._coordenada_creible(25.67, -100.37))


class LimpiezaDeSobrantes(TestCase):
    def test_lo_que_ya_no_viene_de_sap_se_quita(self):
        """
        Sin esto la base solo crece: quedaron 19 registros de cuando el sync
        leía órdenes de VENTA, con folios que se repiten entre tipos de
        documento, y en el panel se veían como entregas de hoy.
        """
        crear_pedido(crear_destino(CENTRO), doc_num=999001)

        with SyncFalso([renglon(1, 250001)]):
            res = sap.sync_from_sap(FECHA)

        self.assertIn("Se quitaron 1", res["message"])
        self.assertFalse(Remision.objects.filter(doc_num=999001).exists())

    def test_lo_que_YA_VA_EN_UN_CAMION_no_se_toca(self):
        """
        Borrar un pedido que va arriba de un camión es peor que dejar uno de
        más: el chofer trae mercancía que el sistema cree en otro lado.
        """
        for estado_ruta in ['Cargando', 'Listo', 'En_Ruta', 'Finalizada']:
            with self.subTest(estado=estado_ruta):
                ruta = crear_ruta(camion=f"CAM-{estado_ruta}", estado=estado_ruta)
                pedido = crear_pedido(crear_destino(CENTRO), ruta=ruta, secuencia=1)

                with SyncFalso([renglon(1, 250001)]):
                    sap.sync_from_sap(FECHA)

                self.assertTrue(
                    Remision.objects.filter(id=pedido.id).exists(),
                    f"se borró un pedido de una ruta {estado_ruta}",
                )

    def test_un_pedido_en_borrador_si_se_puede_quitar(self):
        ruta = crear_ruta(estado='Borrador')
        pedido = crear_pedido(crear_destino(CENTRO), ruta=ruta, secuencia=1)

        with SyncFalso([renglon(1, 250001)]):
            sap.sync_from_sap(FECHA)

        self.assertFalse(Remision.objects.filter(id=pedido.id).exists())

    def test_no_se_tocan_los_pedidos_de_OTRO_dia(self):
        otro_dia = crear_pedido(crear_destino(CENTRO), fecha=date(2026, 7, 20))

        with SyncFalso([renglon(1, 250001)]):
            sap.sync_from_sap(FECHA)

        self.assertTrue(Remision.objects.filter(id=otro_dia.id).exists())


class SinConfiguracion(TestCase):
    def test_sin_credenciales_lo_dice_en_vez_de_inventar_pedidos(self):
        with patch.dict("os.environ", {"SAP_DB_HOST": "", "SAP_DB_PASSWORD": ""}):
            res = sap.sync_from_sap(FECHA)
        self.assertEqual(res["status"], "warning")
        self.assertEqual(Remision.objects.count(), 0)
