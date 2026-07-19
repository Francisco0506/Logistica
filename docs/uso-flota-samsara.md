# Uso de la flota ISUZU — análisis GPS Samsara

**Fecha del análisis: 18 de julio de 2026.** Fuente: historial GPS crudo de
Samsara (solo lectura), km sumados punto a punto, "días activos" = días con
movimiento real (>3 km/h).

## Últimos 60 días (19-may → 18-jul 2026)

| # | Camión | Placa | Km | Horas manejo | Días activos | Capacidad estimada |
|---|--------|-------|-------:|------:|------:|--------------------|
| 1 | **027** | RA7475A | **8,154 km** | 206 h | 53 | 5.5 ton (ELF 600, 2022) |
| 2 | **023** | PP4873A | **7,499 km** | 189 h | 51 | 3.8 ton (ELF 400/500, 2020) |
| 3 | **017** | PR6889B | **4,840 km** | 138 h | 46 | 5.5 ton (ELF 600, 2017) |
| 4 | 016 | RJ97892 | 4,574 km | 152 h | 49 | 2.0 ton (ELF 100/200, 2016) |
| 5 | 013 | RJ37663 | 4,428 km | 131 h | 48 | 2.0 ton (ELF 100/200, 2015) |
| 6 | 024 | PP4872A | 2,984 km | 81 h | 48 | 3.8 ton (ELF 400/500, 2018) |
| 7 | 015 | RJ57620 | 9 km | 0 h | 3 | 2.0 ton (ELF 100/200, 2016) |
| 8 | 012 | RH83800 | 0 km | 0 h | 0 | 3.8 ton (ELF 400/500, 2014) |

## Última semana (11-jul → 18-jul 2026)

| Camión | Placa | Km | Horas mov. | Días activos |
|--------|-------|-------:|------:|------:|
| 027 | RA7475A | 1,270 km | 31.7 h | 6 |
| 023 | PP4873A | 1,009 km | 21.8 h | 6 |
| 017 | PR6889B | 888 km | 24.8 h | 6 |
| 013 | RJ37663 | 530 km | 13.4 h | 6 |
| 016 | RJ97892 | 218 km | 7.0 h | 2 |
| 024 | PP4872A | 44 km | 1.2 h | 2 |
| 015 | RJ57620 | 0 km | 0 h | 0 |
| 012 | RH83800 | 0 km | 0 h | 0 |

## Conclusiones operativas

- **La flota operativa real son 6 camiones, no 8.** 015 y 012 llevan 2 meses
  prácticamente sin moverse (9 km y 0 km). Decidir: ¿descompuestos, reserva, o
  dar de baja del panel?
- **027 y 023 son los caballos de batalla** (~130 km/día, activos 53 y 51 días
  de 60, incluidos fines de semana).
- **024 venía flojo desde antes de pararse**: la mitad de km que sus gemelos
  ELF 400/500, y desde el 14-jul 12:36 está clavado en Av. Benito Juárez,
  Guadalupe: https://www.google.com/maps?q=25.674437,-100.215020 (pendiente
  confirmar con operaciones qué hay ahí — ¿taller?).
- Los 3 camiones más usados concentran ~58% de los km y son los de mayor
  capacidad (5.5/3.8 ton) — por eso importa que el optimizador ya use la
  capacidad real por camión (`CAPACIDADES_CAMION_KG` en backend/delivery/api.py).

## Perfil operativo diario — últimos 30 días (solo días trabajados)

Detección por GPS: "sale/regresa" = cruce del radio de 400 m del CEDIS con
salida real (>2 km, >30 min fuera); "paradas/día" = detenciones de 4-45 min
fuera del CEDIS (≈ entregas); "descarga" = duración promedio de esas paradas;
"comidas" = paradas de 45+ min entre 11:30 y 16:00; "vueltas" = salidas del
CEDIS por día (2 = regresó a recargar y volvió a salir).

| Camión | Días trab. | Sale | Regresa | Jornada | Vueltas/día | Paradas/día | Descarga | Comidas (mes) | Vel. km/h |
|--------|----------:|------|---------|--------:|------------:|------------:|---------:|--------------:|----------:|
| 013 | 13 | 11:03 | 17:00 | 5.9 h | 1.62 | 11.7 | 12.6 min | 3 | 38.9 |
| 016 | 22 | 10:06 | 16:03 | 5.9 h | 1.45 | 17.9 | 10.9 min | 3 | 37.8 |
| 017 | 25 | 10:25 | 16:40 | 6.2 h | 1.16 | 12.3 | 12.8 min | 6 | 38.9 |
| 023 | 26 | 10:13 | 18:01 | 7.9 h | 1.12 | 17.7 | 11.5 min | 3 | 45.0 |
| 024 | 1 | 11:16 | — | — | 1.00 | 3.0 | 7.8 min | 1 | 43.4 |
| 027 | 24 | 09:36 | 17:00 | 7.4 h | 1.42 | 16.6 | 12.3 min | 3 | 45.2 |

