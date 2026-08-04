"""
El optimizador: lo que NUNCA debe pasar al generar un plan.

Cada prueba de aquí corresponde a algo que ya salió mal o que, de salir mal,
nadie se daría cuenta hasta que un camión se fuera con la carga equivocada.
"""
from datetime import time
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import TestCase

from delivery import fleet
from delivery.models import Remision, Ruta
from delivery.optimizer import solve_vrp
from delivery.optimizer.modelo import build_data_model
from delivery.optimizer.reglas import PESO_ESTIMADO_KG, TIEMPO_DESCARGA_MINUTOS

from .factories import (
    CEDIS, CENTRO, ESCOBEDO, FECHA, GUADALUPE, SAN_PEDRO,
    MatrizFalsa, crear_destino, crear_pedido, crear_ruta,
)

# El corredor de Saltillo, a ~85 km del CEDIS por carretera. Van aquí y no en
# factories.py porque solo las pruebas de la zona los usan.
SALTILLO = (25.4232, -101.0053)
RAMOS_ARIZPE = (25.5417, -100.9481)
ARTEAGA = (25.4447, -100.8478)

# Todo el módulo corre contra la matriz falsa: las pruebas no salen a la red.
PARCHES = [
    "delivery.optimizer.modelo.build_distance_time_matrices",
    "delivery.optimizer.manual.build_distance_time_matrices",
]


class BaseOptimizador(TestCase):
    def setUp(self):
        self._parches = [patch(p, new=MatrizFalsa()) for p in PARCHES]
        for p in self._parches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self._parches])


class ModeloDelDia(BaseOptimizador):
    def test_dos_clientes_en_el_mismo_domicilio_son_UNA_parada(self):
        """
        PROVEO PARQUE MARTEL son cuatro razones sociales en la misma puerta. El
        camión se estaciona UNA vez.

        Contarlas como cuatro paradas metía 36 min de descarga que en la calle
        no existen. Medido con los pedidos del 25-jul: 120 documentos contra
        105 paradas reales.
        """
        d1 = crear_destino(CENTRO)
        d2 = crear_destino(CENTRO)          # misma coordenada, otro Ship-To
        crear_pedido(d1)
        crear_pedido(d2)

        data = build_data_model(FECHA, 1, [6000], CEDIS)

        # 1 nodo de CEDIS + 1 parada (no 2).
        self.assertEqual(len(data['remisiones_validas']), 1)
        self.assertEqual(len(data['remisiones_validas'][0]), 2)

    def test_dos_clientes_lejos_son_dos_paradas(self):
        crear_pedido(crear_destino(CENTRO))
        crear_pedido(crear_destino(ESCOBEDO))
        data = build_data_model(FECHA, 1, [6000], CEDIS)
        self.assertEqual(len(data['remisiones_validas']), 2)

    def test_el_peso_de_una_parada_es_la_suma_de_sus_pedidos(self):
        d = crear_destino(CENTRO)
        crear_pedido(d, peso_kg=300)
        crear_pedido(d, peso_kg=200)
        data = build_data_model(FECHA, 1, [6000], CEDIS)
        self.assertEqual(data['demands'][1], 500)

    def test_pedido_sin_peso_usa_el_estimado_no_un_cero(self):
        """
        Un pedido sin peso pesando 0 haría creer al solver que cabe gratis.
        Se usa el estimado, que es conservador y está marcado como tal.
        """
        crear_pedido(crear_destino(CENTRO), peso_kg=None)
        data = build_data_model(FECHA, 1, [6000], CEDIS)
        self.assertEqual(data['demands'][1], PESO_ESTIMADO_KG)

    def test_pedidos_sin_coordenada_se_reportan_nunca_se_asignan_a_ciegas(self):
        crear_pedido(crear_destino(CENTRO))
        sin_geo = crear_pedido(crear_destino(coords=None))
        data = build_data_model(FECHA, 1, [6000], CEDIS)
        self.assertEqual([r.id for r in data['remisiones_sin_geo']], [sin_geo.id])
        self.assertEqual(len(data['remisiones_validas']), 1)

    def test_si_ninguno_tiene_coordenada_se_dice_en_vez_de_planear_vacio(self):
        crear_pedido(crear_destino(coords=None))
        data = build_data_model(FECHA, 1, [6000], CEDIS)
        self.assertTrue(data['sin_solucion'])

    def test_la_descarga_se_suma_al_llegar_pero_no_al_regresar_al_cedis(self):
        """El camión no descarga cuando vuelve a la bodega."""
        crear_pedido(crear_destino(CENTRO))
        data = build_data_model(FECHA, 1, [6000], CEDIS)
        # Columna 0 = regreso al CEDIS: sin descarga.
        self.assertLess(data['time_matrix'][1][0], data['time_matrix'][0][1])
        self.assertEqual(
            data['time_matrix'][0][1] - data['time_matrix'][1][0],
            TIEMPO_DESCARGA_MINUTOS,
        )


