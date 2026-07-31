# Bitácora: reestructura del proyecto

Todo lo que se hizo en esta etapa, por qué se hizo y qué quedó pendiente.

**Fechas:** 25 y 26 de julio de 2026
**38 commits · 49 archivos · +7,286 / −1,509 líneas**
**Fusionado a `main`.**

---

## En una página

Se entró a limpiar carpetas y se terminó reescribiendo las tres pantallas y
construyendo la que faltaba. En el camino salieron **once errores reales**, no
cosméticos: el sistema estaba dando respuestas equivocadas con toda seguridad.

Lo más importante que cambió de fondo:

1. **El camión dejó de ser una posición en una lista** y pasó a ser su placa.
2. **Una parada es un LUGAR**, no un registro de SAP.
3. **Alguien confirma las entregas.** Antes "Entregado" significaba "la oficina
   cerró la ruta".
4. **Se midió qué tan optimista es OSRM** contra el GPS real: factor ~1.3.
5. **La hora de salida no es 09:00.** Va de 07:03 a 13:49 según el día.

---

## Los errores que se encontraron

Ninguno de estos se estaba buscando. Todos salieron al revisar otra cosa.

### 1. El plan usaba la capacidad del camión equivocado 🔴

El panel mandaba solo **cuántos** camiones estaban activos y el backend tomaba
los primeros N de una lista fija. Apagar el 027 y prender el 024 dejaba el plan
corriendo con la capacidad y el tope de paradas **del 027**. Sin avisar.

*Origen:* una mudanza a medias. El 5-jul se agregó OR-Tools cuando no había
camiones reales y `T-001` solo quería decir "vehículo 1". El 17-jul llegaron los
ISUZU con placa… pero solo al frontend.

### 2. El historial de Postgres era ilegible 🔴

Las rutas se guardaban como `T-001`, y a qué unidad correspondía dependía de
cuáles estaban prendidos en el navegador ese día.

### 3. La misma puerta contaba como varias paradas 🔴

El optimizador agrupaba por Ship-To de SAP. Pero SAP manda varios Ship-To en el
mismo punto: dos códigos que facturan aparte y entregan en la misma puerta,
cuatro razones sociales en un mismo domicilio, y duplicados de captura.

**Medido:** 120 documentos = **105 lugares reales**. El plan inventaba
**180 minutos de descarga** que en la calle no existen.

### 4. Nadie confirmaba las entregas 🔴

Cerrar la ruta hacía `remisiones.update(estado='Entregado')` sobre **todas de
golpe**. El dato no significaba "se entregó".

### 5. La revisión de peso usaba 3,000 kg para toda la flota 🔴

Al 013 (1,500 kg) le decía que sí cabía yendo sobrecargado; al 027 (6,000 kg)
que no cabía con medio camión libre.

### 6. El sugeridor solo miraba una posición 🔴

Evaluaba la inserción más barata y revisaba si esa caía en ventana. Para un
cliente que abre a las 15:00 eso siempre cae a media mañana. *Medido con Mangioz:
antes sugería llegada 10:47; ahora 14:23, al final de la ruta.*

Y la hora estimada **solo sumaba el manejo**, saltándose los 12 min de descarga
de cada parada previa: con 10 paradas antes, **dos horas de error**.

### 7. Se podía apagar un camión que ya iba en la calle 🔴

Sus entregas desaparecían del panel mientras el chofer las seguía haciendo.

### 8. El panel daba un consejo falso 🟡

Decía, escrito fijo: *"cada hora que salgan más temprano caben ~5 pedidos más"*.
Al medirlo con los datos de hoy: **salir a las 08:00 quita 2 pedidos**. Los
clientes no solo cierran temprano — también **abren** a las 8 o 9.

### 9. El mapa se re-encuadraba solo cada 20 segundos 🟡

El encuadre dependía de la posición del GPS. Si alguien había acercado o
arrastrado, se le brincaba de vuelta a media consulta.

### 10. Los controles del mapa quedaban debajo de las rutas 🟡

Estaban en z-index 400 y Leaflet dibuja sus capas hasta 700. Se perdían justo
cuando el mapa tenía trazos encima, que es cuando se ocupan.

### 11. El mapa se robaba la rueda del ratón 🟡

Con la página recorrible, pasar el cursor sobre el mapa dejaba al usuario
clavado.

---

## Qué se construyó

### Panel del despachador

De **1,173 líneas en un archivo** a un orquestador más ocho componentes.

