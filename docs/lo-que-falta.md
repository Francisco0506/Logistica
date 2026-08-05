# Lo que falta por hacer

**Al 2 de agosto de 2026.** Escrito después de la tanda de refactor y cacería de
bugs del 1 y 2 de agosto.

Este documento es la lista de trabajo, ordenada por **qué tan caro sale no
hacerlo**. No es la bitácora —eso está en [`bitacora-reestructura.md`](bitacora-reestructura.md)—
ni el detalle técnico de cada pendiente viejo, que sigue en
[`pendientes.md`](pendientes.md).

Cada punto trae **cómo comprobar que quedó**. Un pendiente sin criterio de
terminado se queda abierto para siempre.

---

## Dónde estamos

| | Antes | Ahora |
|---|---:|---:|
| Pruebas de backend | 88 | **129** |
| Pruebas de frontend | 0 | **76** |
| `Dispatcher/index.jsx` | 952 líneas · 40 `useState` | **556 · 13 · 0 `useEffect`** |
| `api/dispatcher.py` | 562 | **381** |
| `integrations/sap.py` | 516 | **405** |

Lo que **sí** quedó resuelto y no hay que volver a revisar:

- **Cero código muerto.** Auditadas las 51 funciones del backend y los 48
  exports del frontend: todas con uso real.
- **Cero fuentes de verdad duplicadas.** Los estados finales estaban copiados en
  5 archivos, el candado de rutas en 4, las transiciones en 3, los motivos en 2,
  `hoyLocal()` en 3, los escalones de turno en 3, los días en 3. Todo tiene una
  sola casa, y `GET /api/config` se la sirve al frontend.
- **Sin dependencias invertidas.** `delivery.optimizer` ya no arrastra
  django-ninja (verificado ejecutándolo, no de palabra).

---

## 🔴 Bloqueantes — antes de encender en el cliente

### 1. Autenticación

**18 endpoints abiertos y `/api/docs` publicado.** Cualquiera con la URL puede
bajar la cartera de clientes con teléfonos y montos, y **falsificar entregas**.

El login de hoy es un selector de rol: no valida nada. Y el código de vendedora
viaja en la URL, así que una vendedora puede ver los pedidos de otra cambiando
un número.

**Parche para la primera semana** (una tarde, sin tocar código): Cloudflare
Tunnel + Access con login por correo. Ver [`../scripts/produccion.md`](../scripts/produccion.md) §1.

**Arreglo de verdad**: usuarios de Django con roles (despachador, chofer,
vendedora), y que la placa del chofer y el `SlpCode` de la vendedora salgan de
la sesión, no de la URL.

> **Cómo saber que quedó:** `curl` a `/api/dispatcher/remisiones?fecha=…` sin
> sesión debe devolver 401, nunca JSON con pedidos.

### 2. Probar SAP desde una Mac — *antes de comprar el equipo*

En macOS **no existe** el "SQL Server Native Client 11.0", y si el SAP
productivo es SQL Server 2012 el driver 18 puede no conectar. **No hay plan B
por el lado de Python.**

Es lo único de toda la lista que puede tumbar el proyecto entero, y se prueba en
diez minutos:

```bash
brew tap microsoft/mssql-release https://github.com/Microsoft/homebrew-mssql-release
HOMEBREW_ACCEPT_EULA=Y brew install msodbcsql18 mssql-tools18 unixodbc
sqlcmd -S 10.x.x.x,1433 -U usuario -P '...' -d BASE -No -C -Q "SELECT TOP 1 DocNum FROM ODLN"
```

> **Cómo saber que quedó:** devuelve un folio. Si da error de TLS, bajar
> `MinProtocol` en `openssl.cnf` (ver produccion.md §0).

### 3. `OSRM_BASE` está vacío

El backend está planeando contra el **servidor público de OSRM**, que acepta
**máximo 100 paradas**. El día pico pide 133 — o sea que el día que más importa
es justo el que se cae a línea recta.

> **Cómo saber que quedó:** el mensaje del optimizador debe decir "distancias
> reales de calle", nunca "EN LÍNEA RECTA". Se comprueba desconectando el
> internet de la máquina (dejando la LAN) y optimizando.

---

## ✅ El `try/except` de SAP que disfrazaba errores — resuelto el 5-ago

`integrations/sap.py` tenía **393 líneas dentro de un solo `try`**. Cualquier
error de Python en el mapeo salía reportado como *"Falló la conexión con SAP
B1"*, mandando a quien lo leyera a revisar la red y el cable en vez del bug
real.

Se hicieron los dos cambios que pedía este documento:

1. `sync_from_sap` se partió en cuatro funciones: `_traer_de_sap` (conexión +
   las dos consultas) → `_mapear_destinos` → `_mapear_remisiones` →
   `_limpiar_sobrantes`.
