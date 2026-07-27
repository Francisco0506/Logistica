# Cómo funciona el sistema — explicaciones

Este documento junta las explicaciones de las decisiones y los conceptos del
sistema, en lenguaje llano. Es para consultar cuando algo no se entienda, sin
tener que leer código.

Escrito el 25 de julio de 2026.

---

## 1. Los dos pesos (son distintos y vienen de lados distintos)

Es la confusión más común. Cuando se habla de "peso" en este sistema son **dos
cosas diferentes**:

| | Qué es | De dónde sale | ¿Lo tenemos hoy? |
|---|---|---|---|
| **Capacidad** | Cuánto **aguanta** el camión: 1.5 a 6 toneladas | El **VIN que reporta Samsara** → modelo exacto → ficha de Isuzu México | ✅ Sí |
| **Peso del pedido** | Cuánto **pesa** lo que se va a entregar | **SAP**, sumando línea por línea | ❌ No llega |

**Samsara no sabe qué lleva el camión.** Samsara es GPS: dónde está, a qué
velocidad va, cuándo se detuvo y por cuánto tiempo. No tiene forma de saber si
la caja va llena de queso o vacía.

### Cómo se calcularía el peso del pedido

SAP guarda un peso por artículo, en la ficha del artículo (`OITM.SWeight1`). La
consulta que ya está escrita multiplica, por cada línea del pedido, la cantidad
por ese peso:

```
Pedido #8500123
  3 × Cheddar bola 1 kg    ->  3 × 1.0 kg  =  3.0 kg
  2 × Jamón pierna 4 kg    ->  2 × 4.0 kg  =  8.0 kg
                              ─────────────────────
                              Peso del pedido: 11 kg
```

**El requisito es que alguien haya capturado el peso en la ficha de cada
artículo en SAP.** Si un artículo tiene el peso vacío, cuenta como 0 y el pedido
sale más ligero de lo que es. Se prefiere quedarse corto a inventar un número:
un peso inventado que parece real es peor que un peso incompleto que se sabe
incompleto.

### Qué pasa mientras tanto

Cuando SAP no manda el peso, el optimizador usa `PESO_ESTIMADO_KG = 150` para
cada pedido. Eso significa que **hoy la restricción de kilos no es confiable**:
el sistema no puede garantizar que un camión no salga sobrecargado.

Por eso el tope que de verdad manda hoy es el **número de paradas**, que sí está
medido con GPS real por camión. Es una restricción honesta: sabemos que el 013
nunca ha hecho más de 19 entregas en un día, así que no se le planean 25.

**Para validar cuando llegue el peso real:** si un camión de 3.5 ton hace 18
paradas y sale lleno, el promedio por pedido rondaría los 195 kg. Si un ELF 100
de 1.5 ton hace 12 paradas, ~125 kg. El estimado de 150 cae en medio, pero
**no está medido** — hay que confirmarlo contra datos reales.

---

## 2. Las horas: ETA y ventana de recibo

### Qué es la ETA

La hora a la que el camión **toca la puerta** del cliente. Decisión tomada el
21-jul: no es la hora en que termina de descargar, es la hora de llegada, que es
lo que espera quien lee una ETA.

### Por qué importaba el "valor por defecto"

En programación, un campo puede tener un **valor por defecto**: lo que se usa si
nadie lo llena. El sistema tenía dos defaults que eran mentiras:

```
window = "09:00 - 12:00"     <- para TODOS los clientes
eta    = "09:30 AM"          <- para TODOS los pedidos
```

El de la ventana **nunca lo llenaba nadie**, así que todos los pedidos salían de
la API diciendo que el cliente recibe de 9 a 12. No se veía en pantalla porque
el panel no lo leía — pero el día que alguien pusiera esa columna en la tabla,
iban a aparecer 195 clientes con el mismo horario y se iba a ver perfectamente
real.

**La regla que se sigue ahora: un valor por defecto nunca debe parecerse a un
dato real.** Si no sabemos algo, tiene que decir que no lo sabemos. Por eso la
ETA ahora dice "Pendiente" en vez de "09:30 AM", y el campo de la ventana se
eliminó por completo.

### La ventana de recibo real sí existe

Y es distinta por cliente, exactamente como debe ser. Los 195 destinos la tienen
capturada, en `Destino.ini_recibo_1` / `fin_recibo_1`:

