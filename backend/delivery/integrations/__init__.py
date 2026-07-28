"""Todo lo que habla con un sistema de afuera, junto y aparte.

    sap.py       SAP B1 (SQL Server): de dónde salen las órdenes de entrega
    osrm.py      OSRM: cuánto se hace de un punto a otro por calle real
    samsara.py   Samsara: dónde está cada camión ahora mismo

Están agrupados porque comparten lo que los hace distintos del resto del código:
dependen de algo que no controlamos —una red, un servidor ajeno, credenciales—
y por lo tanto pueden fallar de maneras que la lógica del negocio no. Cada uno
degrada a su modo cuando el servicio no responde, y eso se documenta en su
propio archivo.

Ninguno escribe en el sistema externo. Las tres conexiones son de SOLO LECTURA.
"""