2. El `try/except` quedó acotado a la llamada a `_traer_de_sap` — 2 líneas de
   `sync_from_sap`, contra las ~422 de antes. Todo el mapeo corre fuera: un
   bug de Python ahí ya sale con su propio traceback.

Sigue siendo `@transaction.atomic` sobre la función completa, así que la
atomicidad no se rompió al partirla.

**Verificado, no solo dicho:** hay una prueba
(`test_sap.py::UnBugDeMapeoNoEsUnaFallaDeConexion`) que mete un
`AttributeError` real en el mapeo y comprueba que el mensaje NO dice
"conexión". 151 pruebas en verde.

Deuda menor sin tocar (no funcional): la columna calculada de la consulta de
líneas se sigue llamando `AS SWeight1` en el SQL aunque la fórmula ahora
prioriza `IWeight1`. Es solo el alias de una columna del cursor, no un campo
del modelo — vale la pena renombrarla en otro momento para que no confunda.

---

## 🟡 Refactor pendiente

### `Driver/index.jsx` — 667 líneas

**Es ahora el archivo más grande del frontend**, y es la pieza más delicada: se
usa de pie, en la calle, con mala señal, y es la única que le dice al sistema
qué pasó de verdad.

Mismo patrón que funcionó en el despachador: `useRutaChofer` (la ruta + el
refresco de 30 s), `useEvidencia` (foto, firma y los reintentos).

> **Cómo saber que quedó:** `0 useEffect` en el archivo, como quedó el
> despachador. Y las pruebas existentes pasando **sin haberlas tocado**.

### `optimizer/solver.py` — 388 líneas, una sola función

Es el corazón del sistema. Para entender por qué una ruta salió de cierta forma
hay que leer las 388 completas. Se parte por etapas: construir el modelo → poner
restricciones → resolver → guardar.

**Es el de más riesgo de toda la lista**, porque un error aquí no truena: da
rutas peores sin que nadie se entere. Va al final y con las 129 pruebas
corriendo en cada paso.

### `Sales/index.jsx` — 360 líneas

El más chico de los tres. Mismo patrón.

### Lo que **NO** hay que tocar

`optimizer/manual.py` (322 líneas) parece grande pero tiene **tres funciones con
propósito claro**. Repartidas así no estorban. Se anota aquí para que nadie lo
"arregle" por el número.

---

## 🟡 Bugs conocidos, sin arreglar

**Al 5-ago-2026.** De los 8 que salieron de la auditoría del 1-ago, 7 ya se
arreglaron (verificado leyendo el código actual, no de memoria — ver
`git log` del 4/5-ago). Queda uno:

| Dónde | Qué pasa |
|---|---|
| `optimizer/manual.py:126,195` | Las sugerencias de "en qué camión cabe un pedido" miden contra la hora de salida y el turno **por default** (`HORA_CERO` = 09:00, `MINUTOS_TURNO_MAXIMO` = 6h), no contra los de la corrida real. Si se optimizó con salida 07:00 o turno de 8h, el panel puede rechazar como "llegaría después de que cierren" un pedido que en la ruta real sí cabe. La ruta ya guarda `salida_plan` (agregado el 4-ago) con la hora correcta; falta que `sugerir_camiones_para_remision` la use en vez de las constantes. |

Los 7 ya resueltos, para que quede constancia de qué se comprobó y no se
repita el trabajo:

- El candado de "ruta ya despachada" en `manual.py` (`ESTADOS_RUTA_DESPACHADA`,
  incluye `Cargando` y `Listo`).
- Meter un pedido a mano sí recalcula las ETAs de toda la ruta.
- El mapa numera las paradas por `secuencia_ruta`, no por índice del arreglo.
- La guía impresa (`PreviewManifiesto.jsx`) usa esa misma `secuencia_ruta`.
- `MenuSeleccion.jsx` suelta el filtro cuando el valor ya no existe entre las
  opciones, en vez de mostrar "Todos" con el filtro viejo pegado.
- La parada "que sigue" ya no se repite en `Driver/index.jsx`.
- El `useEffect` de `HojaEntrega.jsx` ya no revoca la foto al capturar la
  firma (ni al revés): sigue las dos URLs por `ref`, no por dependencia.

---

## 🟡 Producción en la Mac

Todo el detalle con sus comprobaciones está en
[`../scripts/produccion.md`](../scripts/produccion.md). Lo que hay que recordar:

- **`gunicorn --timeout 180`.** El default son 30 s y el optimizador se toma
  ~20. Con el default, gunicorn **mata al worker a media optimización** y el
  despachador ve un 502. Es un fallo garantizado el primer día.
- **El bloque `/media/*` de Caddy no es opcional.** Con `DEBUG=False` Django
  deja de servir `/media/`. Todo se ve normal… y **cada foto de evidencia da 404
  al abrirla**.
