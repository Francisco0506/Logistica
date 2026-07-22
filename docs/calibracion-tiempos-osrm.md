# Calibración de tiempos: OSRM vs. GPS real (Samsara)

Capturado el 2026-07-21 a partir de una duda de Francisco: *"estamos usando el
mapa OSRM, ¿por qué no se usan los 42 km/h que tenemos medidos?"*.

La duda es correcta y destapó un sesgo real en el plan. **Nada de esto está
corregido todavía en el código** — el doc existe para no perder el hallazgo ni
el razonamiento.

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

## 6. Hallazgo aparte: el OSRM propio no está prendido

En `backend/.env:11-13`, `OSRM_BASE` está comentado ("hasta que el mapa termine
de procesarse") y `localhost:5001` no responde. Hoy todo corre contra el
**servidor público demo** (`router.project-osrm.org`), que además rechaza
`exclude=motorway` — o sea que tampoco se están evitando casetas: cae al
segundo intento sin exclusión (`routing_service.py:51-61`, y el `fuente` que
devuelve es `"osrm"`, no `"osrm_sin_casetas"`).

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
