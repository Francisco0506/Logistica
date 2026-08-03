# 1 y 2 de agosto de 2026 — Auditoría, refactor y red de seguridad

Lo que se hizo en esta etapa, por qué, y cómo se comprobó.

**205 pruebas** (129 backend + 76 frontend), contra 88 y 0 al empezar.

---

## En una página

Se entró a levantar el proyecto para verlo funcionando y se terminó auditando
todo el código con agentes, arreglando bugs de pérdida de datos, montando la
primera red de pruebas del frontend y partiendo los dos archivos que nadie
quería tocar.

Lo más importante que cambió de fondo:

1. **El frontend dejó de tener cero pruebas.** Ahora son 76, cada una por un bug
   que ya pasó en este repo.
2. **Los tres estados finales de una entrega tienen UNA sola casa.** Estaban
   copiados en cinco archivos y el mismo bug se arregló dos veces sin que nadie
   notara las otras copias.
3. **El backend dice sus reglas; el frontend ya no las transcribe.** `GET /api/config`.
4. **El panel del despachador pasó de 952 líneas y 40 `useState` a 556 y 13**,
   con **cero `useEffect`**: no le queda ni un efecto ni una petición de red.
5. **El optimizador dejó de depender de la capa HTTP.**

---

## Los bugs que se encontraron

Ninguno se estaba buscando. Todos salieron auditando otra cosa.

### 🔴 El panel prometía un reparto en DOMINGO

Se vio **en vivo**, al abrir el panel un sábado por la tarde:

> "Preparando MAÑANA 02-Aug"

El 2 de agosto era domingo, el único día en que no sale ningún camión.

La causa es fina y vale la pena: `comun.py` ya tenía `fecha_reparto_de()`, que
existe **precisamente** para saltarse el domingo, y su propio docstring decía
*"tenerlo en dos lados sería tener dos calendarios"*. Pues había dos calendarios:
`dispatcher.py` sumaba `+1 día` a mano en vez de llamarlo.

Se escapó porque la prueba que existía solo verificaba que el endpoint
contestara 200.

**Comprobado:** se volvió a meter el bug y la prueba lo cazó
(`'2026-08-02' != '2026-08-03'`).

### 🔴 El candado del CEDIS existía solo en el navegador

La bitácora decía: *"No puede reportar entregas antes de que el camión salga del
CEDIS."* Era cierto… en el frontend:

```js
const puedeEntregar = ruta?.estado === 'En_Ruta';   // Driver/index.jsx
```

En el backend, `confirmar_entrega` busca la remisión por id y **no revisa el
estado de la ruta ni una vez**. En una API sin autenticación, un POST directo
confirma la entrega de cualquier parada aunque el camión siga en el almacén.

Importa doble: es lo único que hoy impide el bug siguiente.

### 🔴 El sync podía borrar entregas confirmadas, con foto y firma

La limpieza de sobrantes tiene candado por estado de la **ruta**, pero ninguno
por estado de la **remisión**. Y el detalle que lo hace más fino: **una remisión
con `ruta=NULL` no la excluye ese filtro** —el join no encuentra nada— y
`ruta=NULL` es justo lo que deja `on_delete=SET_NULL` al borrar las rutas
Borrador en cada re-optimización.

Se perdería la única prueba de que la mercancía se entregó, y el mensaje solo
diría "Se quitaron 1 que ya no están en SAP".

### 🔴 Pedidos sin coordenadas quedaban invisibles

El solver limpia explícitamente dos de los tres grupos que quedan fuera del plan
(`no_asignadas`, `dia_cerrado`), cada uno con su comentario. **`sin_geo` se lee
solo para el mensaje y nunca se limpia.**

Se llega ahí porque `asignar_manualmente` no bloquea un pedido sin coordenadas:
`sugerir` devuelve `{"error"}`, `opciones` sale vacío, `opcion` queda `None`, y
el guardia `if opcion and not opcion["factible"]` **no dispara**.

Resultado: queda `Asignado` con `ruta=NULL`, conservando secuencia y ETA viejas.
No sale en ninguna ruta, **no sale en `/alertas`** (que filtra `Pendiente`), y
ninguna corrida futura lo levanta.

### 🔴 Al dar "Salida", la ETA ignoraba la ventana de recibo

