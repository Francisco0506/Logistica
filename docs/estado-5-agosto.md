# Dónde quedamos — 5 de agosto de 2026

Lo que se arregló el 4 y 5 de agosto, y **lo que falta para encender**.

Todo está en la rama `arreglos-prelanzamiento` (ya subida a GitHub), sin
mezclar a `main` todavía.

**151 pruebas de backend · 87 de frontend**, todas en verde.

---

## 🔴 Lo que falta ANTES del miércoles

Ordenado por qué tan caro sale no hacerlo.

### 1. Probar SAP desde una Mac — *diez minutos, y puede tumbar el proyecto*

`backend/.env` usa el driver `SQL Server Native Client 11.0`, que **no existe en
macOS**. El lanzamiento es en una Mac. Si el SAP productivo es SQL Server 2012,
el driver 18 —el único que hay para Mac— puede no conectar, y **no hay plan B
por el lado de Python**.

```bash
brew tap microsoft/mssql-release https://github.com/Microsoft/homebrew-mssql-release
HOMEBREW_ACCEPT_EULA=Y brew install msodbcsql18 mssql-tools18 unixodbc
sqlcmd -S 172.16.1.69,1433 -U consultasap -P '...' -d DB_LABEN_PRODUCTIVA -No -C \
       -Q "SELECT TOP 1 DocNum FROM ODLN"
```

> **Cómo saber que quedó:** devuelve un folio. Si da error de TLS, bajar
> `MinProtocol` en `openssl.cnf` (ver `scripts/produccion.md` §0).

Es lo único de toda la lista que puede tumbar el proyecto entero, y hacerlo el
martes en la noche sería tarde.

### 2. Autenticación — *comprobado el 5-ago, sigue abierto*

```
GET /api/dispatcher/remisiones?fecha=... sin sesión  →  HTTP 200
[{"card_name": "Roberto Cantu Salgado", ...
```

Sin login, cualquiera con la dirección baja la cartera completa de clientes
—con teléfonos y montos— y **puede falsificar entregas**. El login de hoy es un
selector de rol: no valida nada.

**Parche para la primera semana** (una tarde, sin tocar código): Cloudflare
Tunnel + Access con login por correo. Ver `scripts/produccion.md` §1.

### 3. La base de datos y su respaldo

- **Nunca se ha hecho un respaldo, ni se ha probado restaurar uno.** Los
  scripts existen (`scripts/respaldo.sh`, `scripts/restaurar.sh`) pero un
  respaldo que nadie restauró no se sabe si sirve.
- `scripts/respaldo.sh` usa `rsync`, que **no existe en Windows**. En la Mac sí
  viene de fábrica, así que allá no estorba — pero aquí no se puede probar
  completo.
- **Decisión tomada el 5-ago:** la base se va a **Postgres nativo**, no Docker.
  De Docker se queda **solo el mapa (OSRM)**, que es lo que de verdad conviene
  tener contenido.

**Estado hoy en esta máquina:** hay DOS Postgres corriendo a la vez.

| Puerto | Cuál | Notas |
|---|---|---|
| 5432 | PostgreSQL 18.4 nativo de Windows | Instalado y corriendo. **Falta la contraseña de `postgres`** |
| 5433 | El de Docker (`logistica-db`) | Es el que usa el sistema hoy (`DB_PORT=5433`) |

`psql`, `pg_dump` y `pg_restore` ya quedaron en el PATH del usuario. pgAdmin 4
está en `C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime\pgAdmin4.exe`.

> **Lo que hace falta para migrar:** la contraseña del usuario `postgres` que se
> puso al instalar PostgreSQL 18. Con eso: crear la base, `pg_dump` del 5433 →
> `pg_restore` al 5432, y cambiar `DB_PORT` en `backend/.env`.

### 4. Las coordenadas que faltan

**343 de 497 destinos tienen coordenadas (69%).** El 4-ago, **17 de 56 pedidos**
no se pudieron rutear por eso — el sistema no sabe a dónde ir.

Hay **136 direcciones ya listas para cargar** que suben la cobertura sin
escribir una línea de código. Es lo que más rinde de toda la lista.

*(Francisco, 5-ago: esto espera a después de la prueba piloto.)*

---

## 🟡 Pendientes de código

### El único bug conocido que sigue abierto

`optimizer/manual.py:126,195` — las sugerencias de "en qué camión cabe este
pedido" miden contra la hora de salida y el turno **por default** (09:00 / 6 h),
no contra los de la corrida real. Si se optimizó con salida 07:00 o turno de
8 h, el panel puede rechazar como "llegaría después de que cierren" un pedido
que en la ruta real sí cabe.

La ruta ya guarda `salida_plan` (agregado el 4-ago) con la hora correcta; falta
que `sugerir_camiones_para_remision` la use en vez de las constantes.

### Refactor que se dejó a propósito

`optimizer/solver.py` (607 líneas, `solve_vrp` sola tiene 566). **No se tocó a
propósito:** es el de más riesgo de todo el proyecto, porque un error ahí no
truena — da rutas peores sin que nadie se entere. Va después del lanzamiento,
con las 151 pruebas corriendo en cada paso.