class RutasYaDespachadas(BaseOptimizador):
    """
    Lo más importante de todo el archivo: un camión que ya salió no se toca.

    Reasignar un pedido que ya va arriba de un camión significa que el chofer
    trae mercancía que el sistema cree en otro lado.
    """

    def test_una_ruta_en_la_calle_jamas_se_destruye_al_reoptimizar(self):
        despachada = crear_ruta("PP4873A", estado='En_Ruta')
        pedido_en_calle = crear_pedido(
            crear_destino(SAN_PEDRO), estado='En_Camino',
            ruta=despachada, secuencia=1,
        )
        crear_pedido(crear_destino(GUADALUPE))   # uno nuevo por planear

        solve_vrp(FECHA, ["RA7475A"], CEDIS, segundos_solver=2)

        despachada.refresh_from_db()
        pedido_en_calle.refresh_from_db()
        self.assertEqual(despachada.estado, 'En_Ruta')
        self.assertEqual(pedido_en_calle.ruta_id, despachada.id)
        self.assertEqual(pedido_en_calle.estado, 'En_Camino')

    def test_las_rutas_en_borrador_si_se_reemplazan(self):
        borrador = crear_ruta("RA7475A", estado='Borrador')
        crear_pedido(crear_destino(CENTRO), estado='Asignado', ruta=borrador, secuencia=1)

        solve_vrp(FECHA, ["RA7475A"], CEDIS, segundos_solver=2)

        self.assertFalse(Ruta.objects.filter(id=borrador.id).exists())

    def test_un_camion_ya_despachado_no_se_usa_para_una_ruta_nueva(self):
        crear_ruta("RA7475A", estado='Cargando')
        crear_pedido(crear_destino(CENTRO))

        res = solve_vrp(FECHA, ["RA7475A"], CEDIS, segundos_solver=2)

        self.assertEqual(res["status"], "error")
        self.assertIn("ya están despachados", res["message"])


class DosRutasDelMismoCamionElMismoDia(BaseOptimizador):
    """
    Lo que pasó el 4-ago-2026 y por qué existe la revalidación dentro de la
    transacción.

    La corrida lee qué camiones están despachados ANTES de irse 20 s a OSRM y al
    solver. En esos 20 s el almacén sigue trabajando: si alguien pone un camión
    en 'Cargando' a media corrida, ese camión entró al plan como disponible (se
    le crea ruta nueva) y su ruta vieja ya no es 'Borrador' (el delete no se la
    lleva). Dos rutas del mismo camión el mismo día, y los pedidos que ya se
    estaban subiendo repartidos a otro camión.
    """

    def _despachar_a_media_corrida(self, camion):
        """Devuelve un build_data_model que, después de armar el modelo —o sea
        con la lista de camiones libres ya leída y congelada—, mete la ruta que
        el almacén acaba de despachar. Es el instante exacto de la carrera."""
        from delivery.optimizer import solver as solver_mod

        real = solver_mod.build_data_model

        def build_y_despachar(*args, **kwargs):
            data = real(*args, **kwargs)
            crear_ruta(camion, estado='Cargando')
            return data

        return build_y_despachar

    def test_un_camion_despachado_a_media_corrida_aborta_el_plan(self):
        crear_pedido(crear_destino(CENTRO))
        crear_pedido(crear_destino(GUADALUPE))

        with patch("delivery.optimizer.solver.build_data_model",
                   side_effect=self._despachar_a_media_corrida("RA7475A")):
            res = solve_vrp(FECHA, ["RA7475A"], CEDIS, segundos_solver=2)

        self.assertEqual(res["status"], "error")
        self.assertIn("RA7475A", res["message"])
        self.assertEqual(
            Ruta.objects.filter(fecha=FECHA, camion="RA7475A").count(), 1,
            "se le creó una segunda ruta al camión que el almacén ya está cargando",
        )
        self.assertEqual(Ruta.objects.get(fecha=FECHA, camion="RA7475A").estado, 'Cargando')

    def test_al_abortar_no_se_borran_las_rutas_borrador_que_ya_habia(self):
        """
        Abortar tiene que dejar el plan que el despachador está viendo EXACTAMENTE
        como estaba: el borrado de rutas 'Borrador' va después de la revalidación,
        no antes. Si se abortara a medias, el despachador se quedaría sin el plan
        viejo y sin el nuevo.
        """
        borrador = crear_ruta("PR6889B", estado='Borrador')
        pedido = crear_pedido(crear_destino(CENTRO), estado='Asignado',
                              ruta=borrador, secuencia=1, eta="10:30")

        with patch("delivery.optimizer.solver.build_data_model",
                   side_effect=self._despachar_a_media_corrida("RA7475A")):
            res = solve_vrp(FECHA, ["RA7475A", "PR6889B"], CEDIS, segundos_solver=2)

        self.assertEqual(res["status"], "error")
        self.assertTrue(Ruta.objects.filter(id=borrador.id).exists())
        pedido.refresh_from_db()
        self.assertEqual(pedido.ruta_id, borrador.id)
        self.assertEqual(pedido.eta, "10:30")

    def test_los_camiones_que_no_cambiaron_no_estorban(self):
        """Que OTRO camión se despache a media corrida no debe abortar nada:
        solo importa que se despache uno de los que están en este plan."""
        crear_pedido(crear_destino(CENTRO))

        with patch("delivery.optimizer.solver.build_data_model",
                   side_effect=self._despachar_a_media_corrida("RJ97892")):
            res = solve_vrp(FECHA, ["RA7475A"], CEDIS, segundos_solver=2)

        self.assertEqual(res["status"], "success")

    def test_la_base_de_datos_tampoco_deja_meter_la_segunda_ruta(self):
        """
        El candado de la aplicación cubre al optimizador. Este cubre TODO lo
        demás: una asignación manual, un script, dos peticiones al mismo tiempo.
        """
        crear_ruta("RA7475A", estado='Borrador')
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                crear_ruta("RA7475A", estado='Cargando')

    def test_el_mismo_camion_si_puede_tener_ruta_otro_dia(self):
        """La restricción es por (fecha, camión), no por camión."""
        from datetime import timedelta
        crear_ruta("RA7475A", fecha=FECHA)
        crear_ruta("RA7475A", fecha=FECHA + timedelta(days=1))
        self.assertEqual(Ruta.objects.filter(camion="RA7475A").count(), 2)


