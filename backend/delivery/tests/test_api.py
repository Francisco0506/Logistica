"""
Que cada endpoint CONTESTE.

Suena a poco y es lo más rentable que tiene este archivo: el backend traía tres
NameError (`api` sin importar en chofer.py, `datetime`/`timezone` sin importar
en ventas.py, `_SoloSimulacion` sin importar en solver.py) que llevaban semanas
ahí. Ninguno es un error sutil de lógica: son módulos que nunca se ejecutaron
después de partir los archivos grandes. Cualquiera de estas pruebas los caza en
medio segundo.

Por eso aquí se llama a TODOS los endpoints, incluidos los caminos de error,
que es justo donde estaban escondidos.
"""
from datetime import time
from unittest.mock import patch

from django.test import TestCase

from delivery.models import Remision, Ruta

from .factories import (
    CENTRO, FECHA, SAN_PEDRO, MatrizFalsa,
    crear_destino, crear_linea, crear_pedido, crear_ruta,
)

PARCHES = [
    "delivery.optimizer.modelo.build_distance_time_matrices",
    "delivery.optimizer.manual.build_distance_time_matrices",
]


class BaseAPI(TestCase):
    def setUp(self):
        self._parches = [patch(p, new=MatrizFalsa()) for p in PARCHES]
        for p in self._parches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self._parches])


