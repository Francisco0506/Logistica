"""
Lo que el chofer reporta desde la calle.

Es el único dato del sistema que dice qué pasó DE VERDAD. Si aquí se guarda
algo que no corresponde, ventas le da información falsa al cliente y
facturación cobra lo que no se entregó — y nadie tiene cómo notarlo, porque el
sistema se ve igual de tranquilo.
"""
from django.test import TestCase

from delivery.models import Remision

from .factories import CENTRO, crear_destino, crear_linea, crear_pedido, crear_ruta

URL = "/api/chofer/paradas/{}/entregar"


class EstadoDeducidoDeLasCantidades(TestCase):
    """
    El estado NO se manda desde el celular: se DEDUCE de lo que se dejó.

    Si el celular pudiera mandarlo, podría quedar un pedido marcado como
    entregado completo con renglones a medias, que es justo lo que haría inútil
    el dato para facturación.
    """

    def _confirmar(self, pedido, **payload):
        r = self.client.post(URL.format(pedido.id), data=payload,
                             content_type="application/json")
        self.assertEqual(r.status_code, 200)
        return r.json()

    def test_sin_detalle_es_entrega_completa(self):
        """El camino normal, el 90% de las paradas: un solo toque."""
        pedido = crear_pedido(crear_destino(CENTRO))
        linea = crear_linea(pedido, cantidad=3)

        datos = self._confirmar(pedido, recibio="Sra. Martha")

        self.assertEqual(datos["estado"], "Entregado")
        pedido.refresh_from_db(); linea.refresh_from_db()
        self.assertEqual(pedido.estado, "Entregado")
        self.assertEqual(pedido.recibio, "Sra. Martha")
        self.assertIsNotNone(pedido.entregado_en)
        self.assertEqual(float(linea.cantidad_entregada), 3.0)

    def test_dejar_de_menos_en_un_renglon_es_entrega_parcial(self):
        pedido = crear_pedido(crear_destino(CENTRO))
        l1 = crear_linea(pedido, cantidad=3)
        crear_linea(pedido, cantidad=1)

        datos = self._confirmar(
            pedido,
            lineas=[{"linea_id": l1.id, "cantidad_entregada": 1.5}],
            motivo="cliente_rechazo",
        )

        self.assertEqual(datos["estado"], "Entregado_Parcial")

    def test_no_dejar_nada_es_no_entregado_aunque_se_manden_las_lineas(self):
        pedido = crear_pedido(crear_destino(CENTRO))
        linea = crear_linea(pedido, cantidad=3)

        datos = self._confirmar(
            pedido,
            lineas=[{"linea_id": linea.id, "cantidad_entregada": 0}],
            motivo="cerrado",
        )

        self.assertEqual(datos["estado"], "No_Entregado")

    def test_no_se_puede_entregar_mas_de_lo_que_traia(self):
        """Un dedazo del chofer no debe inventar mercancía que no iba."""
        pedido = crear_pedido(crear_destino(CENTRO))
        linea = crear_linea(pedido, cantidad=2)

        self._confirmar(pedido, lineas=[{"linea_id": linea.id, "cantidad_entregada": 99}])

        linea.refresh_from_db()
        self.assertEqual(float(linea.cantidad_entregada), 2.0)

    def test_cantidad_negativa_se_acota_en_cero(self):
        pedido = crear_pedido(crear_destino(CENTRO))
        linea = crear_linea(pedido, cantidad=2)

        self._confirmar(pedido, lineas=[{"linea_id": linea.id, "cantidad_entregada": -5}],
                        motivo="otro")

        linea.refresh_from_db()
        self.assertEqual(float(linea.cantidad_entregada), 0.0)


class PedidoSinRenglones(TestCase):
    """
    Cuando SAP no mandó las líneas no hay cantidades de dónde deducir nada, así
    que manda el motivo.

    Antes esta rama NUNCA podía llegar a 'No_Entregado': el chofer marcaba "el
    cliente estaba cerrado" y quedaba guardado como 'Entregado_Parcial', que
    para ventas y facturación es lo contrario de lo que pasó.
    """

    def _confirmar(self, motivo=None):
        pedido = crear_pedido(crear_destino(CENTRO))
        payload = {"motivo": motivo} if motivo else {}
        r = self.client.post(URL.format(pedido.id), data=payload,
                             content_type="application/json")
        return r.json()["estado"]

    def test_sin_motivo_es_entrega_completa(self):
        self.assertEqual(self._confirmar(), "Entregado")

    def test_cliente_cerrado_es_no_entregado(self):
        self.assertEqual(self._confirmar("cerrado"), "No_Entregado")

    def test_nadie_quien_reciba_es_no_entregado(self):
        self.assertEqual(self._confirmar("sin_quien_reciba"), "No_Entregado")

    def test_sin_espacio_es_no_entregado(self):
        self.assertEqual(self._confirmar("sin_espacio"), "No_Entregado")

    def test_rechazo_parcial_si_es_entrega_parcial(self):
        """Aquí sí se bajó mercancía del camión, solo que menos."""
        self.assertEqual(self._confirmar("cliente_rechazo"), "Entregado_Parcial")

    def test_producto_danado_es_entrega_parcial(self):
        self.assertEqual(self._confirmar("producto_danado"), "Entregado_Parcial")

    def test_los_motivos_sin_entrega_son_un_subconjunto_del_catalogo(self):
        """Un motivo mal escrito aquí nunca dispararía, en silencio."""
        catalogo = {codigo for codigo, _ in Remision.MOTIVOS}
        self.assertTrue(set(Remision.MOTIVOS_SIN_ENTREGA) <= catalogo)


class ErroresQueNoDebenPasarPorExito(TestCase):
    def test_un_pedido_que_no_existe_no_dice_que_se_entrego(self):
        r = self.client.post(URL.format(999999), data={}, content_type="application/json")
        self.assertEqual(r.json()["status"], "error")
        self.assertNotIn("estado", r.json())


class ReSincronizarNoBorraLoQueElChoferReporto(TestCase):
    def test_el_estado_y_las_cantidades_sobreviven(self):
        """
        El panel auto-sincroniza cada 45 s para TODOS los pedidos del día. Si el
        sync tocara `estado` o `cantidad_entregada`, borraría lo que el chofer
        acaba de capturar en la calle — y volvería a pasar cada 45 segundos.

        Se prueba el efecto (una escritura de sync no pisa el reporte) en vez de
        la implementación.
        """
        pedido = crear_pedido(crear_destino(CENTRO))
        linea = crear_linea(pedido, cantidad=3)
        self.client.post(URL.format(pedido.id),
                         data={"lineas": [{"linea_id": linea.id, "cantidad_entregada": 1}],
                               "motivo": "producto_danado"},
                         content_type="application/json")

        # Lo que hace el sync: update_or_create por doc_entry, SIN 'estado' ni
        # 'cantidad_entregada' en los defaults.
        Remision.objects.update_or_create(
            doc_entry=pedido.doc_entry,
            defaults={"card_name": "NOMBRE ACTUALIZADO EN SAP", "doc_total": 2000},
        )

        pedido.refresh_from_db(); linea.refresh_from_db()
        self.assertEqual(pedido.card_name, "NOMBRE ACTUALIZADO EN SAP")
        self.assertEqual(pedido.estado, "Entregado_Parcial")
        self.assertEqual(float(linea.cantidad_entregada), 1.0)
