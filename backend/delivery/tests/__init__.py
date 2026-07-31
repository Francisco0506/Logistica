"""
Las pruebas del sistema.

Antes esto era `tests.py` con la plantilla vacía de Django. Cada archivo de
aquí existe por un bug que YA se cometió y que se descubrió en operación o
leyendo el código, no por cubrir líneas:

    test_ventanas.py      las ventanas de recibo (medianoche, corruptas, dos
                          turnos, la que abre después del turno)
    test_optimizador.py   que una ruta despachada jamás se destruya, que dos
                          clientes en el mismo domicilio sean UNA parada, y que
                          un pedido que no cupo regrese a Pendiente limpio
    test_api.py           que cada endpoint responda — los tres NameError que
                          traía el backend los habría cazado cualquiera de estas
    test_entregas.py      que el estado de una entrega corresponda a lo que de
                          verdad se dejó
    test_sap.py           que el sync no borre lo que no debe

Se corren sin Postgres ni SAP ni OSRM:

    cd backend
    DJANGO_SECRET_KEY=x DJANGO_TEST_DB=sqlite python manage.py test delivery
"""