`recalcular_etas_desde_salida` suma solo manejo + descarga. El solver **sí**
respeta la ventana —y es *por* la ventana que manda a un cliente tardío al final
de la ruta—. Al recalcular se pierde esa espera.

Con el cliente que el propio código cita (Mangioz, recibe 15:00-22:00): el
optimizador lo deja de última parada con ETA 15:10. Salida a las 09:10 → la ETA
se reescribe a **12:40**, y ventas le promete al cliente "llega entre 12:25 y
12:55". El camión llega a esa hora y espera dos horas y media en la puerta.

### 🔴 El chofer veía "no se pudo guardar" cuando SÍ se guardó

El refetch de la ruta estaba **dentro del mismo `try`** que la confirmación. Con
mala señal el POST pasaba, el GET tronaba, y el chofer veía el toast rojo con la
parada todavía pendiente: **iba a reportar la entrega otra vez**.

### 🔴 Si SAP se colgaba, el despachador se quedaba sin panel

Estaba encadenado: `await syncSAP(...)` y hasta después los pedidos, las rutas y
las alertas. Datos que **ya están en Postgres** y no dependen de SAP para nada.
Encima el ciclo de 45 s acumulaba otra petición colgada cada minuto — y SAP no
tenía timeout de consulta, solo de login.

### 🔴 Ventas veía un pedido caído como "SIN PROGRAMAR"

`ESTILOS` solo tenía cuatro estados y caía a `|| ESTILOS.Pendiente`. El chofer
marca "Estaba cerrado" → la vendedora ve la pastilla gris **"SIN PROGRAMAR"**,
que significa lo contrario. Si abre la tarjeta, adentro dice "no se pudo
entregar a las 11:20". Dos cosas contrarias, y la falsa es la que se lee de
reojo en la lista de 80.

Y **"Lo próximo en llegar"** filtraba solo contra `Entregado`, así que seguía
anunciando la ETA de un cliente donde el camión ya había pasado sin entregar.

### 🟡 Los demás

- **Placa duplicada**: agregar un camión con una placa que ya existe partía el
  panel en dos — dos tarjetas con la misma llave de React, apagar una movía las
  DOS, el conteo decía 12 con 11, y el manifiesto se imprimía dos veces.
- **Un fallo del optimizador borraba el mapa.** `setRoutesGenerated(false)` al
  arrancar y solo se volvía a prender en el camino feliz: el plan seguía intacto
  en la base pero el despachador veía el mapa vacío y creía haberlo perdido.
- **El trazo de OSRM podía pintar el plan viejo** encima del nuevo: era el único
  efecto de red del panel sin cancelación ni token de corrida, aunque hace hasta
  11 peticiones de un jalón.
- **Con turno de 8 h, todas las tarjetas en ámbar** avisando de un problema
  inexistente, porque el umbral era un 6 clavado.
- **El filtro de camión se quedaba pegado**: el botón decía "Todos los camiones"
  con el filtro aplicado, y si ese día solo había un camión el selector ni se
  dibujaba — no había forma de quitarlo salvo recargar.
- **Samsara daba 500** si el WiFi tenía portal cautivo.

---

## La causa raíz de la mitad

Lo mismo escrito en dos lugares:

| Qué | Copias |
|---|---:|
| Los tres estados finales de una entrega | **5** |
| El candado de rutas despachadas | **4** |
| La máquina de transiciones del despacho | **3** |
| `hoyLocal()` | **3** |
| Los escalones de turno `[6, 6.5, 7, 7.5, 8]` | **3** |
| Los nombres de los días | **3** |
| Los motivos de no-entrega | **2** |

Todo eso ahora tiene **una sola casa**, y `GET /api/config` se la sirve al
frontend con defaults locales para que una caída de red no deje la pantalla en
blanco.

---

## Lo que se construyó

### Pruebas del frontend, de cero a 76

Vitest + Testing Library. Cada prueba existe por un bug que ya pasó:

- **`color.test.js`** (12) — *"con TODA la flota en uso no repite ninguno de sus
  colores"*: el bug de `PALETA[trucks.length % 8]` contra una copia de 8 colores
  mientras la flota creció a 11. Más las cinco de contraste, una por cada color
  que no se leía con texto blanco encima.