| Antes | Ahora |
|---|---|
| Aplicación clavada a la pantalla | Página que se recorre |
| El mapa se comía dos tercios | Mapa a la izquierda, flotante, con pantalla completa |
| `ESTADO: BORRADOR` con dos botones apagados | El camino completo y **una** acción con su explicación |
| La ventana de recibo no se veía en ningún lado | En la tabla, en cada parada y en el manifiesto |
| El manifiesto no decía cuánto peso lleva | Barra contra la capacidad de esa unidad |
| Las rutas en recta se veían iguales a las reales | Aviso explícito en el mapa |
| Recomendación fija escrita en el código | **Se calcula** con los pedidos de hoy |
| 10 `alert()` del navegador | Avisos propios que no bloquean |

**"¿Qué hago para que quepan todos?"** — corre el optimizador cambiando **una
cosa a la vez** (salir antes, más turno, otro camión) y reporta cuántos pedidos
entrarían en cada caso. Las corridas se simulan dentro de una transacción que se
revierte: el plan que se está viendo no se toca.

### Panel de vendedor

Eran 79 líneas con cuatro pedidos inventados a mano. Se rehizo completo.

- Cada vendedora ve **solo sus pedidos**, filtrados por su `SlpCode` de SAP.
- **La hora es un rango** ("llega entre 09:00 y 09:15"), no una hora exacta.
- Cada pedido **explica su situación** en lenguaje de vendedora.
- **Cuántas paradas faltan antes de la suya**: *"Van 8 paradas antes. El camión
  ya hizo 3, faltan 5."* Es la pregunta real cuando el cliente llama — no "¿a qué
  hora?" sino "¿ya mero?" — y se contesta con un hecho, no con una estimación.
- Mapa con sus clientes por camión y el camión en vivo.
- Cuando una entrega sale incompleta, ve **qué faltó exactamente y por qué**.

### App del chofer — nueva

La pieza que faltaba. **Para celular primero.**

- Sus paradas en orden, con **los productos de cada pedido** (líneas de RDR1).
- **"Entregué todo" es un solo toque** — es el 90% de las paradas.
- Entrega incompleta: se ajusta **renglón por renglón en piezas enteras**, con
  motivo de catálogo y nota libre. No deja confirmar sin motivo.
- **Foto de evidencia**, que sube aparte de la confirmación: si falla la señal,
  la entrega ya quedó registrada.
- Llamar al cliente y abrir la navegación con un toque.
- **No puede reportar entregas antes de que el camión salga del CEDIS.**

**El estado se deduce de las cantidades**, no lo manda el celular: así no puede
existir un pedido "completo" con renglones a medias.

---

## Las mediciones

### OSRM es ~30% optimista

| | |
|---|---:|
| OSRM implica | **53.7 km/h** |
| Real (45,825 lecturas de GPS, 7 días, 4 camiones) | **42.7 km/h** |
| Velocidad efectiva (km ÷ h manejando) | **~40 km/h** |
| **Factor** | **~1.3** |

Queda el comando `python manage.py medir_velocidad_real 7` para repetirlo.

### La hora de salida no es 09:00

| Día | Primera salida |
|---|---:|
| 22-jul | **13:49** |
| 23-jul | 09:25 |
| 24-jul | **07:11** |
| 25-jul | **07:03** |

De 07:03 a 13:49. Y dentro de un mismo día, el primero salió 09:25 y el último
**11:57**.

---

## Lo que sigue, por prioridad

Todo el detalle está en [`pendientes.md`](pendientes.md).

### 1. Aplicar el factor 1.3 🔴

Un solo lugar, `routing_service.build_distance_time_matrices`, y son **dos**
cambios:

```python
FACTOR_TRAFICO_REAL = 1.3
time_matrix_min = [[round(d * FACTOR_TRAFICO_REAL / 60) for d in row] for row in durations_s]
```

El `round` importa tanto como el factor: `int()` truncaba hacia abajo y regalaba
hasta 59 segundos por tramo.

**Cómo saber que quedó:** el plan debe dar **15-18 paradas por camión**, no 25-27.

### 2. Prender el OSRM propio 🔴

El `.pbf` está descargado pero **nunca se procesó**. Hoy todo corre contra el
servidor público, que **acepta máximo 100 paradas**: el día más cargado es justo
el que se cae a línea recta.

Y **que el contenedor corra no basta**: `OSRM_BASE` tiene que estar sin comentar
en `backend/.env`. Se comprueba leyendo el mensaje del optimizador.