class PanelDelDespachador(BaseAPI):
    def test_remisiones(self):
        crear_pedido(crear_destino(CENTRO, ini1=time(9, 0), fin1=time(14, 0)))
        r = self.client.get(f"/api/dispatcher/remisiones?fecha={FECHA}")
        self.assertEqual(r.status_code, 200)
        (pedido,) = r.json()
        self.assertEqual(pedido["ventana"], "09:00 - 14:00")

    def test_la_eta_viaja_como_rango_y_nunca_como_la_palabra_pendiente(self):
        """
        El campo `eta` traía "Pendiente" por default, y esa palabra salía
        impresa en la guía del almacén y en el popup del mapa como si fuera una
        hora. Ahora es null, y el rango va en campos aparte.
        """
        crear_pedido(crear_destino(CENTRO))                    # sin ETA
        crear_pedido(crear_destino(SAN_PEDRO), eta="13:20")    # con ETA

        datos = self.client.get(f"/api/dispatcher/remisiones?fecha={FECHA}").json()
        sin_eta = next(p for p in datos if p["eta"] is None)
        con_eta = next(p for p in datos if p["eta"] == "13:20")

        self.assertIsNone(sin_eta["eta_desde"])
        self.assertEqual((con_eta["eta_desde"], con_eta["eta_hasta"]), ("13:05", "13:35"))

    def test_rutas(self):
        ruta = crear_ruta()
        crear_pedido(crear_destino(CENTRO), ruta=ruta, secuencia=1)
        r = self.client.get(f"/api/dispatcher/rutas?fecha={FECHA}")
        self.assertEqual(r.status_code, 200)
        (fila,) = r.json()
        self.assertEqual(fila["camion"], "RA7475A")
        self.assertEqual(fila["pedidos_count"], 1)

    def test_flota(self):
        r = self.client.get("/api/dispatcher/flota")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(any(c["placa"] == "RA7475A" for c in r.json()))

    def test_alertas_distingue_sin_geo_de_sin_asignar(self):
        crear_pedido(crear_destino(coords=None))
        crear_pedido(crear_destino(CENTRO))
        motivos = {a["motivo"] for a in
                   self.client.get(f"/api/dispatcher/alertas?fecha={FECHA}").json()}
        self.assertEqual(motivos, {
            "Sin georreferencia en SAP B1",
            "Pendiente de asignar a una ruta",
        })

    def test_jornada_por_defecto(self):
        r = self.client.get("/api/dispatcher/jornada")
        self.assertEqual(r.status_code, 200)
        self.assertIn(r.json()["para"], ("hoy", "mañana"))

    def test_jornada_de_un_reparto_toma_el_dia_habil_anterior(self):
        """
        El reparto del martes se surte con lo capturado el lunes. Antes esto
        buscaba hacia atrás "el último día con entregas" y al pedir un reparto
        futuro mostraba pedidos de días viejos como si fueran de ese día.
        """
        crear_pedido(crear_destino(CENTRO))     # capturado el 27 (lunes)
        r = self.client.get("/api/dispatcher/jornada?reparto=2026-07-28")
        datos = r.json()
        self.assertEqual(datos["fecha_carga"], "2026-07-27")
        self.assertEqual(datos["entregas"], 1)

    def test_jornada_no_rellena_con_otra_fecha_cuando_no_hay_nada(self):
        r = self.client.get("/api/dispatcher/jornada?reparto=2026-08-01")
        datos = r.json()
        self.assertEqual(datos["entregas"], 0)
        self.assertIn("Todavía no hay entregas", datos["explicacion"])

    def test_el_lunes_se_carga_con_el_sabado_no_con_el_domingo(self):
        r = self.client.get("/api/dispatcher/jornada?reparto=2026-08-03")  # lunes
        self.assertEqual(r.json()["fecha_carga"], "2026-08-01")            # sábado

    def test_generar_rutas_valida_la_hora_y_los_camiones(self):
        for payload, esperado in [
            ({"fecha": str(FECHA), "camiones": [], "hora_salida": "09:00"},
             "Activa al menos un camión"),
            ({"fecha": str(FECHA), "camiones": ["RA7475A"], "hora_salida": "9am"},
             "Hora de salida inválida"),
        ]:
            with self.subTest(payload=payload):
                r = self.client.post("/api/dispatcher/rutas/generar",
                                     data=payload, content_type="application/json")
                self.assertEqual(r.json()["status"], "error")
                self.assertIn(esperado, r.json()["message"])

    def test_generar_rutas_no_crea_dos_rutas_del_mismo_camion(self):
        """
        El panel puede mandar la misma placa dos veces (al agregar a mano una
        que ya estaba). Antes eso creaba DOS rutas del mismo camión el mismo
        día, y de ahí la app del chofer tronaba con MultipleObjectsReturned.
        """
        crear_pedido(crear_destino(CENTRO))
        self.client.post(
            "/api/dispatcher/rutas/generar",
            data={"fecha": str(FECHA), "camiones": ["RA7475A", "RA7475A"]},
            content_type="application/json",
        )
        self.assertEqual(Ruta.objects.filter(fecha=FECHA, camion="RA7475A").count(), 1)

    def test_transiciones_de_estado_no_se_pueden_saltar(self):
        ruta = crear_ruta(estado='Borrador')
        r = self.client.patch(f"/api/dispatcher/rutas/{ruta.id}/estado",
                              data={"estado": "En_Ruta"}, content_type="application/json")
        self.assertEqual(r.json()["status"], "error")
        self.assertIn("No se puede pasar", r.json()["message"])

    def test_dar_salida_marca_la_hora_y_pone_los_pedidos_en_camino(self):
        ruta = crear_ruta(estado='Listo')
        pedido = crear_pedido(crear_destino(CENTRO), ruta=ruta, secuencia=1, estado='Asignado')

        r = self.client.patch(f"/api/dispatcher/rutas/{ruta.id}/estado",
                              data={"estado": "En_Ruta"}, content_type="application/json")

        self.assertEqual(r.json()["status"], "success")
        ruta.refresh_from_db(); pedido.refresh_from_db()
        self.assertIsNotNone(ruta.hora_salida)
        self.assertEqual(pedido.estado, 'En_Camino')

    def test_cerrar_la_ruta_no_da_por_entregado_lo_que_nadie_confirmo(self):
        """
        Antes, "Finalizada" marcaba TODO como 'Entregado' de golpe: el dato
        pasaba a significar "alguien en la oficina cerró la ruta", que es
        justamente lo que la app del chofer viene a evitar.
        """
        ruta = crear_ruta(estado='En_Ruta')
        confirmado = crear_pedido(crear_destino(CENTRO), ruta=ruta, secuencia=1,
                                  estado='Entregado')
        sin_reportar = crear_pedido(crear_destino(SAN_PEDRO), ruta=ruta, secuencia=2,
                                    estado='En_Camino')

        self.client.patch(f"/api/dispatcher/rutas/{ruta.id}/estado",
                          data={"estado": "Finalizada"}, content_type="application/json")

        confirmado.refresh_from_db(); sin_reportar.refresh_from_db()
        self.assertEqual(confirmado.estado, 'Entregado')
        self.assertEqual(sin_reportar.estado, 'No_Entregado')
        self.assertIn("sin que el chofer reportara", sin_reportar.observaciones)

    def test_sugerencias_de_un_pedido_que_no_existe(self):
        self.assertIn("error", self.client.get(
            "/api/dispatcher/remisiones/999999/sugerencias").json())

    def test_sugerencias_sin_rutas_generadas_lo_dice(self):
        pedido = crear_pedido(crear_destino(CENTRO))
        datos = self.client.get(
            f"/api/dispatcher/remisiones/{pedido.id}/sugerencias").json()
        self.assertIn("No hay rutas generadas", datos["error"])

    def test_sugerencias_devuelve_opciones_con_su_eta_y_sus_motivos(self):
        ruta = crear_ruta()
        crear_pedido(crear_destino(SAN_PEDRO), ruta=ruta, secuencia=1, estado='Asignado')
        suelto = crear_pedido(crear_destino(CENTRO))

        datos = self.client.get(
            f"/api/dispatcher/remisiones/{suelto.id}/sugerencias").json()

        (opcion,) = datos["opciones"]
        self.assertEqual(opcion["camion"], "RA7475A")
        self.assertRegex(opcion["eta_estimada"], r"^\d{2}:\d{2}$")
        self.assertIsInstance(opcion["motivos_riesgo"], list)

    def test_escenarios_corre_sin_tocar_el_plan(self):
        """Este endpoint reventaba con NameError (_SoloSimulacion)."""
        crear_pedido(crear_destino(CENTRO))

        r = self.client.post("/api/dispatcher/rutas/escenarios",
                             data={"fecha": str(FECHA), "camiones": ["RA7475A"]},
                             content_type="application/json")

        self.assertEqual(r.json()["status"], "success")
        self.assertFalse(Ruta.objects.filter(fecha=FECHA).exists())

    def test_gps_no_tumba_el_panel_si_samsara_no_responde(self):
        with patch("delivery.api.dispatcher.get_ubicaciones_isuzu", return_value=[]):
            r = self.client.get("/api/dispatcher/camiones/gps")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), [])