- **`fecha.test.js`** (4) — *"a las 11 de la noche del 31 sigue siendo el 31"*:
  `toISOString()` convierte a UTC y en México adelanta el día desde las 6 pm,
  justo dentro del horario de uso.
- **`estadosRuta.test.js`** (16) — contrato con `models.py`. Incluye una que
  verifica que **`esVisitada` y `huboEntrega` NO dan lo mismo**: si dieran lo
  mismo sobraría una, y esa confusión es la que causó todo.
- **`TarjetaCamion.test.jsx`** (10) — una por cada síntoma: `3/3 y no 2/3`,
  "Sigue:" no apunta a un cliente ya reportado, el peso a bordo baja con las
  fallidas.
- **`EstadoDespacho.test.jsx`** (10) — *"un estado nuevo saca su botón aunque no
  tenga texto propio"*. Con la copia local clavada eso no mostraría nada: es la
  prueba de que ya no hay copia.
- **`useFlota.test.js`** (15) y **`HojaEntrega.test.jsx`** (5).

### Se verificó que las pruebas sirven

Se volvieron a meter cinco de los bugs arreglados:

| Bug reintroducido | Pruebas que fallaron |
|---|---:|
| `esVisitada = estado === 'Entregado'` | **8** |
| La copia local de transiciones | **3** |
| Quitar `Cargando`/`Listo` del candado de apagado | **2** |
| Sumar `+1 día` en vez de `fecha_reparto_de` | **9** |
| Renombre de módulo en el mock de SAP | **6** |

Una prueba que pasa con el código roto no es una prueba, y esa comprobación es
la única forma de saberlo.

### El refactor

**Frontend — `Dispatcher/index.jsx`: 952 → 556 líneas, 40 → 13 `useState`, 0 `useEffect`.**

Siete hooks, cada uno con el porqué de sus decisiones al lado:

| Hook | Líneas | Qué guarda |
|---|---:|---|
| `useAsignacionManual` | 121 | meter a mano lo que no cupo |
| `useFlota` | 118 | qué camiones hay y cuáles se pueden apagar |
| `useDatosDelDia` | 117 | pedidos, rutas, alertas + **el candado de corridas** |
| `useOptimizacion` | 117 | armar el plan, escenarios y despachar |
| `useRutasOsrm` | 105 | el trazo por calles (accesorio del mapa) |
| `useJornada` | 67 | qué día se ve, y la traducción carga↔reparto |
| `useCamionesGPS` | 35 | dónde están los camiones ahora |

Dos bugs se arreglaron solos al extraerlos:

- `useRutasOsrm` ahora depende de una **firma** de las paradas, no del arreglo
  `orders` —que cambia de identidad en cada refresco aunque el contenido sea
  idéntico—. Antes se disparaban 11 peticiones a OSRM cada 45 s para dibujar
  exactamente lo mismo.
- `useDatosDelDia` lee la fecha de un `ref`: como `refrescar` se le pasa a otros
  hooks, si capturara la fecha del render en que se creó, un refetch disparado
  tras cambiar de día traería el día viejo.

**Backend — los dos endpoints que no eran "servir HTTP":**

- **`optimizer/escenarios.py`** (137) — el motor de "¿qué hago para que quepan
  todos?" vivía dentro de un handler, aunque es lógica de optimización pura.
- **`calendario.py`** (167) — la regla de negocio más discutida con operación,
  ahora sin depender de HTTP ni de la base. Por eso se le pudieron escribir 15
  pruebas nuevas, **incluida una que barre 14 días × 24 horas** verificando que
  ninguna combinación prometa reparto en domingo.
- **`integrations/sap_conexion.py`** (162) — todo lo que depende de cómo está
  montado el SQL Server del cliente: driver, timeouts, qué UDF existen,
  validación de coordenadas. Cuando algo falle al conectar en la Mac, el
  problema está ahí y no hay que leer 500 líneas de mapeo para descartarlo.

**Y se rompió una dependencia invertida:** `optimizer/modelo.py` importaba de
`api/comun.py`, o sea que **el optimizador dependía de la capa HTTP**. Verificado
ejecutándolo, no de palabra:

```
ninja cargado? False
delivery.api cargado? False
```

