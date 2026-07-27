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

    # Datos de contacto del Ship-To (UDFs de SAP: U_Contacto, U_Telefono, U_Referencias)
    contacto = models.CharField(max_length=150, null=True, blank=True)
    telefono = models.CharField(max_length=30, null=True, blank=True)
    referencias = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        unique_together = ('card_code', 'ship_to_code')

    def __str__(self):
        return f"{self.card_code} - {self.ship_to_code}"


class Remision(models.Model):
    ESTADOS = [
        ('Pendiente', 'Listo en almacén'),
        ('Asignado', 'En preparación'),
        ('En_Camino', 'En ruta'),
        ('Entregado', 'Entregado completo'),
        # El chofer entregó parte del pedido: el cliente aceptó menos de lo que
        # traía, venía dañado, o no venía completo en el camión. Se distingue de
        # 'Entregado' porque para ventas y para facturación NO es lo mismo.
        ('Entregado_Parcial', 'Entregado incompleto'),
        ('No_Entregado', 'No se pudo entregar'),
    ]

    # Por qué no se entregó completo. Catálogo cerrado para poder contar y
    # comparar después ("¿cuántas veces al mes nos rechazan producto?"); el
    # detalle libre va en `observaciones`.
    MOTIVOS = [
        ('cliente_rechazo', 'El cliente aceptó menos de lo que traía'),
        ('producto_danado', 'Producto dañado o en mal estado'),
        ('falto_en_camion', 'No venía completo en el camión'),
        ('cerrado', 'El cliente estaba cerrado'),
        ('sin_quien_reciba', 'No había quién recibiera'),
        ('sin_espacio', 'El cliente no tenía dónde meterlo'),
        ('otro', 'Otro motivo'),
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

    # ── Lo que el chofer reporta desde la calle ──
    # Hora REAL de la entrega, no la estimada. Es el único dato que permite
    # medir después qué tan lejos anda la ETA y cuánto se tarda de verdad en
    # cada parada; hasta ahora eso solo se podía aproximar con el GPS.
    entregado_en = models.DateTimeField(null=True, blank=True)
    motivo = models.CharField(max_length=30, choices=MOTIVOS, null=True, blank=True)
    observaciones = models.TextField(null=True, blank=True)
    # Quién recibió, tal como lo escribe el chofer. La firma viene después
    # (ver docs/pendientes-vendedor-chofer.md).
    recibio = models.CharField(max_length=150, null=True, blank=True)
    # Foto de evidencia tomada en la puerta del cliente. Sirve sobre todo
    # cuando la entrega salió incompleta o no se pudo entregar: es la prueba de
    # lo que el chofer reporta.
    foto = models.ImageField(upload_to='entregas/%Y/%m/', null=True, blank=True)

    @property
    def entrega_confirmada(self):
        return self.estado in ('Entregado', 'Entregado_Parcial', 'No_Entregado')

    def __str__(self):
        return f"Remision {self.doc_num} - {self.card_name}"


class LineaRemision(models.Model):
    """
    Un renglón del pedido: qué producto y cuánto.

    Hace falta porque una entrega parcial no es "entregué el 60%": es "de las
    2 bolsas de queso rallado solo aceptó 1.5, y lo demás sí completo". Sin las
    líneas, el chofer no tiene qué marcar y ventas no puede decirle al cliente
    qué le faltó exactamente.

    Viene de RDR1 en SAP (las líneas del pedido de venta), que es la misma tabla
    de donde ya se saca el peso total del pedido.
    """
    remision = models.ForeignKey(Remision, on_delete=models.CASCADE, related_name='lineas')
    line_num = models.IntegerField()          # LineNum de RDR1
    item_code = models.CharField(max_length=50)
    descripcion = models.CharField(max_length=255)
    unidad = models.CharField(max_length=30, null=True, blank=True)

    # Lo que el pedido dice que va.
    cantidad = models.DecimalField(max_digits=12, decimal_places=3)
    peso_unitario_kg = models.FloatField(null=True, blank=True)

    # Lo que el chofer confirmó que dejó. `null` = todavía no se confirma nada;
    # 0 = se confirmó que NO se entregó nada de este renglón. Son cosas
    # distintas y por eso no se usa 0 como valor inicial.
    cantidad_entregada = models.DecimalField(
        max_digits=12, decimal_places=3, null=True, blank=True
    )

    class Meta:
        unique_together = ('remision', 'line_num')
        ordering = ['line_num']

    @property
    def completa(self):
        return self.cantidad_entregada is not None and self.cantidad_entregada >= self.cantidad

    def __str__(self):
        return f"{self.item_code} x{self.cantidad} ({self.remision.doc_num})"
