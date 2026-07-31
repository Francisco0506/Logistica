"""
Los días en que cada cliente recibe.

`Destino` guarda `ent_lun`…`ent_sab` desde el principio, SAP y el Excel los
llenaban, y el optimizador NUNCA los leía: 68 de 195 destinos tienen algún día
restringido —casi todos "no reciben sábado"— y el sistema les planeaba entregas
ese día igual. El camión llegaba a una puerta cerrada.

La parte que se equivoca fácil, y por eso hay tantas pruebas de fecha aquí: el
día que importa NO es el del documento, es el día en que el camión LLEGA. Lo
capturado un día sale al siguiente.
"""
from datetime import date, time
from unittest.mock import patch

from django.test import TestCase

from delivery.api.comun import fecha_reparto_de
from delivery.models import Remision
from delivery.optimizer import solve_vrp
from delivery.optimizer.modelo import build_data_model
from delivery.optimizer.reglas import recibe_ese_dia

from .factories import (
    CEDIS, CENTRO, ESCOBEDO, SAN_PEDRO, MatrizFalsa,
    crear_destino, crear_pedido,
)

# El calendario con el que se razona en todas estas pruebas:
#   viernes 24-jul-2026  ->  reparto sábado 25
#   sábado  25-jul-2026  ->  reparto LUNES 27 (el domingo no se reparte)
#   lunes   27-jul-2026  ->  reparto martes 28
VIERNES = date(2026, 7, 24)
SABADO = date(2026, 7, 25)
LUNES = date(2026, 7, 27)


class QueDiaLlegaElCamion(TestCase):
    def test_lo_capturado_hoy_sale_manana(self):
        self.assertEqual(fecha_reparto_de(LUNES), date(2026, 7, 28))

    def test_lo_capturado_el_sabado_sale_el_LUNES(self):
        """El domingo no se reparte. Es el caso que se olvida siempre."""
        self.assertEqual(fecha_reparto_de(SABADO), LUNES)

    def test_lo_capturado_el_viernes_sale_el_sabado(self):
        self.assertEqual(fecha_reparto_de(VIERNES), SABADO)


class RecibeEseDia(TestCase):
    def test_un_destino_sin_restricciones_recibe_cualquier_dia(self):
        d = crear_destino()
        for dia in (VIERNES, SABADO, LUNES):
            self.assertTrue(recibe_ese_dia(d, dia))

    def test_un_destino_que_no_recibe_sabado(self):
        """El caso más común: casi todas las restricciones reales son ésta."""
        d = crear_destino(ent_sab=False)
        self.assertFalse(recibe_ese_dia(d, SABADO))
        self.assertTrue(recibe_ese_dia(d, LUNES))

    def test_solo_martes_y_jueves(self):
        """
        Los 52 destinos de Pizza DePrizza en la práctica solo se surten martes
        y jueves. El dato todavía no está en SAP, pero el código ya lo respeta
        el día que se capture.
        """
        d = crear_destino(ent_lun=False, ent_mie=False, ent_vie=False, ent_sab=False)
        self.assertTrue(recibe_ese_dia(d, date(2026, 7, 28)))    # martes
        self.assertTrue(recibe_ese_dia(d, date(2026, 7, 30)))    # jueves
        self.assertFalse(recibe_ese_dia(d, date(2026, 7, 29)))   # miércoles

    def test_ante_la_duda_se_deja_pasar(self):
        """
        La base productiva NO tiene estos UDF, así que ahí todos los destinos
        caen en este caso. Es mejor mandar un camión de más que dejar a un
        cliente fuera del reparto por un campo que nadie llenó.
        """
        class SinLosCampos:
            pass
        self.assertTrue(recibe_ese_dia(SinLosCampos(), SABADO))


