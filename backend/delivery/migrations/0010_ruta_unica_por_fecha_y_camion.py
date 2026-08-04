"""Un camión, una ruta por día — ahora también en la base de datos.

La restricción no se puede poner a secas: la condición de carrera que la motiva
(ver el comentario de `Ruta.Meta`) YA corrió en producción, así que es probable
que la tabla traiga pares (fecha, camion) repetidos. Si los trae, el ALTER TABLE
revienta a media migración y el despliegue del miércoles se cae.

Por eso va primero un paso de limpieza que deja un solo sobreviviente por
(fecha, camion), y hasta después la restricción.
"""
from django.db import migrations


# Cuál de las rutas duplicadas es la BUENA: la que más avanzó físicamente. Una
# ruta 'En_Ruta' es un camión que de verdad anda en la calle con esa carga; una
# 'Borrador' es una intención. Entre dos intenciones, se queda la más reciente,
# que es la que el despachador estaba viendo.
ORDEN_ESTADO = {
    'Finalizada': 4,
    'En_Ruta': 3,
    'Listo': 2,
    'Cargando': 1,
    'Borrador': 0,
}

# Estados de una remisión en los que el camión YA se llevó la mercancía (o ya
# reportó qué pasó con ella). Se listan a mano y no se importan de models.py
# porque una migración tiene que seguir corriendo igual dentro de diez commits,
# aunque para entonces esas constantes se hayan movido o cambiado de contenido.
ESTADOS_CON_HISTORIA = (
    'En_Camino', 'Entregado', 'Entregado_Parcial', 'No_Entregado',
)


def limpiar_rutas_duplicadas(apps, schema_editor):
    Ruta = apps.get_model('delivery', 'Ruta')
    Remision = apps.get_model('delivery', 'Remision')

    por_camion_y_dia = {}
    for ruta in Ruta.objects.all():
        por_camion_y_dia.setdefault((ruta.fecha, ruta.camion), []).append(ruta)

    for (fecha, camion), rutas in por_camion_y_dia.items():
        if len(rutas) < 2:
            continue

        rutas.sort(
            key=lambda r: (ORDEN_ESTADO.get(r.estado, 0), r.creado_en, r.id),
            reverse=True,
        )
        sobrevive, sobran = rutas[0], rutas[1:]
        ids_sobran = [r.id for r in sobran]

        # Los pedidos que ya salieron o que ya traen entrega reportada NO se
        # sueltan: se pasan a la ruta que sobrevive. Su foto, su firma y sus
        # cantidades por renglón son la única prueba de que la mercancía se
        # entregó, y no se le pueden volver a pedir a SAP. Se les deja la
        # secuencia que traían aunque choque con la de la otra ruta: un orden
        # repetido en el manifiesto de un día ya pasado es un detalle cosmético
        # al lado de perder la evidencia.
        Remision.objects.filter(
            ruta_id__in=ids_sobran, estado__in=ESTADOS_CON_HISTORIA,
        ).update(ruta_id=sobrevive.id)

        # Los demás (los que solo estaban 'Asignado' a una ruta que nunca
        # existió del todo) vuelven a Pendiente completamente limpios, para que
        # la siguiente corrida los levante. Sin borrarles la ETA se quedarían
        # prometiéndole al cliente una hora de un camión que ya no va.
        Remision.objects.filter(ruta_id__in=ids_sobran).update(
            estado='Pendiente', ruta=None, secuencia_ruta=None, eta=None,
        )

        Ruta.objects.filter(id__in=ids_sobran).delete()


def no_se_deshace(apps, schema_editor):
    """Quitar la restricción se deshace solo; las rutas borradas no vuelven.
    Se deja explícito para que revertir la migración no falle."""


class Migration(migrations.Migration):

    dependencies = [
        ('delivery', '0009_ruta_regreso_plan_ruta_salida_plan'),
    ]

    operations = [
        migrations.RunPython(limpiar_rutas_duplicadas, no_se_deshace),
        migrations.AlterUniqueTogether(
            name='ruta',
            unique_together={('fecha', 'camion')},
        ),
    ]