class PanelDeVentas(BaseAPI):
    """Este panel devolvía 500 SIEMPRE por un import faltante."""

    def test_pedidos_de_una_vendedora(self):
        crear_pedido(crear_destino(CENTRO), slp_code="7", eta="13:20")
        r = self.client.get(f"/api/ventas/pedidos?fecha={FECHA}&slp_code=7")
        self.assertEqual(r.status_code, 200, "el endpoint reventaba con NameError")
        (pedido,) = r.json()
        self.assertEqual((pedido["eta_desde"], pedido["eta_hasta"]), ("13:05", "13:35"))

    def test_cada_vendedora_ve_solo_lo_suyo(self):
        crear_pedido(crear_destino(CENTRO), slp_code="7")
        crear_pedido(crear_destino(SAN_PEDRO), slp_code="9")
        datos = self.client.get(f"/api/ventas/pedidos?fecha={FECHA}&slp_code=7").json()
        self.assertEqual(len(datos), 1)

    def test_vendedores_del_dia(self):
        crear_pedido(crear_destino(CENTRO), slp_code="7")
        crear_pedido(crear_destino(SAN_PEDRO), slp_code="7")
        (fila,) = self.client.get(f"/api/ventas/vendedores?fecha={FECHA}").json()
        self.assertEqual(fila["pedidos"], 2)

    def test_la_situacion_explica_por_que_un_pedido_no_se_puede_programar(self):
        crear_pedido(crear_destino(coords=None), slp_code="7")
        (pedido,) = self.client.get(f"/api/ventas/pedidos?fecha={FECHA}&slp_code=7").json()
        self.assertIn("le falta la ubicación en SAP", pedido["situacion"])

    def test_las_paradas_hechas_cuentan_aunque_no_se_hayan_podido_entregar(self):
        """
        La pregunta del cliente es "¿ya mero?". Una parada donde el camión llegó
        y no pudo entregar YA la hizo: contarla como pendiente le dice al
        siguiente cliente que faltan más paradas de las que faltan.
        """
        ruta = crear_ruta()
        crear_pedido(crear_destino(CENTRO), ruta=ruta, secuencia=1, estado='Entregado')
        crear_pedido(crear_destino(SAN_PEDRO), ruta=ruta, secuencia=2, estado='No_Entregado')
        mio = crear_pedido(crear_destino((25.70, -100.30)), ruta=ruta, secuencia=3,
                           estado='En_Camino', slp_code="7")

        (pedido,) = self.client.get(
            f"/api/ventas/pedidos?fecha={FECHA}&slp_code=7").json()

        self.assertEqual(pedido["id"], mio.id)
        self.assertEqual(pedido["paradas_antes"], 2)
        self.assertEqual(pedido["entregadas_antes"], 2)

    def test_los_faltantes_se_dicen_producto_por_producto(self):
        pedido = crear_pedido(crear_destino(CENTRO), slp_code="7",
                              estado='Entregado_Parcial')
        crear_linea(pedido, cantidad=3, entregada=1, descripcion="Queso manchego")

        (fila,) = self.client.get(f"/api/ventas/pedidos?fecha={FECHA}&slp_code=7").json()

        self.assertEqual(fila["faltantes"], ["1 de 3 Pieza · Queso manchego"])