### Lecturas clave

- **Nadie sale a las 8:00.** La primera salida promedio va de 09:36 (027) a
  11:03 (013). Cualquier ETA prometida a clientes/vendedoras debe partir de la
  hora REAL de salida (`hora_salida` en el sistema), no de una teórica.
- **La jornada real de 023 (7.9 h) y 027 (7.4 h) excede el turno de 6 h** que
  usa el optimizador — por eso a veces "no caben" pedidos que en la práctica
  sí se entregan. La opción de turno 6-8 h del panel refleja la realidad.
- **Paradas por día ≈ pedidos por camión: 12-18.** Sirve de sanity check de
  las rutas del optimizador.
- **Descarga promedio 10.9-12.8 min** → la constante TIEMPO_DESCARGA_MINUTOS=12
  del optimizador está bien calibrada.
- **Velocidad 38-45 km/h** → VELOCIDAD_PROMEDIO_KMH=43 (respaldo) razonable.
- **Casi no hay parada de comida**: 3-6 paradas largas al mes por camión
  (los choferes comen en ruta o al regresar). ~1.1-1.6 vueltas al CEDIS por día
  (016 y 013 recargan y vuelven a salir con más frecuencia).

## ¿Cuántos pedidos le caben a un camión? — días récord y horas reales (30 días)

| Camión | Días trab. | Paradas/día prom. | **Récord de paradas** | Top 3 días | Jornada prom. | **Jornada máx.** |
|--------|----------:|------:|------:|------------|------:|------:|
| 013 | 13 | 11.7 | **19** | 03-jul: 19 (6.3h) · 18-jul: 19 (4.9h) · 20-jun: 18 (10.1h) | 5.9 h | 10.2 h |
| 016 | 22 | 17.9 | **29** | 01-jul: 29 (7.7h) · 02-jul: 27 (7.9h) · 07-jul: 26 (6.8h) | 5.9 h | 8.3 h |
| 017 | 25 | 12.3 | **24** | 19-jun: 24 (11.7h) · 13-jul: 21 (6.6h) · 15-jul: 20 (8.6h) | 6.2 h | 11.7 h |
| 023 | 26 | 17.7 | **38** | 15-jul: 38 (12.9h) · 08-jul: 33 (10.9h) · 30-jun: 30 (10.0h) | 7.9 h | 13.0 h |
| 024 | 1 | 3.0 | 3 | 14-jul: 3 | — | — |
| 027 | 24 | 16.6 | **29** | 16-jul: 29 (9.8h) · 25-jun: 26 (8.1h) · 23-jun: 23 (8.7h) | 7.4 h | 12.7 h |

### Número práctico de pedidos por camión (referencia para despacho)

Basado en promedio (día normal) y récord observado (día tope, con jornada larga):

| Camión | Día normal | Día pesado (tope real observado) |
|--------|-----------:|--------------------------------:|
| 023 | ~18 | hasta 38 (con 13 h de jornada) |
| 016 | ~18 | hasta 29 |
| 027 | ~17 | hasta 29 |
| 017 | ~12 | hasta 24 |
| 013 | ~12 | hasta 19 |

Ojo: los días récord vienen acompañados de jornadas de 8-13 horas — muy por
encima del turno de 6 h que el optimizador usa por default. Si se quiere que
el plan del optimizador se parezca a los días pesados reales, hay que correrlo
con turno de 7-8 h (opción ya disponible en el panel).

## ¿Cuántos camiones salen por día de la semana? (últimos 30 días)

| Día | Camiones en promedio |
|-----|---------------------:|
| Lunes | 4.2 |
| Martes | 4.2 |
| Miércoles | 3.8 |
| Jueves | 3.8 |
| Viernes | **4.6** (el día más fuerte) |
| **Sábado** | **4.0** (se trabaja igual que entre semana) |
| Domingo | 0 — nunca sale nadie |

Detalle de los 5 sábados observados (siempre 4 camiones, con menos paradas
que entre semana):

- sáb 20-jun: 013=18, 016=16, 017=7, 023=6 paradas
- sáb 27-jun: 016=16, 017=12, 023=11, 027=9
- sáb 04-jul: 016=15, 017=15, 023=13, 027=10
- sáb 11-jul: 016=14, 017=9, 023=5, 027=6
- sáb 18-jul: 013=19, 017=9, 023=7, 027=13

Lectura: el sábado NO es día flojo en número de camiones (salen 4, como
cualquier día), pero sí en volumen (~40-55 paradas totales vs ~60-77 entre
semana). La flota diaria realista es de 4 camiones + 1 de refuerzo.

## Calibración del optimizador (1 mes GPS, SOLO los 5 camiones que operan)

Se excluyen 024/015/012 porque casi no salen y ensuciaban los promedios.