class ElOptimizadorLosRespeta(TestCase):
    def setUp(self):
        for p in ("delivery.optimizer.modelo.build_distance_time_matrices",
                  "delivery.optimizer.manual.build_distance_time_matrices"):
            parche = patch(p, new=MatrizFalsa())
            parche.start()
            self.addCleanup(parche.stop)

    def test_no_se_le_planea_a_quien_no_recibe_ese_dia(self):
        """
        Lo capturado el viernes sale el SÁBADO. Un cliente que no recibe sábado
        no debe entrar al plan de ese día.
        """
        recibe = crear_pedido(crear_destino(CENTRO), fecha=VIERNES)
        no_recibe = crear_pedido(crear_destino(SAN_PEDRO, ent_sab=False), fecha=VIERNES)

        data = build_data_model(VIERNES, 1, [6000], CEDIS)

        self.assertEqual(data['dia_reparto'], SABADO)
        self.assertEqual([r.id for r in data['remisiones_dia_cerrado']], [no_recibe.id])
        # El que sí recibe es la única parada del plan.
        self.assertEqual(len(data['remisiones_validas']), 1)
        self.assertEqual(data['remisiones_validas'][0][0].id, recibe.id)

    def test_el_dia_se_mide_contra_el_REPARTO_no_contra_el_documento(self):
        """
        La confusión que este código viene a evitar: un pedido capturado el
        viernes que sale el sábado se mide contra el SÁBADO.

        Si se midiera contra el día del documento, este cliente —que no recibe
        sábado pero sí viernes— pasaría el filtro y el camión llegaría a una
        puerta cerrada.
        """
        crear_pedido(crear_destino(CENTRO, ent_sab=False), fecha=VIERNES)
        data = build_data_model(VIERNES, 1, [6000], CEDIS)
        self.assertIsNone(data.get('remisiones_validas'))     # no quedó nada que rutear
        self.assertTrue(data['sin_solucion'])

    def test_lo_del_sabado_se_mide_contra_el_LUNES(self):
        """El domingo no se reparte: lo capturado el sábado llega el lunes."""
        sin_lunes = crear_pedido(crear_destino(CENTRO, ent_lun=False), fecha=SABADO)
        crear_pedido(crear_destino(SAN_PEDRO), fecha=SABADO)

        data = build_data_model(SABADO, 1, [6000], CEDIS)

        self.assertEqual(data['dia_reparto'], LUNES)
        self.assertEqual([r.id for r in data['remisiones_dia_cerrado']], [sin_lunes.id])

    def test_se_REPORTAN_nunca_desaparecen_en_silencio(self):
        """
        Un pedido que no se planeó y de cuya ausencia nadie se entera es peor
        que uno mal planeado: el despachador lo busca sin saber qué pasó.
        """
        crear_pedido(crear_destino(CENTRO), fecha=VIERNES)
        cerrado = crear_pedido(crear_destino(ESCOBEDO, ent_sab=False), fecha=VIERNES)

        res = solve_vrp(VIERNES, ["RA7475A"], CEDIS, segundos_solver=2)

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["pedidos_dia_cerrado"], [cerrado.doc_num])
        self.assertIn("no recibe en sábado", res["message"])

    def test_quedan_en_Pendiente_y_sin_ruta(self):
        """
        Si venían 'Asignado' de una corrida anterior contra una ruta que ésta
        acaba de borrar, sin limpiarlos quedan apuntando a la nada: ni en un
        camión, ni en las alertas.
        """
        crear_pedido(crear_destino(CENTRO), fecha=VIERNES)
        cerrado = crear_pedido(
            crear_destino(ESCOBEDO, ent_sab=False), fecha=VIERNES,
            estado='Asignado', eta="13:20", secuencia=3,
        )

        solve_vrp(VIERNES, ["RA7475A"], CEDIS, segundos_solver=2)

        cerrado.refresh_from_db()
        self.assertEqual(cerrado.estado, 'Pendiente')
        self.assertIsNone(cerrado.ruta_id)
        self.assertIsNone(cerrado.secuencia_ruta)
        self.assertIsNone(cerrado.eta)

    def test_si_NADIE_recibe_ese_dia_se_explica_por_que(self):
        """
        "No hay remisiones válidas" mandaría al despachador a buscar un problema
        de datos que no existe: el problema es el día.
        """
        crear_pedido(crear_destino(CENTRO, ent_sab=False), fecha=VIERNES)

        res = solve_vrp(VIERNES, ["RA7475A"], CEDIS, segundos_solver=2)

        self.assertEqual(res["status"], "error")
        self.assertIn("no reciben en sábado", res["message"])

    def test_sin_geo_y_dia_cerrado_se_distinguen(self):
        """Se arreglan de forma distinta, así que se dicen por separado."""
        crear_pedido(crear_destino(coords=None), fecha=VIERNES)
        crear_pedido(crear_destino(CENTRO, ent_sab=False), fecha=VIERNES)

        res = solve_vrp(VIERNES, ["RA7475A"], CEDIS, segundos_solver=2)

        self.assertIn("sin coordenadas", res["message"])
        self.assertIn("no reciben en sábado", res["message"])


class LasAlertasLoExplican(TestCase):
    """
    Un pedido descartado por el día aparecía como "pendiente de asignar", y el
    despachador lo intentaba meter a mano una y otra vez sin entender por qué
    el optimizador no lo tomaba.
    """

    def test_la_alerta_dice_que_el_cliente_no_recibe_ese_dia(self):
        crear_pedido(crear_destino(CENTRO, ent_sab=False), fecha=VIERNES)
        (alerta,) = self.client.get(f"/api/dispatcher/alertas?fecha={VIERNES}").json()
        self.assertEqual(alerta["motivo"], "El cliente no recibe en sábado")

    def test_los_tres_motivos_se_distinguen(self):
        crear_pedido(crear_destino(coords=None), fecha=VIERNES)
        crear_pedido(crear_destino(CENTRO, ent_sab=False), fecha=VIERNES)
        crear_pedido(crear_destino(SAN_PEDRO), fecha=VIERNES)

        motivos = {a["motivo"] for a in
                   self.client.get(f"/api/dispatcher/alertas?fecha={VIERNES}").json()}

        self.assertEqual(motivos, {
            "Sin georreferencia en SAP B1",
            "El cliente no recibe en sábado",
            "Pendiente de asignar a una ruta",
        })