class AppDelChofer(BaseAPI):
    def test_camion_sin_ruta_contesta_404_no_un_500(self):
        """Esta rama reventaba con NameError: `api` no está en ese módulo."""
        r = self.client.get(f"/api/chofer/ruta?fecha={FECHA}&camion=RA7475A")
        self.assertEqual(r.status_code, 404)
        self.assertIn("no tiene ruta", r.json()["detail"])

    def test_la_ruta_del_dia_trae_todo_lo_que_se_necesita_en_la_calle(self):
        ruta = crear_ruta(estado='En_Ruta')
        d = crear_destino(CENTRO, ini1=time(9, 0), fin1=time(14, 0))
        d.telefono = "8112345678"; d.save()
        pedido = crear_pedido(d, ruta=ruta, secuencia=1, estado='En_Camino', eta="10:00")
        crear_linea(pedido, cantidad=2)

        datos = self.client.get(
            f"/api/chofer/ruta?fecha={FECHA}&camion=RA7475A").json()

        (parada,) = datos["paradas"]
        self.assertEqual(parada["telefono"], "8112345678")
        self.assertEqual(parada["ventana"], "09:00 - 14:00")
        self.assertEqual((parada["eta_desde"], parada["eta_hasta"]), ("09:45", "10:15"))
        self.assertEqual(len(parada["lineas"]), 1)

    def test_las_paradas_vienen_en_el_orden_del_plan(self):
        ruta = crear_ruta(estado='En_Ruta')
        crear_pedido(crear_destino(CENTRO), ruta=ruta, secuencia=2)
        crear_pedido(crear_destino(SAN_PEDRO), ruta=ruta, secuencia=1)

        datos = self.client.get(f"/api/chofer/ruta?fecha={FECHA}&camion=RA7475A").json()

        self.assertEqual([p["secuencia_ruta"] for p in datos["paradas"]], [1, 2])