### Datos que SAP no tiene

**26 de 52 líneas vendidas por kilogramo no traen el peso por pieza**
(`OITM.IWeight1` vacío). El queso quesadilla es una: SAP dice 36.5 kg y no hay
ningún campo que diga cuánto pesa cada pieza — el "30 / 50 GR" del nombre es
texto, no configuración. Se revisaron las tres vías posibles (`IWeight1`,
`DLN1.NumPerMsr` y los grupos de unidad `OUGP`/`UGP1`) y el dato no está.

Para esos artículos el chofer reporta en kilos. Si algún día se quiere por
pieza, hay que cambiar la unidad de venta de ese artículo en SAP.

---

## ✅ Lo que se arregló el 4 y 5 de agosto

### Bloqueadores de arranque

- **OSRM apuntaba a una versión que no existe** (`v5.27.1` es una release de
  GitHub, no un tag de Docker Hub). En la Mac `docker compose up` habría
  tronado con "manifest unknown" el primer día. Ahora va fijado por **digest** a
  la misma imagen 5.26.0 con la que está procesado el mapa, y los scripts de
  preparación usan esa misma. Comprobado: 133 paradas del día pico en 1.1 s.
- **El healthcheck de OSRM nunca funcionó** — usaba `wget` (que no está en la
  imagen) y el `;` de la URL partía el comando en `sh`. Salía "unhealthy"
  siempre, que es peor que no tenerlo.

### Datos falsos que el sistema guardaba

- **Una entrega que nunca ocurrió se guardaba como "Entregado".** El chofer
  marcaba "el cliente estaba cerrado" sin bajar las cantidades —lo natural, no
  tocó la mercancía— y como los renglones seguían completos quedaba
  'Entregado'. Ventas y facturación daban por entregado lo que seguía en el
  camión.
- **Un camión podía salir con dos rutas el mismo día** (carrera entre la
  corrida del optimizador y el almacén marcando "Cargando"). Ahora se revalida
  dentro de la transacción y la base lo impide con `unique_together`.
- **Reabrir una parada ya reportada la sobrescribía** como entrega completa.
- **El peso venía inflado:** ahora usa `IWeight1` de SAP (peso neto por pieza).
  Comprobado contra la orden 266627: 780.48 kg calculados contra 780.5 kg de la
  cuenta a mano.

### Horas que se prometían y no se podían cumplir

- **Salir tarde prometía horas imposibles en silencio.** Recalcular no vuelve a
  planear: conserva el orden y solo lo recorre. Medido con 37 paradas planeadas
  para las 09:00 — saliendo a las 11:00, **15 paradas** llegaban después de que
  el cliente cierra, y el panel no decía nada. Ahora avisa con folios.
- **Si OSRM no contestaba**, las ETAs se recalculaban en línea recta (-15% al
  centro, -38% a Escobedo) sin avisar.
- **Meter un pedido a mano no recalculaba ninguna ETA.**

### La app del chofer

- **Pedía las rutas del día equivocado** — dos veces: primero con la fecha de
  hoy, luego con la del despachador, que **cambia sola a las 11:00** y lo
  brincaba al día siguiente con su ruta a medio hacer. Ahora pregunta por el
  reparto de hoy. Tiene 4 pruebas que fijan las dos versiones del bug.
- **Nunca mostraba el nombre de la sucursal**, solo la razón social: dos
  paradas seguidas se veían idénticas ("Pollos Expo Guadalupe, S.A. De C.V.")
  cuando eran "Pollo Loco Eloy Cavazos" y "Pollo Loco Pablo Livas".
- **Un fetch colgado dejaba la app sin poder entregar el resto del día.**
- **La evidencia sin subir vivía en una sección plegada y sin aviso.**
- **Google Maps pintaba la ruta pero no arrancaba a navegar** (le faltaba
  `dir_action=navigate`).
- **Se quitó el mapa** (decisión de Francisco, 5-ago): estorbaba más de lo que
  servía. Con él se fue el sondeo de GPS cada 20 s.

### Limpieza

- Se dividieron los dos archivos más grandes, sin tocar comportamiento:
  `Driver/index.jsx` (840 → 542 líneas, extraído a hooks) y `sync_from_sap`
  (partida en 4, con el `try/except` acotado de ~422 líneas a 2 — para que un
  bug de Python deje de reportarse como "Falló la conexión con SAP B1").
- Se borró código muerto verificado con grep: una constante duplicada y un
  `@property` que nadie llamaba.
- Se actualizó `docs/lo-que-falta.md`: de los 8 bugs que listaba como abiertos,
  7 ya estaban arreglados.

---

## El orden que yo seguiría

1. **`sqlcmd` desde la Mac** — diez minutos, y puede tumbar el proyecto.
2. **La contraseña de Postgres** para poder migrar la base del Docker al nativo.
3. **Cloudflare Access** — una tarde, sin tocar código, cierra el agujero más
   grave.
4. **Probar el respaldo y su restauración** antes de encender.
5. **Cargar las 136 direcciones** — cero código, sube la cobertura 28 puntos.
6. **El bug de `manual.py`** y, ya después del arranque, `solver.py`.
