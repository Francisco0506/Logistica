# Flota Laben — datos reales medidos con GPS (Samsara)

Todo lo de aquí sale del historial GPS real de Samsara, no de estimaciones.
Última medición: **19 de julio de 2026** (ventanas de 30 y 60 días).

---

## 1. La flota: 8 camiones ISUZU, pero solo 5 trabajan

Los Nissan Frontier, el Hino, el Freightliner y los 4 autos de vendedores no
son de reparto y quedan fuera del sistema.

| # | Placa | Samsara | Modelo real (VIN) | Año | Capacidad* | Máx. paradas** | Km (60 días) | Días activos (30 días) | Estado |
|---|-------|---------|-------------------|-----|-----------:|---------------:|-------------:|----------------------:|--------|
| 1 | RA7475A | 027 | NQR / ELF 600 | 2022 | 6,000 kg | 29 | 8,154 | 24 | 🟢 Diario |
| 2 | PP4873A | 023 | NPR / ELF 400-500 | 2020 | 3,500 kg | 30 | 7,499 | 25 | 🟢 Diario |
| 3 | PR6889B | 017 | NQR / ELF 600 | 2017 | 6,000 kg | 24 | 4,840 | 25 | 🟢 Diario |
| 4 | RJ97892 | 016 | NKR / ELF 200 | 2016 | 2,000 kg | 29 | 4,574 | 21 | 🟢 Casi diario |
| 5 | RJ37663 | 013 | NLR / **ELF 100** | 2015 | **1,500 kg** | 19 | 4,428 | 12 | 🟡 Refuerzo (mitad de los días) |
| 6 | PP4872A | 024 | NPR / ELF 400-500 | 2018 | 3,500 kg | 25 | 2,984 | 1 | 🔴 Parado |
| 7 | RJ57620 | 015 | NKR / ELF 200 | 2016 | 2,000 kg | 25 | 9 | 3 | 🔴 Sin operar |
| 8 | RH83800 | 012 | NPR / ELF 400-500 | 2014 | 3,500 kg | 25 | 0 | 0 | 🔴 Sin operar |

\* Capacidad = carga útil de ficha técnica de Isuzu México para el modelo
exacto. **El modelo sale del VIN que reporta Samsara**, no de la etiqueta
genérica: en los VIN no se usa la letra Q, por eso NQR aparece como `N1R`.
Equivalencias: NLR = ELF 100 (1,500 kg) · NKR = ELF 200 (2,000 kg) ·
NPR = ELF 400/500 (3,000-5,000 kg, se toma 3,500 para no arriesgar
sobrecarga) · NQR = ELF 600 (6,000 kg).
Ojo: el **013 es un ELF 100 de 1.5 toneladas**, no de 2 — lo teníamos
sobrestimado. Falta confirmar todo contra la tarjeta de circulación.

\*\* Máx. paradas = el récord real de entregas que ese camión ha hecho en un
día (medido con GPS). Se usa como tope práctico en el optimizador, porque
mientras SAP no mande el peso real de cada pedido, la restricción de kilos
corre con un estimado y no es confiable — las paradas sí están medidas.

**Los tres últimos (024, 015, 012) arrancan desactivados en el panel** — se
activan con un clic el día que se ocupen.

---

## 2. Cómo opera la flota en la vida real

Promedios de los 5 camiones que sí trabajan (30 días). Se excluyen 024/015/012
porque ensuciaban los números.

| Métrica | Promedio | Mediana | P75 |
|---------|---------:|--------:|----:|
| Hora de salida del CEDIS | **10:16** | 09:53 | — |
| Hora de regreso | **16:58** | — | — |
| Horas repartiendo | **6.7 h** | 6.4 h | 8.1 h |
| Paradas por día (= pedidos por ruta) | **15.5** | 15 | 20 |
| Tiempo de descarga por parada | **11.7 min** | 9.2 min | 14.5 min |
| Velocidad en movimiento | **42.3 km/h** | 39.0 km/h | — |

### Detalle por camión