- **Docker Desktop no arranca sin sesión gráfica iniciada.** Si la Mac arranca a
  la pantalla de login tras un apagón, no hay Postgres ni OSRM y no hay sistema.
- **El UPS lleva la Mac *y* el router.** Si se cae el router, el chofer en la
  calle pierde el sistema aunque la Mac siga viva.
- **Probar la restauración del respaldo ANTES de encender**
  (`scripts/restaurar.sh`). Un respaldo que nadie restauró no se sabe si sirve.

---

## ⚪ Datos que faltan de SAP

- **Los días en que cada cliente recibe.** El optimizador ya los respeta y hay
  pruebas que lo demuestran, pero la base productiva no tiene los UDF
  capturados, así que hoy **todos** los destinos se tratan como "recibe
  cualquier día". Ante la duda se deja pasar: es preferible mandar un camión de
  más que dejar a un cliente fuera por un campo que nadie llenó.
- **Pizza DePrizza**: sus 52 destinos en la práctica solo se surten martes y
  jueves. El código ya lo respetaría el día que se capture.
- **Cargar las 136 direcciones que ya están listas.** Sube la cobertura de 43% a
  71% **sin escribir una línea de código** — es el paso que más rinde de toda la
  lista.
- **El 016 (RJ97892)** no reporta un solo punto de GPS en 7 días, pero
  `fleet.py` lo trae con `activo_default: True`. Falta saber si está
  descompuesto, sin GPS, o simplemente no opera.

---

## ⚪ Decisiones que dependen de operación

### La hora de captura vs. el día de reparto

Medido sobre 3,874 entregas: la probabilidad de que una entrega se facture el
mismo día depende de la hora en que almacén la capturó, y el gradiente es limpio:

| Hora de captura | Sale el mismo día |
|---|---:|
| 07h | 100% (59/59) |
| 09h | 86% |
| 11h | 63% |
| 12h | 37% |
| 16h | 16% |

O sea: **lo capturado antes de las 11 alcanza el camión de ESE día.**
`fecha_reparto_de` manda todo del día X al X+1, lo cual está bien para el grueso
(que se captura de 12 a 7 pm) pero **no para las ~365 entregas de la mañana, que
son justo las urgentes**.

**No se tocó el código a propósito.** El dato dice cuándo se FACTURA, no cuándo
sube al camión, y hoy se están tratando como lo mismo. Antes de cambiar nada hay
que confirmarlo contra productiva —estos números salen de un respaldo congelado
al 11-jul— y preguntar en almacén.

### Pedidos parciales

Francisco lo va a explicar en el trabajo. **Sin tocar hasta entonces.**

### Choferes

Quién maneja qué unidad sigue sin ser un dato del sistema: el chofer se teclea a
mano y se pierde al recargar. Antes de construir la tabla hay que responder:
¿cada chofer trae siempre la misma unidad o rotan? ¿se quiere historial?

---

## Cosas chicas anotadas para que no se olviden

- **`.vscode/` está en el `.gitignore`**, así que el archivo que oculta los
  `__pycache__` funciona en una máquina pero no viaja al repo. Si se quiere para
  todo el equipo, hay que sacarlo del ignore.
- **El Excel de direcciones y el CSV de clientes siguen en el historial de git.**
  Borrarlos de la rama no los saca de los commits viejos: si el repo se hace
  público hay que limpiarlo con `git filter-repo`.
- **`autoprefixer` NO sobra**, aunque Tailwind v4 prefije por su cuenta. Se probó
  quitarlo y el CSS compilado cambia (59,142 → 59,460 bytes). Anotado en
  `postcss.config.js` para que nadie lo vuelva a intentar a ciegas.
- **Los 115 pedidos de prueba** (folios 8500000+) siguen en la base local. El
  candado `Remision.objects.reales()` los mantiene fuera del plan, así que no
  estorban, pero ahí están.

---

## El orden que yo seguiría

1. **Probar `sqlcmd` desde una Mac** — puede tumbar el proyecto y se prueba en
   diez minutos.
2. **Cloudflare Access** — una tarde, sin tocar código, y cierra el agujero más
   grave.
3. ~~**Acotar el `try/except` de `sap.py`**~~ — hecho el 5-ago.
4. **Cargar las 136 direcciones** — cero código, sube la cobertura 28 puntos.
5. ~~**Refactor de `Driver/index.jsx`**~~ — hecho el 5-ago (840 → 542 líneas,
   extraído a `hooks/useRutaChofer.js`, `hooks/useEvidencia.js` y
   `components/TarjetaParada.jsx`).
6. **Los bugs de `manual.py`** — los tres son de la misma zona, conviene hacerlos
   juntos.
7. **Autenticación de verdad** con roles.
8. **`solver.py`** al final, con todas las pruebas corriendo en cada paso.