**Al prenderlo hay que re-medir el factor**, porque otro perfil da otros tiempos.

### 3. La hora real de salida 🔴

Las ETAs ya se corrigen al dar Salida, pero **las ventanas de recibo se evalúan
contra las 09:00 teóricas**: el optimizador acepta o rechaza pedidos por una
razón equivocada.

### 4. Seguridad, antes de que alguien más lo use 🔴

- `SECRET_KEY` está en GitHub → **generar una nueva**
- `DEBUG = True`, CORS abierto, `ALLOWED_HOSTS = []`
- **Cero autenticación** en los endpoints
- El código de vendedora viaja en la URL: cualquiera vería los de otra

### 5. Pruebas del optimizador 🔴

`tests.py` sigue siendo la plantilla vacía. Las ~15 que harían falta están
listadas en `pendientes.md` §5 — **cada una por un error que ya se cometió**.

### 6. Datos que faltan de SAP 🟡

- **Peso real por pedido**: hoy corre con 150 kg inventados
- Cuatro horarios mal capturados (les falta el PM)
- Los UDF de contacto y teléfono no existen en `CRD1`

### 7. Choferes 🟡

Quién maneja qué sigue sin ser un dato del sistema. Antes de construir la tabla
hay que responder: ¿cada chofer trae siempre la misma unidad o rotan? ¿se quiere
historial?

---

## Cómo revisar lo que se hizo

```bash
git log --oneline main~38..main    # los 38 commits
git show <commit>                  # el detalle de uno
```

Cada commit explica **por qué** se hizo el cambio, no solo qué cambió. Varios
traen la medición que lo justifica.

---

# 31 de julio de 2026 — Cacería de bugs, pruebas y firma de entrega

Revisión completa del código con la pregunta "¿esto está listo para lanzarse?".
No lo estaba: había tres módulos que **nunca se habían ejecutado** desde que se
partieron los archivos grandes, y dos rutinas que borraban datos en silencio.

## Lo que estaba roto y nadie lo sabía

Al partir `api.py` (960 líneas) y `optimizer.py` (859) en módulos, el bloque de
imports se copió completo a unos archivos y se olvidó en otros. Resultado: tres
`NameError` esperando a que alguien pasara por ahí.

| Dónde | Qué pasaba |
|---|---|
| `api/ventas.py` | Una COPIA de `_rango_eta` sin sus imports le ganaba a la importada. **El panel de ventas devolvía 500 siempre.** |
| `api/chofer.py` | `api.create_response` con `api` sin importar. El chofer que abría su celular antes de que existiera el plan veía un 500 en vez de "no tienes ruta". |
| `optimizer/solver.py` | `_SoloSimulacion` sin importar: el botón "¿qué hago para que quepan todos?" reventaba. |

Ninguno es un error sutil de lógica. Son módulos que no se ejecutaron nunca.
**Por eso lo primero que se hizo después de arreglarlos fue escribir las
pruebas**: cualquiera de ellas los caza en medio segundo.

## Lo que borraba datos

- **`sync.py` guardaba `DocDueDate` filtrando por `DocDate`.** Hoy funciona de
  casualidad porque SAP copia una fecha en la otra al crear el documento. El
  día que un capturista toque el vencimiento a mano, ese pedido se pide con una
  fecha y se guarda con otra: desaparece del panel, y la limpieza de sobrantes
  —que filtra por `doc_date`— podría borrar pedidos buenos de otro día.
- **Cada sync borraba la segunda ventana de recibo y los datos de contacto.**
  La primera ventana tenía guardia (`if has_window_udf`), la segunda no: como
  `getattr(row, "UdfIni2", None)` devuelve `None` cuando la columna no vino en
  el SELECT, se sobreescribía con `None` lo que ya estuviera cargado. Contra la
  base productiva —que no tiene esos UDF— eso borraba los horarios en cada
  corrida, cada 45 segundos, sin dejar rastro.

## Lo que planeaba mal

- **La ventana de recibo se aplicaba a la hora de SALIDA de la parada, no a la
  de llegada.** El acumulado de la dimensión Time trae la descarga sumada, así
  que la ventana quedaba corrida 12 minutos: a un cliente que cierra a las
  13:00 se le rechazaba una llegada a las 12:55, y a uno que abre a las 15:00
  se le aceptaba una llegada a las 14:48. El código ya reconocía el desfase al
  calcular la ETA, pero no al poner la restricción.