class ZonaSaltillo(BaseOptimizador):
    """
    Saltillo + Ramos Arizpe + Arteaga están a ~85 km del CEDIS, lejos de todo lo
    demás. Cada camión de más que sale para allá es un viaje de ~3 h de ida y
    vuelta que no hacía falta, y el solver los mandaba nomás por ahorrarse unos
    minutos en la ruta de cada uno.

    Todo este bloque salió a producción sin una sola prueba.
    """

    def _pedidos_de_la_zona(self, peso_kg=100.0, **ventana):
        return [
            crear_pedido(crear_destino(coords, city=ciudad, **ventana), peso_kg=peso_kg)
            for coords, ciudad in (
                (SALTILLO, "SALTILLO"),
                (RAMOS_ARIZPE, "RAMOS ARIZPE"),
                (ARTEAGA, "ARTEAGA"),
            )
        ]

    def _ruta_de(self, pedido):
        pedido.refresh_from_db()
        return pedido.ruta_id

    def test_si_caben_todas_las_paradas_de_la_zona_van_en_UN_camion(self):
        zona = self._pedidos_de_la_zona()
        crear_pedido(crear_destino(CENTRO))      # y lo de Monterrey aparte
        crear_pedido(crear_destino(GUADALUPE))

        res = solve_vrp(FECHA, ["RA7475A", "PR6889B"], CEDIS, segundos_solver=3)

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["pedidos_no_asignados"], [])
        rutas = {self._ruta_de(p) for p in zona}
        self.assertNotIn(None, rutas, "un pedido de la zona se quedó sin camión")
        self.assertEqual(len(rutas), 1,
                         "la zona cabía en un camión y se repartió entre varios")
        self.assertNotIn("Zona Saltillo", res["message"],
                         "avisó de un reparto que no ocurrió")

    def test_si_no_caben_en_uno_se_reparten_pero_no_se_pierde_ningun_pedido(self):
        """
        Las tres paradas cierran a las 11:00 y el recorrido completo no cabe en
        esa ventana con un solo camión. Vale más mandar dos camiones que dejar un
        cliente sin su pedido: por eso, cuando el candado de "todo en uno" cuesta
        entregas, la corrida se repite sin él.
        """
        zona = self._pedidos_de_la_zona(ini1=time(9, 0), fin1=time(11, 0))

        res = solve_vrp(FECHA, ["RA7475A", "PR6889B"], CEDIS, segundos_solver=5)

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["pedidos_no_asignados"], [],
                         "se perdió un pedido de la zona por insistir en un solo camión")
        rutas = {self._ruta_de(p) for p in zona}
        self.assertNotIn(None, rutas)
        self.assertEqual(len(rutas), 2)
        self.assertIn("no cupieron en un solo camión", res["message"])
        self.assertIn("turno", res["message"],
                      "hay que decirle al despachador qué palanca mover")

    def test_sin_camion_lo_bastante_grande_el_mensaje_dice_ESA_causa(self):
        """
        Aquí el problema NO es el turno: es que los camiones prendidos no
        aguantan el peso de la zona. Antes las dos causas salían con el mismo
        texto ("no caben en un solo camión"), que manda al despachador a ampliar
        el turno cuando lo que tiene que hacer es prender otro camión.
        """
        zona = self._pedidos_de_la_zona(peso_kg=900)   # 2,700 kg en total

        # 1,500 kg y 2,000 kg: ninguno se lleva la zona completa, entre los dos sí.
        res = solve_vrp(FECHA, ["RJ37663", "RJ97892"], CEDIS, segundos_solver=5)

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["pedidos_no_asignados"], [])
        self.assertEqual(len({self._ruta_de(p) for p in zona}), 2)
        self.assertIn("ningún camión activo aguanta", res["message"])
        self.assertNotIn("no cupieron en un solo camión", res["message"])

    def test_con_un_solo_camion_no_se_inventa_un_reparto_entre_varios(self):
        """
        El aviso se armaba con la INTENCIÓN (si se pudo forzar o no), no con el
        resultado. Con un solo camión activo, el plan decía que la zona "se
        repartió entre varios" — varios camiones que ese día ni existían.
        """
        self._pedidos_de_la_zona(peso_kg=4000)   # 12,000 kg: no caben ni de broma

        res = solve_vrp(FECHA, ["RA7475A"], CEDIS, segundos_solver=3)

        self.assertEqual(res["status"], "success")
        self.assertEqual(len(Ruta.objects.filter(fecha=FECHA)), 1)
        self.assertNotIn("Zona Saltillo", res["message"],
                         "avisó de un reparto entre camiones que no existen")
        # Lo que sí tiene que decir es qué pedidos se quedaron fuera.
        self.assertTrue(res["pedidos_no_asignados"])


