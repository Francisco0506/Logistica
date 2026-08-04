"""
El calendario de la operación, probado SIN cliente HTTP y SIN base de datos.

Antes esto solo se podía probar con `self.client.get("/api/dispatcher/jornada")`,
o sea pagando el precio de una prueba de integración para verificar aritmética
de calendario. Y esa es exactamente la razón por la que el bug del domingo se
escapó: la prueba que existía solo comprobaba que el endpoint contestara 200.

Ahora `jornada_de` recibe el reloj y la forma de contar entregas, así que cada
caso se fija con un día y una hora exactos.
"""
from datetime import date, datetime

from django.test import SimpleTestCase

from delivery.calendario import (
    DIAS, HORA_CORTE_JORNADA, fecha_carga_de, fecha_reparto_de, jornada_de,
    nombre_dia,
)

# Semana de referencia de 2026, para no tener que contar con los dedos:
#   viernes 31-jul · sábado 1-ago · DOMINGO 2-ago · lunes 3-ago · martes 4-ago
VIERNES = date(2026, 7, 31)
SABADO = date(2026, 8, 1)
DOMINGO = date(2026, 8, 2)
LUNES = date(2026, 8, 3)

SIN_ENTREGAS = lambda _f: 0        # noqa: E731
CON_ENTREGAS = lambda _f: 12       # noqa: E731


def a_las(dia, hora):
    return datetime(dia.year, dia.month, dia.day, hora, 0)


class TraduccionEntreLosDosCalendarios(SimpleTestCase):
    """Lo capturado un día sale al siguiente, salvo que el siguiente sea domingo."""

    def test_lo_del_viernes_sale_el_sabado(self):
        self.assertEqual(fecha_reparto_de(VIERNES), SABADO)

    def test_lo_del_sabado_sale_el_LUNES(self):
        """El domingo no se reparte. Es el caso que se olvida siempre."""
        self.assertEqual(fecha_reparto_de(SABADO), LUNES)

    def test_el_lunes_se_surte_con_el_SABADO(self):
        self.assertEqual(fecha_carga_de(LUNES), SABADO)

    def test_ida_y_vuelta_son_consistentes(self):
        # Si las dos funciones se desfasaran, el panel abriría en un día y el
        # selector mostraría otro.
        for dia in (VIERNES, SABADO, LUNES):
            self.assertEqual(fecha_carga_de(fecha_reparto_de(dia)), dia)

    def test_los_dias_tienen_nombre_en_espanol(self):
        self.assertEqual(nombre_dia(DOMINGO), 'domingo')
        self.assertEqual(len(DIAS), 7)


class ElPanelNuncaPrometeUnRepartoEnDomingo(SimpleTestCase):
    """
    EL BUG QUE ESTAS PRUEBAS EXISTEN PARA CAZAR.

    Se vio en vivo: un sábado por la tarde el panel decía "Preparando MAÑANA
    02-Aug" — y el 2 de agosto era domingo, el único día en que no sale ningún
    camión. La causa fue sumar un día a mano en vez de usar `fecha_reparto_de`,
    o sea tener dos calendarios.
    """

    def test_el_sabado_por_la_tarde_prepara_el_LUNES(self):
        datos = jornada_de(a_las(SABADO, 15), CON_ENTREGAS)
        self.assertEqual(datos['fecha_carga'], '2026-08-01')
        self.assertEqual(datos['fecha_reparto'], '2026-08-03')   # lunes
        # No es "mañana": es pasado. El frontend usa esta etiqueta para redactar.
        self.assertEqual(datos['para'], 'otro')

    def test_el_viernes_por_la_tarde_SI_prepara_manana(self):
        """El salto es SOLO por el domingo; el resto de la semana es mañana."""
        datos = jornada_de(a_las(VIERNES, 15), CON_ENTREGAS)
        self.assertEqual(datos['fecha_reparto'], '2026-08-01')
        self.assertEqual(datos['para'], 'mañana')

    def test_en_domingo_por_la_manana_tampoco(self):
        datos = jornada_de(a_las(DOMINGO, 8), CON_ENTREGAS)
        self.assertEqual(datos['fecha_reparto'], '2026-08-03')   # lunes
        self.assertNotEqual(datos['para'], 'hoy')

    def test_el_domingo_por_la_TARDE_carga_lo_del_sabado(self):
        """
        El otro lado del mismo hueco: la prueba de arriba cubre el domingo por
        la MAÑANA, y pasada la hora de corte se entraba por otra rama.

        Ahí el panel daba por hecho que "la carga es hoy" y abría diciendo
        "Preparando 03-ago: son las entregas que se están capturando hoy" con el
        contador en 0 — en domingo no se captura nada. El despachador se
        encontraba un lunes vacío sin manera de saber que sus pedidos sí
        existen, nada más que guardados bajo la fecha del sábado.
        """
        datos = jornada_de(a_las(DOMINGO, 15), CON_ENTREGAS)
        self.assertEqual(datos['fecha_reparto'], '2026-08-03')   # lunes
        self.assertEqual(datos['fecha_carga'], '2026-08-01')     # sábado, no el domingo
        self.assertNotIn('capturando hoy', datos['explicacion'])

    def test_ningun_dia_ni_hora_produce_un_reparto_en_domingo(self):
        """El barrido completo: 14 días × las 24 horas."""
        for dias in range(14):
            dia = date(2026, 7, 27) + (date(2026, 7, 28) - date(2026, 7, 27)) * dias
            for hora in range(24):
                salida = jornada_de(a_las(dia, hora), CON_ENTREGAS)['fecha_reparto']
                self.assertNotEqual(
                    date.fromisoformat(salida).weekday(), 6,
                    f"el {dia} a las {hora}:00 prometió reparto en domingo",
                )