| Camión | Días | Sale | Regresa | Jornada | Paradas/día | Descarga |
|--------|-----:|------|---------|--------:|------------:|---------:|
| 027 | 24 | 09:36 | 17:00 | 7.4 h | 16.6 | 11.5 min |
| 023 | 25 | 10:12 | 17:59 | 7.9 h | 17.9 | 11.5 min |
| 017 | 25 | 10:40 | 16:40 | 6.0 h | 11.8 | 12.9 min |
| 016 | 21 | 10:10 | 16:04 | 5.9 h | 18.0 | 10.8 min |
| 013 | 12 | 11:08 | 17:11 | 6.0 h | 11.9 | 12.3 min |

### Cuántos pedidos aguanta un camión

| Camión | Día normal | Día pesado (récord real) |
|--------|-----------:|-------------------------:|
| 023 | ~18 | 38 (con 12.9 h de jornada) |
| 016 | ~18 | 29 |
| 027 | ~17 | 29 |
| 017 | ~12 | 24 |
| 013 | ~12 | 19 |

La flota completa mueve **~77 pedidos en un día normal** y hasta ~139 en un día
tope. Los récords siempre vienen con jornadas de 8 a 13 horas.

### Días de la semana

| Día | Camiones en promedio |
|-----|---------------------:|
| Lunes | 4.2 |
| Martes | 4.2 |
| Miércoles | 3.8 |
| Jueves | 3.8 |
| **Viernes** | **4.6** (el más fuerte) |
| **Sábado** | **4.0** (se trabaja normal) |
| Domingo | 0 (nunca sale nadie) |

El sábado salen los mismos 4 camiones que entre semana, pero con menos volumen
(~40-55 paradas totales vs ~60-77 entre semana).

**Casi no paran a comer**: 3 a 6 paradas largas al mes por camión. Comen en ruta
o al regresar. Hacen entre 1.1 y 1.6 vueltas al CEDIS por día (013 y 016 son los
que más regresan a recargar y vuelven a salir).

---

## 3. Casos que hay que aclarar con operaciones

**023 (PP4873A) — sábado 18-jul, no regresó al CEDIS**

- 00:51–10:50: parado en el CEDIS toda la mañana
- **10:51: salió**
- 11:34 en adelante: llega al Periférico (General Escobedo, 21 km del CEDIS)
- **11:56–13:25 y 13:28–17:44: parado ahí ~5.5 horas seguidas**
- 18:31–19:42: sigue en el mismo punto
- 21:18–23:29: se mueve a García y ahí pernocta
- Domingo 19-jul: seguía en García (última posición 15:30, Morelos)

No hay patrón de reparto (sin paradas múltiples). ¿Taller? ¿El chofer se lleva
la unidad?

**024 (PP4872A) — lleva días parado en Guadalupe**

Detenido en Av. Benito Juárez desde el 14-jul:
https://www.google.com/maps?q=25.674437,-100.215020
Ya venía trabajando a la mitad que sus gemelos antes de pararse.

**015 y 012 — dos meses sin operar**

9 km y 0 km en 60 días. ¿Descompuestos, vendidos, reserva? Si no van a operar,
conviene decidir si se quedan en el sistema.

**Ubicación fija en Guadalupe (~25.7044, -100.2363)**

013 y 029 se quedan horas ahí. Parece base o parking nocturno, no cliente.

---

## 4. Ventanas de horario de los clientes

De los 195 destinos importados, **todos tienen ventana capturada**, pero:

| Cierra a las | Destinos |
|-------------|---------:|
| Antes de las 11:00 | 5 |
| 11:00 – 11:59 | 5 |
| **12:00 – 12:59** | **57** |
| **13:00 – 13:59** | **40** |
| 14:00 – 15:59 | 25 |
| 16:00 o después | 63 |

**El dato importante: 97 de 195 destinos cierran antes de las 14:00.** Como los
camiones salen ~10:16, quedan menos de 4 horas para atender a la mitad de los
clientes. Esa es la razón de fondo por la que las rutas van apretadas.

**4 destinos tienen la hora mal capturada en SAP** (les falta el PM):
LA PARMESANA "08:00-06:00", Santo Chickn Gpe "09:00-03:00", WYNDHAM MONTERREY
"09:00-05:00", BARBARO "08:00-00:00". El optimizador las ignora y usa el turno
completo, pero conviene corregirlas en SAP.

Con ventana temprana genuina solo hay uno: **Narciso Cafetería (07:00–09:00)** —
imposible de atender si el camión sale a las 10.