- **La sugerencia de "en qué camión lo meto" calculaba mal la hora de
  llegada** (sumaba el tramo a la parada siguiente en vez del tramo al cliente
  nuevo) y **la duración de la ruta no contaba el tiempo de descarga**: una
  ruta de 18 paradas se reportaba en 200 min cuando iba en 416, o sea ya fuera
  del turno, y el panel decía que todavía cabían dos horas más de pedidos.
- **Los pedidos que no cupieron conservaban su ETA vieja.** Quedaban sin camión
  pero ventas les seguía prometiendo al cliente una hora de llegada.

## Lo que se rompía en producción, no aquí

- Faltaba **Pillow** en `requirements.txt` (`ImageField` lo exige): el proyecto
  solo arrancaba en máquinas que ya lo tuvieran instalado por otro lado.
- `datetime.now()` en vez de `timezone.localtime()` en dos lugares: en un
  hosting en UTC, la salida de las 09:00 se guarda como 15:00 y de ahí salen
  mal todas las ETAs recalculadas.
- `MEDIA_URL` sin diagonal inicial: las fotos de evidencia daban 404.
- `settings.py` abría una conexión a Postgres al **importarse**, lo que rompía
  `collectstatic`, los tests y el CI, y abría una conexión de más por worker.
  Se movió a `apps.py:ready()`, que es cuando de verdad importa.

## Las pruebas

88, en `delivery/tests/`, verdes en 35 s sin Postgres ni SAP ni OSRM. Cada una
existe por un bug que ya se cometió, no por cubrir líneas.

**Se verificó que sirven**: se volvieron a meter cuatro de los bugs arreglados
y las pruebas los cazaron. Una prueba que pasa con el código roto no es una
prueba, y esa comprobación es la única forma de saberlo.

El límite de tiempo del solver quedó configurable (`OPTIMIZER_SEGUNDOS`) para
que la suite no tarde un minuto en dar el mismo veredicto. Bajarlo da rutas
peores, no rutas equivocadas.

## Lo nuevo: firma de quien recibe

La app del chofer abre un recuadro donde el cliente firma con el dedo. Se
guarda como PNG en `Remision.firma` y la ven el chofer y el panel de ventas.

Es distinta del nombre escrito que ya se capturaba: ese lo teclea el chofer y
puede poner cualquier cosa; la firma la traza quien recibe, delante de él. Va
en una petición aparte de la confirmación, igual que la foto, para que una
falla de señal no tire el reporte de la entrega.

## La ETA ahora es un rango de verdad

Era "de 09:00 a 09:15" —solo hacia adelante—, que se lee como "no llega antes
de las 09:00". Es falso: el camión llega antes o después. Ahora es ±15 min
("entre 08:45 y 09:15") en las tres pantallas.

De paso se quitó la palabra `"Pendiente"` que viajaba en el campo `eta` como si
fuera una hora: salía impresa en la guía del almacén, en el popup del mapa y en
la tarjeta del camión. Ahora ese campo es `null` cuando no hay ETA, que es lo
que es.

## El Excel

Se eliminó del repositorio junto con su comando de importación: ya no se usa y
la fuente de verdad es SAP. Tener dos fuentes era justo lo que hacía que un
sync borrara lo cargado por el otro lado.

**Sigue en el historial de git.** Si el repo se hace público, hay que limpiarlo
con `git filter-repo` — borrarlo de la rama no lo saca de los commits viejos.

## Lo que NO se hizo

- **Autenticación.** Sigue sin existir: 25 endpoints abiertos y un login que es
  un selector de rol. Es el bloqueador #1 y no se tocó hoy.
- **El refactor de `Dispatcher/index.jsx`** a hooks. Los bugs de carrera del
  archivo se arreglaron uno por uno (token de corrida contra respuestas viejas,
  candado en las sugerencias, errores del backend que se tomaban por éxito),
  pero las 880 líneas y los 40 `useState` siguen ahí. Hay un plan de 8 pasos.
  Hacerlo hoy, sin una sola prueba de frontend, habría sido cambiar bugs
  conocidos por bugs nuevos.
- **`DocDate` vs `DocDueDate`**: el código ya es consistente, pero falta
  confirmar contra SAP que las dos columnas traen lo mismo:
  `SELECT TOP 20 DocNum, DocDate, DocDueDate FROM ODLN ORDER BY DocEntry DESC`.
