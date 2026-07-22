# Calibración de tiempos: OSRM vs. GPS real (Samsara)

Capturado el 2026-07-21 a partir de una duda de Francisco: *"estamos usando el
mapa OSRM, ¿por qué no se usan los 42 km/h que tenemos medidos?"*.

La duda es correcta y destapó un sesgo real en el plan, más otras dos cosas al
tirar del hilo.

**Estado:** las secciones 6 y 8 (mensaje de error real y ETA desfasada) ya
están corregidas. El factor de calibración del final **sigue pendiente** a
propósito — ver por qué al final del doc.

---

## 1. Samsara no calcula rutas

Primero hay que separar responsabilidades, porque es la fuente de la confusión:

| Pieza | Qué aporta |
|-------|------------|
| **SAP** | Pedidos del día, lat/lng de cada cliente, ventana de recibo |
| **OSRM** | "De este punto exacto a este otro: X km y Y minutos por calle" |
| **OR-Tools** | Decide el orden de las paradas y qué camión lleva qué |
| **Samsara** | ① Dónde está el camión **ahora** (mapa en vivo) ② Las **constantes calibradas** ya medidas |

Samsara es telemetría: dice qué pasó y qué está pasando. No sabe ir de un punto
a otro y no participa en el cálculo de la ruta.

## 2. Cómo se arman los nodos

No se rutea por zona ni por promedio. Es por **coordenada exacta**, y se pide
**una sola llamada** con la matriz completa de todos contra todos
(`routing_service.py:49-50`):

```
Nodo 0 = CEDIS
Nodo 1 = cliente A (25.7044, -100.2363)
Nodo 2 = cliente B (25.6714, -100.3161)
...
```

OSRM regresa la matriz de distancias (metros) y la de tiempos (segundos):

```
            CEDIS   A       B       C
CEDIS   [    0    30.0    19.7    27.4  ]   km
A       [  30.0     0     11.2     8.4  ]
B       [  19.7   11.2     0      14.1  ]
C       [  27.4    8.4    14.1     0    ]
```

Nunca existe un "Guadalupe ≈ 30 km" genérico: si mañana el cliente de esa zona
es otro, el número cambia.

Detalle importante que el código ya hace bien: varias remisiones al mismo
cliente el mismo día colapsan en **un solo nodo** (`optimizer.py:128-152`) — el
camión entra una vez, no tres.

## 3. Dónde quedaron los 42 km/h medidos

En `optimizer.py:14`:

```python
VELOCIDAD_PROMEDIO_KMH = 42.0  # Solo se usa si OSRM no responde (respaldo Haversine)
```

Se pasa a `build_distance_time_matrices(...)`, pero adentro
(`routing_service.py:73-88`) solo se usa en la rama de emergencia. **Si OSRM
contesta, la velocidad medida ni se mira** — se toman los tiempos de OSRM tal
cual (`routing_service.py:77`):

```python
time_matrix_min = [[int(d / 60) for d in row] for row in durations_s]
```

Para **distancia** esto está bien y no hay que cambiarlo: 42.3 km/h es una
velocidad, no una distancia. El respaldo Haversine mide en línea recta y
subestima los km reales; OSRM da kilómetros de calle de verdad. Ahí OSRM gana
sin discusión.

El problema es el **tiempo**.

## 4. La medición: OSRM es ~25% optimista

Consulta hecha el 2026-07-21 contra el servidor OSRM en uso, desde el CEDIS
(25.693215, -100.48168) a 8 destinos representativos del área metropolitana:

| Destino | km | min | km/h implícita |
|---------|---:|----:|---------------:|
| Apodaca | 40.3 | 42.0 | **57.5** |
| Periférico Escobedo | 31.5 | 33.5 | **56.3** |
| Guadalupe | 30.0 | 32.2 | **55.7** |
| San Nicolás | 27.4 | 29.7 | **55.4** |
| Centro Monterrey | 19.7 | 22.1 | **53.6** |
| García | 21.0 | 26.8 | 47.0 |
| San Pedro | 11.9 | 17.2 | 41.5 |
| Santa Catarina | 4.7 | 8.1 | 34.8 |

| | |
|---|---:|
| Promedio ponderado OSRM | **52.9 km/h** |
| Real medido con Samsara (1 mes, 5 camiones) | **42.3 km/h** |
| Sesgo | **OSRM ~25% más optimista** |

Tiene explicación: OSRM usa límites de velocidad de OpenStreetMap en flujo
libre — un coche vacío, sin tráfico, sin semáforos reales. Los 42.3 km/h son un
ISUZU cargado en Monterrey, medido un mes. Encima el `int()` de
`routing_service.py:77` trunca hacia abajo: otro sesgo chico en la misma
dirección.

Nota: el 52.9 es un número de **diagnóstico**, calculado para este análisis. No
está guardado ni se usa en ningún lado del sistema.

## 5. Consecuencia operativa

El optimizador cree que el camión llega más rápido de lo que llega, así que
mete más paradas de las que caben. La ruta cierra bonito en el plan y truena el
turno de 6 h en la calle:

```
OSRM cree:   40 min manejo + 12 descarga por parada  ->  ~18 paradas
En la calle: 50 min manejo + 12 descarga             ->  ~15 paradas
```

El plan sale con 18, el chofer entrega 15 y se le hacen las 7 de la noche.

## 6. Sin OSRM el sistema NO truena — y por eso es peligroso

Vale la pena dejarlo escrito porque es contraintuitivo: si OSRM falla, el
optimizador **no lanza ninguna excepción**. Se probaron las dos hipótesis de
crash y las dos están cubiertas:

- Coordenada imposible de rutear → OSRM no devuelve `null`, la pega a la
  carretera más cercana. No hay `TypeError` al convertir la matriz.
