"""
Qué pasa con las horas prometidas cuando el camión sale tarde.

El plan se arma suponiendo una hora de salida. La carga puede tardar horas, así
que al dar "Salida" se recalculan todas las ETAs desde el momento real.

Lo delicado es que recalcular NO vuelve a planear: conserva el ORDEN de las
paradas que armó el optimizador y solo lo recorre en el tiempo. Como las horas
de cierre de los clientes son fijas de reloj, cada hora de retraso empuja la
ruta entera contra ellas.

Medido con un día real de 37 paradas planeadas para salir a las 09:00:

    sale 10:00 ->  3 paradas llegan después de que el cliente cierra
    sale 11:00 -> 15
    sale 12:00 -> 23
    sale 13:00 -> 27 de 37

Eso pasaba EN SILENCIO: el panel decía "ETAs recalculadas" y ventas le prometía
al cliente una hora a la que ya no iba a haber quien recibiera.
"""
from datetime import date, datetime, time, timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from delivery.optimizer import manual
from delivery.optimizer.manual import recalcular_etas_desde_salida

from .factories import (
    CENTRO, FECHA, GUADALUPE, MatrizFalsa, crear_destino, crear_pedido, crear_ruta,
)

CEDIS = (25.693214524592616, -100.48167993202988)


def a_las(hora, minuto=0):
    """Un datetime de hoy a esa hora, en la zona del proyecto."""
    return timezone.localtime().replace(
        hour=hora, minute=minuto, second=0, microsecond=0)


class LasHorasSeRecorrenConLaSalidaReal(TestCase):
    def setUp(self):
        self.ruta = crear_ruta()
        # Cliente del centro que recibe de 09:00 a 13:00, que es la ventana más
        # común de la operación real (90 destinos cierran a las 13:00).
        self.destino = crear_destino(CENTRO, ini1=time(9, 0), fin1=time(13, 0))
        self.pedido = crear_pedido(destino=self.destino, ruta=self.ruta, secuencia=1)

    def _recalcular(self, hora_salida):
        with patch.object(manual, 'build_distance_time_matrices', MatrizFalsa()):
            return recalcular_etas_desde_salida(
                self.ruta, CEDIS, salida_dt=a_las(hora_salida))

    def test_saliendo_a_tiempo_nadie_queda_fuera(self):
        n, fuente, fuera = self._recalcular(9)
        self.assertEqual(n, 1)
        self.assertEqual(fuente, "osrm_sin_casetas")
        self.assertEqual(fuera, [])

    def test_saliendo_tarde_se_REPORTA_a_quien_ya_no_alcanza(self):
        """
        El caso que motivó todo esto. La hora se recalcula igual —el camión de
        verdad va a llegar a esa hora— pero ahora se DICE que ya no alcanza,
        que es lo único que permite reordenar o llamar al cliente.
        """
        n, _fuente, fuera = self._recalcular(14)     # dos horas después de que cierra
        self.assertEqual(n, 1)
        self.assertEqual([r.doc_num for r in fuera], [self.pedido.doc_num])

    def test_un_cliente_sin_horario_capturado_nunca_se_reporta(self):
        """
        La mayoría de los destinos de la base productiva no tienen la ventana
        capturada. Marcarlos como "fuera de horario" llenaría el aviso de ruido
        y volvería inútil la única señal que importa.
        """
        # En OTRO lugar a propósito: dos clientes en las mismas coordenadas son
        # UNA sola parada —el camión se estaciona una vez— y esa parada toma la
        # ventana del primero, así que compartir domicilio con el cliente de
        # arriba no probaría lo que dice el nombre de la prueba.
        destino = crear_destino(GUADALUPE)           # sin ini/fin
        crear_pedido(destino=destino, ruta=self.ruta, secuencia=2)
        _n, _fuente, fuera = self._recalcular(20)    # a las 8 de la noche
        self.assertNotIn(destino.id, [r.destino_id for r in fuera])

    def test_la_ETA_se_recorre_de_verdad_con_la_hora_de_salida(self):
        """Salir más tarde tiene que mover la hora prometida, no dejarla igual."""
        with patch.object(manual, 'build_distance_time_matrices', MatrizFalsa()):
            recalcular_etas_desde_salida(self.ruta, CEDIS, salida_dt=a_las(9))
            self.pedido.refresh_from_db()
            temprano = self.pedido.eta

            recalcular_etas_desde_salida(self.ruta, CEDIS, salida_dt=a_las(11))
            self.pedido.refresh_from_db()
            tarde = self.pedido.eta

        self.assertNotEqual(temprano, tarde)
        self.assertGreater(tarde, temprano)

    def test_una_ruta_sin_paradas_no_truena(self):
        """Devuelve la misma forma de siempre para que el llamador no reviente."""
        vacia = crear_ruta(camion="PP4873A")
        n, fuente, fuera = recalcular_etas_desde_salida(vacia, CEDIS)
        self.assertEqual((n, fuente, fuera), (0, None, []))


class SiOsrmNoContestaSeAvisa(TestCase):
    """
    `build_distance_time_matrices` nunca truena: si OSRM no responde devuelve
    línea recta, que es optimista (-15% al centro, -38% a Escobedo). Sin
    propagar la fuente, apretar "Salida" reescribía todas las horas con esos
    números y el panel decía "ETAs recalculadas" como si nada.
    """

    def test_la_fuente_llega_hasta_el_llamador(self):
        ruta = crear_ruta()
        destino = crear_destino(CENTRO, ini1=time(9, 0), fin1=time(18, 0))
        crear_pedido(destino=destino, ruta=ruta, secuencia=1)

        with patch.object(manual, 'build_distance_time_matrices',
                          MatrizFalsa(fuente="haversine_sin_respuesta")):
            _n, fuente, _fuera = recalcular_etas_desde_salida(
                ruta, CEDIS, salida_dt=a_las(9))

        self.assertEqual(fuente, "haversine_sin_respuesta")
