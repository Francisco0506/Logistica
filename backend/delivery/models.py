from django.db import models

class Ruta(models.Model):
    ESTADOS = [
        ('Borrador', 'En preparación'),
        ('Cargando', 'Cargando mercancía'),
        ('Listo', 'Listo para salir'),
        ('En_Ruta', 'En ruta'),
        ('Finalizada', 'Finalizada'),
    ]
    fecha = models.DateField()
    camion = models.CharField(max_length=100)
    chofer = models.CharField(max_length=100)
    estado = models.CharField(max_length=20, choices=ESTADOS, default='Borrador')
    hora_salida = models.TimeField(null=True, blank=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.camion} - {self.fecha}"


class Destino(models.Model):
    card_code = models.CharField(max_length=50)
    ship_to_code = models.CharField(max_length=100)
    street = models.CharField(max_length=255, null=True, blank=True)
    block = models.CharField(max_length=100, null=True, blank=True)
    city = models.CharField(max_length=100, null=True, blank=True)
    zip_code = models.CharField(max_length=20, null=True, blank=True)
    
    # Coordenadas como FloatField para evitar dependencias de GDAL en desarrollo local
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    
    # Delivery Windows
    ini_recibo_1 = models.TimeField(null=True, blank=True)
    fin_recibo_1 = models.TimeField(null=True, blank=True)
    ini_recibo_2 = models.TimeField(null=True, blank=True)
    fin_recibo_2 = models.TimeField(null=True, blank=True)
    
    # Days allowed
    ent_lun = models.BooleanField(default=True)
    ent_mar = models.BooleanField(default=True)
    ent_mie = models.BooleanField(default=True)
    ent_jue = models.BooleanField(default=True)
    ent_vie = models.BooleanField(default=True)
    ent_sab = models.BooleanField(default=True)

    class Meta:
        unique_together = ('card_code', 'ship_to_code')

    def __str__(self):
        return f"{self.card_code} - {self.ship_to_code}"


class Remision(models.Model):
    ESTADOS = [
        ('Pendiente', 'Listo en almacén'),
        ('Asignado', 'En preparación'),
        ('En_Camino', 'En ruta'),
        ('Entregado', 'Entregado'),
    ]
    
    doc_entry = models.IntegerField(unique=True)
    doc_num = models.IntegerField(unique=True)
    card_code = models.CharField(max_length=50)
    card_name = models.CharField(max_length=200)
    doc_date = models.DateField()
    doc_total = models.DecimalField(max_digits=15, decimal_places=2)
    slp_code = models.CharField(max_length=20)
    slp_name = models.CharField(max_length=100)
    
    destino = models.ForeignKey(Destino, on_delete=models.SET_NULL, null=True)
    ruta = models.ForeignKey(Ruta, on_delete=models.SET_NULL, null=True, blank=True, related_name='remisiones')
    secuencia_ruta = models.IntegerField(null=True, blank=True)
    eta = models.CharField(max_length=20, null=True, blank=True)

    # Peso real del pedido en KG. Null cuando SAP no lo trae todavía (ver SAP_UDF_PESO
    # en sync.py): en ese caso el optimizador usa un estimado fijo y lo marca como tal,
    # nunca un dato inventado que aparente ser real.
    peso_kg = models.FloatField(null=True, blank=True)
    
    estado = models.CharField(max_length=20, choices=ESTADOS, default='Pendiente')
    ultima_actualizacion = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Remision {self.doc_num} - {self.card_name}"