| Cierra a las | Destinos |
|---|---:|
| Antes de las 11:00 | 5 |
| 12:00 – 12:59 | 57 |
| 13:00 – 13:59 | 40 |
| 14:00 – 15:59 | 25 |
| 16:00 o después | 63 |

**97 de 195 cierran antes de las 14:00.** Como los camiones salen ~10:16, quedan
menos de 4 horas para atender a la mitad de los clientes. Esa es la razón de
fondo por la que las rutas van apretadas, y por la que salir más temprano ayuda
mucho más que alargar el turno.

El optimizador **sí respeta cada ventana individual** — es una restricción dura
del modelo, no un promedio. También maneja:

- **Segunda ventana** (cierra a mediodía y reabre en la tarde).
- **Cierre a medianoche** ("00:00" se entiende como fin del día, no inicio).
- **Datos corruptos**: si la hora de fin es igual o anterior a la de inicio
  (ej. "08:00-06:00", al que le falta el PM), se descarta esa ventana y se usa
  el turno completo, en vez de bloquear al cliente con una ventana imposible.

---

## 3. Los días de entrega: aquí hay un hueco

`Destino` guarda seis campos —`ent_lun` a `ent_sab`— que dicen qué días recibe
cada cliente. Se llenan desde SAP y desde el Excel.

**Pero el optimizador nunca los lee.** Están en el modelo, en las migraciones,
en el importador y en la sincronización, y en ningún lado del cálculo de rutas.

En los datos actuales, **68 de 195 destinos tienen algún día restringido** — casi
todos son "no reciben sábado". Hoy el sistema les planea entregas en sábado sin
avisar.

Y hay un segundo hueco, este de datos y no de código: los **52 destinos de Pizza
DePrizza** (`card_code` que empieza con `C587`) en la práctica **solo se surten
martes y jueves**, pero en el sistema aparecen recibiendo los seis días. Ningún
destino de los 195 está marcado como "solo martes y jueves".

Son dos arreglos distintos y hacen falta los dos:

1. **Código:** que el optimizador descarte los destinos que no reciben ese día.
2. **Datos:** que SAP refleje la regla real de Pizza DePrizza.

---

## 4. Por qué no se geocodifican direcciones

Para poner un cliente en el mapa y calcular cuánto tarda el camión en llegar se
necesita una **coordenada** (`25.6453, -100.3612`). Un texto como "AV. GÓMEZ
MORÍN 123" no le sirve a ninguna computadora: no se pueden medir distancias con
palabras.

Convertir el texto en coordenada se llama **geocodificar**, y no se puede hacer
solo: hay que preguntarle a alguien que tenga el mapa del mundo entero (Google,
OpenStreetMap). Y para preguntarle, hay que **mandarle la dirección del cliente
por internet a esa empresa**.

En la práctica eso es entregarle a un tercero la lista de clientes de Laben y
dónde están, que es información comercial de la empresa. Esos servicios además
guardan registro de lo que se les pregunta.

**La decisión:** no se hace. Si SAP no trae la coordenada, el pedido se queda sin
coordenada y el panel lo marca en rojo como "Sin georreferencia en SAP B1", para
que alguien llene `U_Latitud` y `U_Longitud` en SAP. Mejor que se vea el hueco a
taparlo mandando datos afuera sin que nadie se entere.

**Hoy no afecta nada:** los 195 destinos ya tienen coordenada.

---

## 5. Secretos: qué está expuesto y qué no

### El token de Samsara — SEGURO ✅

Vive **solo** en `backend/.env`, que es un archivo local de cada computadora.
Ese archivo está en `.gitignore`, así que git lo ignora por completo.

Verificado a fondo: el archivo **nunca** estuvo rastreado por git en ningún
momento de la historia del proyecto, y el valor del token **no aparece en ningún
commit**. Lo que sí está en GitHub es `backend/.env.example`, que es la
plantilla, y ahí el campo está **vacío**.

Es un token de **solo lectura** y el código nunca hace más que consultar.

### La SECRET_KEY de Django — EXPUESTA 🔴

Esta sí es un problema y es distinta del token.

`SECRET_KEY` es la llave con la que Django **firma las sesiones**: cuando alguien
inicia sesión, Django le da al navegador una galleta firmada con esa llave, y
confía en ella porque solo el servidor la conoce. Es como el sello de una
empresa.

El problema: está **escrita directamente** en `backend/core/settings.py` línea
23, y ese archivo **sí se sube a GitHub**. Cualquiera que vea el repositorio la
tiene.

