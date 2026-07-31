"""
Las ventanas de recibo del cliente.

Es la parte del optimizador donde más fácil se cuela un error que no se ve: un
horario mal interpretado no truena, simplemente hace que un pedido no entre en
ninguna ruta, o que se le prometa a un cliente una hora en la que está cerrado.
Los cuatro casos de aquí son los que ya mordieron alguna vez.
"""
from datetime import time

from django.test import TestCase

from delivery.api.comun import _rango_eta, _texto_ventana
from delivery.optimizer.reglas import (
    HORA_CERO,
    MINUTOS_TURNO_MAXIMO,
    _ventana_en_minutos,
    _ventana_recortada_a_turno,
)

from .factories import crear_destino


class VentanaEnMinutos(TestCase):
    def test_sin_ventana_usa_el_turno_completo(self):
        """Un destino sin horario en SAP no debe bloquear la ruta."""
        d = crear_destino()
        self.assertEqual(_ventana_en_minutos(d), (0, MINUTOS_TURNO_MAXIMO))

    def test_ventana_normal_se_mide_desde_la_hora_de_salida(self):
        """08:00-14:00 con salida a las 09:00 -> de -60 (acotado a 0) a 300."""
        d = crear_destino(ini1=time(8, 0), fin1=time(14, 0))
        self.assertEqual(_ventana_en_minutos(d), (0, 300))

    def test_medianoche_como_cierre_es_fin_del_dia_no_inicio(self):
        """
        "08:00-00:00" es un negocio que cierra a medianoche, no un dato corrupto.

        Si no se corrige antes de comparar, `fin <= ini` lo descarta como
        corrupto y el cliente pierde su ventana real, que además es amplísima.
        """
        d = crear_destino(ini1=time(8, 0), fin1=time(0, 0))
        ini, fin = _ventana_en_minutos(d)
        self.assertEqual(ini, 0)
        # Medianoche = minuto 1440 del día; menos las 9:00 de salida = 900.
        self.assertEqual(fin, 900)

    def test_horario_corrupto_de_sap_se_ignora_y_se_usa_el_turno(self):
        """
        LA PARMESANA tiene "08:00-06:00" en SAP: le falta el PM.

        Una ventana de duración negativa dejaría al cliente con cero minutos
        para recibir, o sea fuera de toda ruta, por un error de captura. Se
        prefiere tratarlo como "sin horario" — que es lo que de verdad se sabe.
        """
        d = crear_destino(ini1=time(8, 0), fin1=time(6, 0))
        self.assertEqual(_ventana_en_minutos(d), (0, MINUTOS_TURNO_MAXIMO))

    def test_ventana_de_cero_minutos_tambien_es_corrupta(self):
        """"10:00-10:00" no es una ventana, es un dato mal capturado."""
        d = crear_destino(ini1=time(10, 0), fin1=time(10, 0))
        self.assertEqual(_ventana_en_minutos(d), (0, MINUTOS_TURNO_MAXIMO))

    def test_segunda_ventana_extiende_el_cierre(self):
        """
        Cliente que cierra a mediodía y reabre en la tarde.

        OR-Tools solo admite UNA ventana continua por parada, así que se abarca
        de la apertura de la primera al cierre de la segunda. Sobrestima cuándo
        recibe, que es preferible a perder el turno de la tarde entero.
        """
        d = crear_destino(
            ini1=time(9, 0), fin1=time(12, 0),
            ini2=time(16, 0), fin2=time(20, 0),
        )
        ini, fin = _ventana_en_minutos(d)
        self.assertEqual(ini, 0)      # 09:00 = la hora de salida
        self.assertEqual(fin, 660)    # 20:00 - 09:00 = 11 h

    def test_segunda_ventana_corrupta_no_tumba_la_primera(self):
        d = crear_destino(
            ini1=time(9, 0), fin1=time(12, 0),
            ini2=time(20, 0), fin2=time(16, 0),   # invertida
        )
        self.assertEqual(_ventana_en_minutos(d), (0, 180))


class VentanaRecortadaAlTurno(TestCase):
    def test_cliente_que_abre_despues_del_turno_queda_inalcanzable_sin_reventar(self):
        """
        Mangioz recibe de 15:00 a 22:00; con salida 09:00 y turno de 6 h, el
        turno se acaba a las 15:00.

        OR-Tools EXIGE ini <= fin: una ventana invertida no lanza una excepción
        clara, corrompe el modelo. Se recorta a un instante al final del turno,
        que en la práctica lo deja fuera de la ruta — que es la verdad — en vez
        de romper la corrida entera.
        """
        ini, fin = _ventana_recortada_a_turno(360, 780, MINUTOS_TURNO_MAXIMO)
        self.assertLessEqual(ini, fin)
        self.assertEqual((ini, fin), (360, 360))

    def test_nunca_devuelve_una_ventana_invertida(self):
        for ini, fin in [(0, 0), (500, 100), (100, 500), (1000, 2000)]:
            with self.subTest(ini=ini, fin=fin):
                a, b = _ventana_recortada_a_turno(ini, fin, MINUTOS_TURNO_MAXIMO)
                self.assertLessEqual(a, b)
                self.assertLessEqual(b, MINUTOS_TURNO_MAXIMO)


class TextoDeLaVentana(TestCase):
    """Lo que se muestra en pantalla, que es otra decisión distinta."""

    def test_horario_corrupto_se_dice_como_lo_que_es(self):
        """
        Un rango imposible en pantalla parece un error del sistema. Decir
        "mal capturado en SAP" es la verdad Y dice dónde hay que arreglarlo.
        """
        d = crear_destino(ini1=time(8, 0), fin1=time(6, 0))
        self.assertEqual(_texto_ventana(d), "Horario mal capturado en SAP")

    def test_sin_horario_no_inventa_texto(self):
        self.assertIsNone(_texto_ventana(crear_destino()))
        self.assertIsNone(_texto_ventana(None))

    def test_dos_ventanas_se_muestran_juntas(self):
        d = crear_destino(
            ini1=time(9, 0), fin1=time(12, 0),
            ini2=time(16, 0), fin2=time(20, 0),
        )
        self.assertEqual(_texto_ventana(d), "09:00 - 12:00 y 16:00 - 20:00")


class RangoDeLaEta(TestCase):
    def test_el_rango_va_a_los_dos_lados(self):
        """
        El camión llega antes o después, nunca a la mera hora. Un rango de un
        solo lado se lee como "no llega antes de las 09:00", que es una promesa
        que el sistema no puede sostener.
        """
        self.assertEqual(_rango_eta("09:00"), ("08:45", "09:15"))

    def test_sin_eta_no_inventa_horas(self):
        self.assertEqual(_rango_eta(None), (None, None))
        self.assertEqual(_rango_eta(""), (None, None))

    def test_etas_viejas_en_12_horas_se_siguen_entendiendo(self):
        """Quedaron guardadas así antes del cambio a 24 h."""
        self.assertEqual(_rango_eta("01:00 PM"), ("12:45", "13:15"))

    def test_texto_que_no_es_hora_no_truena(self):
        """El campo llegó a traer la palabra 'Pendiente'."""
        self.assertEqual(_rango_eta("Pendiente"), (None, None))