class LaHoraDeCorte(SimpleTestCase):
    def test_antes_de_la_hora_se_planea_el_reparto_de_HOY(self):
        datos = jornada_de(a_las(LUNES, HORA_CORTE_JORNADA - 1), CON_ENTREGAS)
        self.assertEqual(datos['fecha_reparto'], '2026-08-03')   # el mismo lunes
        self.assertEqual(datos['para'], 'hoy')

    def test_despues_de_la_hora_se_prepara_el_SIGUIENTE(self):
        # Pasada esa hora el plan de hoy ya está en la calle: los camiones salen
        # entre 7:03 y 10:35 (medido con GPS).
        datos = jornada_de(a_las(LUNES, HORA_CORTE_JORNADA), CON_ENTREGAS)
        self.assertEqual(datos['fecha_reparto'], '2026-08-04')   # martes
        self.assertEqual(datos['fecha_carga'], '2026-08-03')


class NoSeRellenaConDatosDeOtroDia(SimpleTestCase):
    def test_un_reparto_sin_captura_devuelve_CERO_y_lo_dice(self):
        # Antes buscaba hacia atrás el último día con entregas y lo presentaba
        # como si fuera del día pedido: datos viejos disfrazados de actuales,
        # que es peor que no mostrar nada.
        datos = jornada_de(a_las(LUNES, 9), SIN_ENTREGAS, reparto=date(2026, 8, 5))
        self.assertEqual(datos['entregas'], 0)
        self.assertIn('Todavía no hay entregas', datos['explicacion'])
        self.assertEqual(datos['fecha_carga'], '2026-08-04')     # el día anterior, sin buscar

    def test_con_entregas_lo_dice_de_otra_forma(self):
        datos = jornada_de(a_las(LUNES, 9), CON_ENTREGAS, reparto=LUNES)
        self.assertEqual(datos['entregas'], 12)
        self.assertIn('son las entregas capturadas', datos['explicacion'])

    def test_sin_nada_en_7_dias_pide_sincronizar_en_vez_de_mentir(self):
        datos = jornada_de(a_las(LUNES, 9), SIN_ENTREGAS)
        self.assertEqual(datos['entregas'], 0)
        self.assertIn('Sincroniza', datos['explicacion'])


class LaExplicacionNuncaSaleVacia(SimpleTestCase):
    def test_siempre_trae_los_cinco_campos(self):
        casos = [
            jornada_de(a_las(SABADO, 15), CON_ENTREGAS),
            jornada_de(a_las(LUNES, 9), SIN_ENTREGAS),
            jornada_de(a_las(LUNES, 9), CON_ENTREGAS, reparto=LUNES),
        ]
        for datos in casos:
            for campo in ('fecha_carga', 'fecha_reparto', 'entregas', 'para', 'explicacion'):
                self.assertIn(campo, datos)
            self.assertTrue(datos['explicacion'].strip())
            self.assertIn(datos['para'], ('hoy', 'mañana', 'otro'))