class PedidosQueNoCupieron(BaseOptimizador):
    def test_regresan_a_pendiente_sin_ruta_sin_secuencia_y_sin_eta(self):
        """
        Si se quedan en 'Asignado' apuntando a una ruta que esta corrida borró,
        quedan huérfanos: no salen en ningún camión y tampoco en Alertas (que
        solo muestra 'Pendiente'). Invisibles, aunque sigan en la base.

        La ETA también se limpia: si no, ventas le sigue prometiendo al cliente
        una hora de llegada de un pedido que no va en ningún camión.
        """
        # Un solo camión de 1 paradas de tope contra tres destinos lejanos.
        with patch.dict(fleet.POR_PLACA, {
            "RJ37663": {**fleet.POR_PLACA["RJ37663"], "max_paradas": 1},
        }):
            for coords in (SAN_PEDRO, GUADALUPE, ESCOBEDO):
                crear_pedido(crear_destino(coords), estado='Asignado',
                             eta="13:20", secuencia=5)

            res = solve_vrp(FECHA, ["RJ37663"], CEDIS, segundos_solver=2)

        self.assertEqual(res["status"], "success")
        self.assertTrue(res["pedidos_no_asignados"])

        for r in Remision.objects.filter(doc_num__in=res["pedidos_no_asignados"]):
            self.assertEqual(r.estado, 'Pendiente')
            self.assertIsNone(r.ruta_id)
            self.assertIsNone(r.secuencia_ruta)
            self.assertIsNone(r.eta, "la ETA vieja seguiría prometiendo una hora")