| Camión | Días | Sale | Regresa | Jornada | Paradas/día | Descarga |
|--------|-----:|------|---------|--------:|------------:|---------:|
| 013 | 12 | 11:08 | 17:11 | 6.0 h | 11.9 | 12.3 min |
| 016 | 21 | 10:10 | 16:04 | 5.9 h | 18.0 | 10.8 min |
| 017 | 25 | 10:40 | 16:40 | 6.0 h | 11.8 | 12.9 min |
| 023 | 25 | 10:12 | 17:59 | 7.9 h | 17.9 | 11.5 min |
| 027 | 24 | 09:36 | 17:00 | 7.4 h | 16.6 | 11.5 min |

**Promedios de flota:**

| Métrica | Valor | Mediana | P75 |
|---------|-------|---------|-----|
| Hora de salida del CEDIS | **10:16** | 09:53 | — |
| Hora de regreso | **16:58** | — | — |
| Horas repartiendo (jornada) | **6.71 h** | 6.43 h | 8.07 h |
| Paradas/día (= pedidos por ruta) | **15.5** | 15 | 20 (máx 38) |
| Descarga por parada | **11.7 min** | 9.2 min | 14.5 min |
| Velocidad en movimiento | **42.3 km/h** | 39.0 km/h | — |

### Qué se cambió en el optimizador con estos números

| Constante | Antes | Ahora | Motivo |
|-----------|-------|-------|--------|
| `HORA_CERO` | 07:00 | **10:00** | Los camiones no salen a las 7; salida real 10:16 (mediana 09:53). Antes las ETAs del plan nacían 3 h adelantadas. |
| `MINUTOS_TURNO_MAXIMO` | 6 h | **6.5 h** | Jornada real mediana 6.43 h. Ampliable a 8 h desde el panel. |
| `VELOCIDAD_PROMEDIO_KMH` | 43 | **42** | Medido 42.3 (solo respaldo si OSRM cae). |
| `TIEMPO_DESCARGA_MINUTOS` | 12 | **12** (sin cambio) | Confirmado: real 11.7 min promedio. |

Verificado tras el cambio: con 80 pedidos y 5 camiones, las rutas salen de 15
paradas con ETAs de 10:15 AM a 2:46 PM — coincide con la operación real
(mediana 15 paradas/día).

Nota sobre ventanas: de los 195 destinos, 97 cierran antes de las 14:00 y solo
5 cierran antes de las 11:00 — de esos, 4 tienen la hora mal capturada en SAP
(ej. "08:00 - 06:00", les falta el PM). El único con ventana temprana genuina
es Narciso Cafetería (07:00-09:00), imposible de atender si el camión sale a
las 10:00.

## Caso 023 (PP4873A) — sábado 18-jul: no regresó al CEDIS

Cronología por GPS:

- 00:51 – 10:50: parado en el CEDIS (toda la mañana)
- **10:51: salió del CEDIS**
- 10:55 – 11:03: parada de 8 min en Carretera Saltillo–Monterrey
- 11:34 en adelante: llega al Periférico (General Escobedo, a 21 km del CEDIS)
- **11:56 – 13:25 (89 min) y 13:28 – 17:44 (255 min): parado en el mismo punto**
- 18:31 – 19:42: sigue ahí (71 min más)
- 21:18 – 23:29: se mueve a Monterrey/García y ahí pernocta
- **Nunca regresó al CEDIS el sábado.** El domingo 19-jul seguía en García
  (última posición 15:30, Morelos, García NLE).

En total: ~7 horas detenido en un mismo punto del Periférico y pernocta fuera.
No es patrón de reparto (no hay paradas múltiples). Pendiente confirmar con
operaciones qué pasó (¿taller?, ¿el chofer se lleva la unidad a casa?).

## Fichas para confirmar capacidades (tarjeta de circulación / VIN)

| Camión | Placa | Modelo | Año | VIN |
|--------|-------|--------|-----|-----|
| 012 | RH83800 | ELF 400/500 | 2014 | JAANPR754E7005411 |
| 013 | RJ37663 | ELF 100/200 | 2015 | JAANLR858F7200133 |
| 015 | RJ57620 | ELF 100/200 | 2016 | JAA1KR778G7100118 |
| 016 | RJ97892 | ELF 100/200 | 2016 | JAA1KR775G7100447 |
| 017 | PR6889B | ELF 600 | 2017 | JAAN1R758H7902236 |
| 023 | PP4873A | ELF 400/500 | 2020 | JAANPR758L7000211 |
| 024 | PP4872A | ELF 400/500 | 2018 | JAANPR756J7000561 |
| 027 | RA7475A | ELF 600 | 2022 | 3MGN1R755NM000496 |

Capacidades = carga útil aproximada por ficha técnica de Isuzu México
(ELF 100/200 ≈ 2,000 kg · ELF 400/500 ≈ 3,800 kg · ELF 600 ≈ 5,500 kg).
**Pendiente confirmar contra tarjeta de circulación** y actualizar
`CAPACIDADES_CAMION_KG` (backend) y `FLEET` (frontend/src/config/fleet.js).