### Producción y apagón

El sistema va a vivir las primeras semanas en una **Mac mini/Studio en la
oficina del cliente**, así que se preparó lo que eso implica:

- **`scripts/respaldo.sh`** — no había ninguno. Respalda **primero las fotos y
  firmas**, que es lo único que no se puede recuperar de ninguna otra fuente
  (los pedidos se vuelven a bajar de SAP; la firma que el cliente trazó con el
  dedo, no). Y **verifica el dump** con `pg_restore --list`: un `pg_dump` que
  falló a la mitad deja un archivo con tamaño y sin contenido útil.
- **`scripts/restaurar.sh`** — con confirmación explícita, porque borra la base.
- **`scripts/produccion.md`** — la lista de encendido, cada paso con su
  comprobación. Lo que más preocupa: el `--timeout 30` por default de gunicorn
  **mata al worker a media optimización**; el bloque `/media/*` de Caddy sin el
  cual **cada foto da 404**; y que Docker Desktop **no arranca sin sesión gráfica
  iniciada**, así que tras un apagón la Mac se queda sin Postgres.
- **`.env.example` completo** — le faltaban seis variables, y una es de
  seguridad: `CORS_ORIGINS` es la que cierra CORS en producción y no estaba
  documentada.
- **OSRM con tag fijo** (`v5.27.1` en vez de `latest`) **y healthcheck**: sin él,
  Docker solo reinicia si el proceso muere, y un OSRM colgado sigue "arriba"
  mientras el optimizador se cae a línea recta.

### Lo nuevo: reintentar la evidencia

Si la foto o la firma no subían por señal, salía un aviso y **la evidencia se
perdía sin recurso**. Ahora lo que no subió queda guardado y la parada muestra
una franja ámbar con su botón. Solo reintenta lo que falta.

Se dejó **en memoria a propósito**, no en localStorage: un `File`/`Blob` no se
puede serializar, y guardar la foto para "después" sería una promesa que no se
puede cumplir si el chofer cierra la pestaña.

---

## Limpieza de la base

Había **3 rutas colgadas en `En_Ruta`**, dos del 18-jul con camiones `T-001` y
`T-003` — nomenclatura de **antes de que el camión fuera su placa**, así que ni
siquiera se podía saber a qué unidad se referían.

El candado del sync (`ESTADOS_RUTA_DESPACHADA`) las protege de borrarse solas,
que es correcto, pero también significa que **nunca se iban a limpiar**.

Se borraron con respaldo previo y con un guardia en el código: si hubiera habido
una sola entrega confirmada, aborta. Sus 19 pedidos se resetearon a `Pendiente`
**en la misma transacción** — si no, `on_delete=SET_NULL` los habría dejado
huérfanos invisibles, que es el bug de arriba.

Verificado: `0` rutas fuera de Borrador, `0` huérfanas.

---

## Dos cosas que se probaron y se descartaron

**`autoprefixer` NO sobra.** Se asumió que era un resto del flujo de Tailwind v3.
Se quitó, se compiló, y el CSS **cambió** (59,142 → 59,460 bytes). Sí está
haciendo algo. Se dejó puesto, con la medición anotada en `postcss.config.js`
para que nadie lo vuelva a intentar a ciegas.

**`optimizer/manual.py` no hay que partirlo.** Parece grande (322 líneas) pero
tiene tres funciones con propósito claro. Repartidas así no estorban. Se anota
para que nadie lo "arregle" por el número.

---

## Lo que NO se hizo

Todo el detalle está en [`lo-que-falta.md`](lo-que-falta.md). Lo grueso:

- **Autenticación.** Sigue sin existir: 18 endpoints abiertos y un login que es
  un selector de rol. Es el bloqueador #1 y no se tocó.
- **El `try/except` de `sap.py`**: 393 líneas dentro de un solo `try`, así que un
  bug de Python se reporta como "Falló la conexión con SAP B1". Es lo que más
  urge del refactor, y no por el tamaño.
- **`Driver/index.jsx`** (667 líneas) es ahora el archivo más grande del
  frontend, y es la pieza más delicada.
- **`solver.py`** (388, una sola función). Va al final: un error ahí no truena,
  da rutas peores sin que nadie se entere.