---

## 5. Cómo se calibró el optimizador

Ver el detalle de constantes en `backend/delivery/optimizer.py`.

| Constante | Valor | De dónde sale |
|-----------|-------|---------------|
| `TIEMPO_DESCARGA_MINUTOS` | 12 | Real 11.7 min promedio (1,662 paradas medidas) |
| `VELOCIDAD_PROMEDIO_KMH` | 42 | Real 42.3 km/h (solo respaldo si OSRM cae) |
| `MINUTOS_TURNO_MAXIMO` | 6 h | Turno oficial. La jornada real llega a 6.7 h — ampliable a 8 h desde el panel |
| `HORA_CERO` | 09:00 | El primer camión de cada día sale 09:06 en promedio (mediana 09:08), medido sobre 25 días |
| `INTERVALO_SALIDA_MINUTOS` | 0 | Ver abajo: el escalonamiento real es consecuencia de la carga, no una decisión de ruteo |
| `CAPACIDADES_CAMION_KG` | 1.5 / 2.0 / 3.5 / 6.0 ton | Ficha Isuzu del modelo exacto (VIN), en orden de uso real |
| `MAX_PARADAS_POR_CAMION` | 19 a 30 | Récord real de entregas por día de cada camión (GPS) |

**Resultado verificado**: 80 pedidos y 5 camiones → 77 asignados en rutas de
13 a 20 paradas, con ETAs de 09:19 AM a 02:01 PM. Eso coincide con la
operación real (15.5 paradas/día por camión, regreso ~17:00).

### Dos trampas que costaron caro (documentadas para no repetirlas)

**1. `HORA_CERO` no es cosmética.** Las ventanas de los clientes se miden como
minutos desde esa hora. Ponerla en 10:00 (por el promedio de salida de *todos*
los camiones) hizo que el plan pasara de 77 a 60 pedidos asignados sin que
nada cambiara en la operación: un cliente que cierra a las 12:00 pasó de tener
5 horas de margen a 2. La constante debe ser la salida del **primer** camión.

**2. El escalonamiento no se debe forzar.** En la calle los camiones sí salen
separados (medido: 31 min de mediana entre uno y otro, con días de 19 min y
días de 4 horas), pero ese hueco es la **consecuencia** de cuánto tarda la
carga, no una decisión de ruteo. Forzarlo en el modelo castiga dos veces al
último camión: sale tarde y además pierde la ventana de los clientes.

| Escalón en el plan | Pedidos asignados (de 80) |
|-------------------:|--------------------------:|
| **0 min** | **77** ← calca la realidad |
| 10 min | 75 |
| 20 min | 71 |
| 30 min | 67 |

### Qué sí mueve la aguja y qué no

Probado cambiando **una sola variable** a la vez:

| Palanca | Efecto |
|---------|--------|
| **Salir 1 hora más temprano** | **+5 pedidos** — lo más efectivo |
| Agregar un 6º camión | +2 o 3 pedidos |
| Ampliar el turno a 7 u 8 horas | **casi cero** |
| Capacidades reales vs. 3 ton parejo | −2 pedidos (y es correcto: antes se sobrecargaba) |

La conclusión operativa: **acelerar la carga en el CEDIS vale más que alargar
la jornada**. El límite no es el chofer, son las ventanas de los clientes —
97 de 195 cierran antes de las 14:00, así que trabajar más tarde no sirve.

**Peso de los pedidos**: SAP todavía no está conectado, así que el peso real por
pedido no llega. Cuando falta, el optimizador usa `PESO_ESTIMADO_KG = 150`.
Referencia para validarlo cuando llegue SAP: si un camión de 3.8 ton hace 18
paradas y sale lleno, el promedio por pedido rondaría los 210 kg; si un ELF 100
de 2 ton hace 18 paradas, ~110 kg. El estimado de 150 kg cae en medio, pero
**hay que confirmarlo con datos reales de SAP** — no está medido.

---

## 6. Fichas para confirmar capacidades (tarjeta de circulación)

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

Al confirmarlas hay que actualizar `CAPACIDADES_CAMION_KG` en
`backend/delivery/api.py` y `FLEET` en `frontend/src/config/fleet.js` (mismo
orden en ambos).