Con la llave, alguien podría fabricar una sesión firmada y hacerse pasar por un
usuario del sistema.

**No basta con moverla al `.env`.** Como ya es pública, hay que **generar una
nueva** y esa nueva ponerla en el `.env`. Mientras el sistema solo corra en la
red interna el riesgo es bajo, pero antes de exponerlo a internet es
obligatorio.

---

## 6. Por qué las rutas se ven en líneas rectas

Son **dos problemas distintos** que se ven igual, y los dos vienen de OSRM.

Recordatorio de quién hace qué: **OSRM** es el que sabe ir de un punto a otro por
calle. **OR-Tools** decide el orden de las paradas. **Samsara** dice dónde está
el camión. **SAP** da los pedidos.

### Problema A — el dibujo del mapa

El panel le pide a OSRM que le dibuje el camino real por calle, en
`http://localhost:5001`. Si ese servidor no contesta, el mapa **une las paradas
con una línea recta** en vez de fallar.

En la computadora personal ese servidor **no está corriendo**, por eso se ven
rectas. En la del trabajo, donde OSRM sí corre en Docker, se ven por calle.

### Problema B — el más serio: el orden de las paradas

Este no es cosmético. El backend también usa OSRM para saber cuánto tarda de un
punto a otro, y **el servidor público de demostración acepta máximo 100
paradas**. Con más, contesta con un error y el sistema cae a medir **en línea
recta**.

El problema es que el error de la línea recta **no es parejo**:

| Destino | En recta | Por calle | Error |
|---|---:|---:|---:|
| Escobedo | 19.4 km | 31.5 km | −38% |
| Santa Catarina | 3.1 km | 4.7 km | −34% |
| Apodaca | 31.0 km | 40.3 km | −23% |
| Centro MTY | 16.8 km | 19.7 km | −15% |

En línea recta, Escobedo **parece más cerca** que Guadalupe (19.4 vs 24.6 km),
cuando por calle es **más lejos** (31.5 vs 30.0). Lo que se distorsiona no es la
distancia: es **qué paradas parecen cercanas entre sí** — o sea, el orden de la
ruta, que es justo lo único que el optimizador tiene que decidir.

Y lo peor: **el día más cargado, justo cuando más se ocupa el optimizador, es el
día que cruza las 100 paradas y se cae a línea recta.**

Por eso el mensaje al despachador ahora avisa explícitamente cuando pasó, en vez
de entregar rutas de aspecto normal calculadas mal.

**Con el OSRM propio corriendo, los dos problemas desaparecen**: el contenedor
está configurado con `--max-table-size 10000`, así que se acaba el límite de 100.

### Y aparte, un tercer tema: OSRM va optimista

Aun funcionando bien, OSRM cree que la flota va a **52.9 km/h** cuando el GPS
mide **42.3 km/h** reales. Es ~25% optimista, porque usa límites de velocidad en
flujo libre: un coche vacío sin tráfico, no un ISUZU cargado en Monterrey.

Consecuencia: el plan mete ~18 paradas donde caben ~15. **Se ve en los datos
guardados**: las rutas del 19-jul quedaron en 23, 23, 20, 18 y 17 paradas contra
las 15.5 reales medidas. Ver [`calibracion-tiempos-osrm.md`](calibracion-tiempos-osrm.md).

---

## 7. Qué mapa se está usando

El mapa del panel usa **tres servicios externos distintos**, y conviene saber
cuál hace qué:

| Para qué | Quién | Dónde se configura |
|---|---|---|
| **El dibujo del mapa** (calles, nombres, colores) | **CARTO**, estilo "Voyager", sobre datos de OpenStreetMap | `DispatcherPanel.jsx`, el `TileLayer` |
| **La línea de la ruta** por calle | **OSRM** — el propio en `localhost:5001`, o el público si aquel no responde | `VITE_OSRM_BASE` |
| **Los iconitos de los pines** | Imágenes de Leaflet servidas desde **cdnjs.cloudflare.com** | `L.Icon.Default.mergeOptions` |

Los tres son gratuitos y no requieren cuenta. Dos apuntes:

- **El mapa base de CARTO se pide desde el navegador del despachador**, así que
  necesita internet aunque todo lo demás corra en la red interna.
- **Los iconos vienen de un CDN externo**: si algún día se bloquea, los pines
  dejan de verse. Conviene traerlos al proyecto.