- Más de 100 coordenadas → HTTP 400, pero `requests` no levanta excepción con
  un 400; el código lee el `code` del cuerpo, no encuentra `"Ok"` y devuelve
  `None`.

En los dos casos se cae al respaldo Haversine y **entrega rutas de aspecto
completamente normal**, calculadas en línea recta. Si tronara sería mejor: se
vería el error y se sabría desconfiar del plan.

### Por qué la línea recta no se puede "calibrar"

El error contra la calle real no es parejo:

| Destino | Recta | Calle | Error |
|---------|------:|------:|------:|
| Escobedo | 19.4 km | 31.5 km | **−38%** |
| Sta. Catarina | 3.1 km | 4.7 km | **−34%** |
| Apodaca | 31.0 km | 40.3 km | −23% |
| Guadalupe | 24.6 km | 30.0 km | −18% |
| Centro MTY | 16.8 km | 19.7 km | −15% |

Un sesgo parejo se arregla con un factor; éste no. Va de −15% a −38% según el
rumbo, porque la recta se brinca el cerro, el río y los sentidos únicos. En
línea recta Escobedo *parece* más cerca que Guadalupe (19.4 vs 24.6 km) cuando
por calle es **más lejos** (31.5 vs 30.0). Lo que se distorsiona no es la
distancia: es **qué paradas parecen cercanas entre sí**, o sea el orden de la
ruta — lo único que el optimizador tiene que decidir.

### Cuándo se cruzan las 100 paradas

Los nodos son `1 CEDIS + destinos distintos` (remisiones al mismo cliente
colapsan en un nodo). Con ~77 pedidos de día normal se va en ~78, raspando; en
un día pico de 139 se cruza. Es decir: **el día más cargado, justo cuando más
se ocupa el optimizador, es el día que se cae a línea recta.**

## 7. Hallazgo aparte: el OSRM propio no está prendido

En `backend/.env:11-13`, `OSRM_BASE` está comentado ("hasta que el mapa termine
de procesarse") y `localhost:5001` no responde. Hoy todo corre contra el
**servidor público demo** (`router.project-osrm.org`), que además rechaza
`exclude=motorway` — o sea que tampoco se están evitando casetas: cae al
segundo intento sin exclusión (`routing_service.py:51-61`, y el `fuente` que
devuelve es `"osrm"`, no `"osrm_sin_casetas"`).

## 8. La ETA estaba desfasada 12 minutos (CORREGIDO)

Al trazar el ejemplo CEDIS → Guadalupe paso por paso salió que las dos rutas de
código que calculan ETA **no coincidían**:

| Momento | ETA que daba | Qué era en realidad |
|---------|-------------|---------------------|
| Plan (antes de salir) | 09:44 | llegada **+ descarga** |
| Recálculo al dar "Salida" | 09:32 | llegada limpia |

Mismo camión, misma parada, 12 minutos de diferencia según si el despachador ya
había apretado "Salida". El motivo: en el plan el callback de tránsito lleva los
12 min de descarga sumados a toda columna destino (`optimizer.py:159-163`),
así que el acumulado de la dimensión `Time` es *fin de descarga*, no llegada.
`recalcular_etas_desde_salida` en cambio pide la matriz cruda y suma la descarga
**después** de fijar la ETA (`optimizer.py:480-489`).

**Decisión (Francisco, 2026-07-21): la ETA es la hora de LLEGADA** — el camión
toca la puerta a esa hora. Es lo que espera quien lee una ETA.

Corregido restando `TIEMPO_DESCARGA_MINUTOS` al extraer la ETA del plan. La
resta es válida aunque el camión llegue antes de que el cliente abra, porque la
espera por ventana de recibo se acumula como slack en la parada **anterior**,
no en la propia.

Ojo con el número real: 30 km a los 42.3 km/h medidos son ~43 min de manejo, no
32. La llegada real a Guadalupe sería ~09:43. O sea que corregir el desfase
arregla la *consistencia*, pero la ETA sigue optimista hasta que se aplique el
factor de la sección siguiente.

---

## Corrección propuesta (pendiente de aplicar)

No tirar OSRM, sino **calibrarlo** con lo que ya se midió: aplicar un factor de
~1.25 (52.9 / 42.3) a las duraciones de OSRM, en `routing_service.py`. Se
conserva la geometría real de calle de OSRM *y* se usa la velocidad real de la
flota.

**Al validarlo, esperar que el plan "empeore"**: las rutas van a traer menos
paradas cada una. Eso no es el optimizador funcionando peor, es el plan dejando
de prometer lo que no se cumple. La prueba de que quedó bien calibrado es
comparar contra las **15.5 paradas/día** reales de `flota.md` — si el plan da
15-16 por camión, está en el punto.

### Advertencias para cuando se aplique

- **Re-medir el factor al prender el OSRM propio.** Los 52.9 km/h salieron del
  servidor público con el perfil de coche por defecto. Un OSRM propio con otro
  perfil (o evitando autopistas de verdad) puede dar tiempos distintos, y el
  1.25 dejaría de ser el número correcto.
- El factor corrige **manejo**, no descarga. El tiempo de servicio por parada
  (`TIEMPO_DESCARGA_MINUTOS = 12`) ya está medido aparte con Samsara y ya se
  suma por separado en `optimizer.py:159-163`. No calibrar dos veces lo mismo.
- Los 42.3 km/h son *velocidad en movimiento* (excluye tiempo detenido), que es
  la comparación correcta contra el tiempo de manejo de OSRM. Están alineados.

### Deuda menor detectada de paso

`optimizer.py:13` remite a `docs/uso-flota-samsara.md`, que no existe — el
documento es `docs/flota.md`.