class CapacidadPorPlaca(BaseOptimizador):
    def test_la_capacidad_sigue_a_la_placa_no_a_la_posicion(self):
        """
        Antes se mandaba CUÁNTOS camiones había y el backend tomaba los
        primeros N de una lista fija: apagar uno y prender otro planeaba con la
        capacidad del que se apagó, sin avisar.
        """
        self.assertEqual(fleet.capacidad_kg("RJ37663"), 1500)
        self.assertEqual(fleet.capacidad_kg("RA7475A"), 6000)

    def test_un_camion_desconocido_usa_valores_conservadores(self):
        """Subestimar lo que aguanta, nunca inflarlo: un camión sobrecargado
        es un problema de seguridad, no de planeación."""
        self.assertEqual(fleet.capacidad_kg("XYZ0000"), fleet.CAPACIDAD_KG_DESCONOCIDO)
        self.assertLess(fleet.CAPACIDAD_KG_DESCONOCIDO, 6000)

    def test_la_ruta_se_guarda_con_la_placa_real(self):
        crear_pedido(crear_destino(CENTRO))
        solve_vrp(FECHA, ["PR6889B"], CEDIS, segundos_solver=2)
        self.assertEqual(Ruta.objects.get(fecha=FECHA).camion, "PR6889B")

    def test_el_chofer_se_deja_vacio_en_vez_de_inventar_uno(self):
        """Antes se guardaba "Chofer 1", que parecía un dato real."""
        crear_pedido(crear_destino(CENTRO))
        solve_vrp(FECHA, ["PR6889B"], CEDIS, segundos_solver=2)
        self.assertEqual(Ruta.objects.get(fecha=FECHA).chofer, "")


class Simulacion(BaseOptimizador):
    def test_simular_no_deja_rastro_en_la_base(self):
        """
        Los escenarios ("¿y si le doy una hora más?") corren el optimizador de
        verdad y luego lo deshacen. Si dejaran rastro, contestar una pregunta
        cambiaría el plan que el despachador está viendo.
        """
        pedido = crear_pedido(crear_destino(CENTRO))

        res = solve_vrp(FECHA, ["RA7475A"], CEDIS, simular=True, segundos_solver=2)

        self.assertEqual(res["status"], "success")
        self.assertFalse(Ruta.objects.filter(fecha=FECHA).exists())
        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, 'Pendiente')
        self.assertIsNone(pedido.ruta_id)


class VentanasEnElPlan(BaseOptimizador):
    """
    La ventana del cliente se mide contra la hora en que el camión LLEGA.

    El acumulado de la dimensión Time del solver trae ya sumada la descarga de
    la propia parada, o sea que es la hora de SALIDA. Aplicar la ventana sobre
    ese acumulado sin corregir la corre 12 minutos: se rechazan pedidos que sí
    llegaban a tiempo, y se aceptan otros a los que el camión llega antes de que
    el cliente abra.

    Los números de estas dos pruebas están escogidos para que el resultado
    cambie según se corrija o no — si algún día alguien quita el ajuste, aquí
    truena.
    """

    # CEDIS -> SAN_PEDRO son 8.9 km = 13 min de manejo con la matriz de prueba.
    MINUTOS_DE_MANEJO = 13

    def test_se_acepta_un_pedido_que_llega_justo_antes_de_que_cierren(self):
        """
        Cliente abierto de 09:00 a 09:20; el camión llega 09:13, dentro.

        Sin corregir, el solver compara la SALIDA (09:25) contra el cierre de
        las 09:20 y tira el pedido, aunque el camión llegó siete minutos antes
        de que cerraran.
        """
        pedido = crear_pedido(crear_destino(SAN_PEDRO, ini1=time(9, 0), fin1=time(9, 20)))

        res = solve_vrp(FECHA, ["RA7475A"], CEDIS, segundos_solver=3)

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["pedidos_no_asignados"], [],
                         "el pedido llegaba dentro de la ventana y se descartó")
        pedido.refresh_from_db()
        self.assertEqual(pedido.eta, "09:13")

    def test_la_eta_guardada_es_la_llegada_no_la_salida_de_la_parada(self):
        """
        La hora que se le promete al cliente es a la que el camión toca su
        puerta, no a la que termina de descargar. Doce minutos de diferencia
        son los que hacen que la ETA del plan no cuadre con la que se recalcula
        al dar Salida.
        """
        pedido = crear_pedido(crear_destino(SAN_PEDRO))

        solve_vrp(FECHA, ["RA7475A"], CEDIS, segundos_solver=3)

        pedido.refresh_from_db()
        esperada = f"09:{self.MINUTOS_DE_MANEJO:02d}"
        self.assertEqual(pedido.eta, esperada)

    def test_un_cliente_que_abre_despues_del_turno_no_tumba_la_corrida(self):
        """
        Mangioz recibe de 15:00 a 22:00 y el turno se acaba a las 15:00. La
        ventana recortada queda invertida si nadie la acota, y OR-Tools no falla
        con un mensaje claro: corrompe el modelo.
        """
        crear_pedido(crear_destino(SAN_PEDRO, ini1=time(15, 0), fin1=time(22, 0)))
        crear_pedido(crear_destino(GUADALUPE))

        res = solve_vrp(FECHA, ["RA7475A"], CEDIS, segundos_solver=3)

        self.assertEqual(res["status"], "success")
