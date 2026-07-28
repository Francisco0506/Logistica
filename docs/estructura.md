# Dónde vive cada cosa

Actualizado el **28 de julio de 2026**, después de partir el backend.

La regla que se siguió: **agrupar por lo que cambia junto**, no por lo que se
parece. Los tres paneles se tocan por separado, así que van en archivos
separados; lo que habla con sistemas de afuera comparte los mismos problemas
(red, credenciales, caídas ajenas), así que va junto.

---

## backend/

```
core/                   Django puro: settings, urls, wsgi
delivery/
  api/                  Los endpoints, uno por rol
    __init__.py           monta los tres routers          22
    comun.py              lo que comparten los paneles    82
    dispatcher.py         panel del despachador          491
    ventas.py             panel del vendedor             203
    chofer.py             app del chofer                 226
  optimizer/            El ruteo, un archivo por trabajo
    __init__.py           reexporta la API pública         35
    reglas.py             constantes y reglas de negocio  191
    modelo.py             arma el modelo de OR-Tools      125
    solver.py             resuelve y guarda las rutas     348
    manual.py             ETAs reales y asignación a mano 285
  integrations/         Todo lo que depende de un tercero
    sap.py                SAP B1: las órdenes de entrega  395
    osrm.py               OSRM: tiempos por calle real    166
    samsara.py            Samsara: dónde está cada camión  76
  models.py             Ruta · Destino · Remisión · LineaRemisión
  fleet.py              La flota: placas, capacidades, topes
  management/commands/  Tareas de consola
  migrations/           Historial del esquema
  data/                 Excel semilla (NO se despliega)
media/                  Fotos de evidencia que suben los choferes
```

### Por qué está partido así

**`api/` por rol.** Era un archivo de 960 líneas con los tres paneles
revueltos. Cada panel lo pide gente distinta y cambia por razones distintas.
Cada router se monta bajo su prefijo (`/dispatcher`, `/ventas`, `/chofer`), así
que las rutas de la API no cambiaron.

**`optimizer/` por trabajo.** Eran 859 líneas haciendo cuatro cosas. `reglas.py`
está aparte a propósito: son las decisiones que se discuten con operación
—cuánto dura una parada, hasta qué hora se entrega, qué cuenta como una sola
parada— y conviene poder leerlas sin pasar por el código de OR-Tools.

**`integrations/` por lo que las hace frágiles.** SAP, OSRM y Samsara dependen
de algo que no controlamos y **pueden fallar de maneras que la lógica del
negocio no**. Cada una degrada a su modo y eso está documentado en su archivo.
Las tres conexiones son de **solo lectura**: el sistema no escribe en SAP ni en
Samsara.

## frontend/src/

```
views/
  Dispatcher/   panel del despachador  (index.jsx + components/)
  Sales/        panel del vendedor
  Driver/       app del chofer
  Login/        selector de rol
components/     lo compartido: avisos, logo, minimapa
config/         fleet.js (colores y CEDIS para el mapa)
services/       api.js — TODAS las llamadas al backend, en un solo lugar
```

El backend es la fuente de verdad de la flota: `config/fleet.js` solo guarda lo
visual. Las capacidades y los topes de paradas salen de
`backend/delivery/fleet.py` por API.

## docker/

```
docker-compose.yml            PostgreSQL y OSRM
docker-compose.override.yml   ajustes de ESTA máquina (no se versiona)
osrm/prepare.sh|ps1           procesa el mapa (tarda >1 h, baja 605 MB)
osrm/data/                    9.2 GB de mapa procesado — NO va a GitHub
```

## Lo que se quitó

| Qué | Por qué |
|---|---|
| `test_data.py` y `cargar_prueba.py` | Creaban pedidos inventados y **borraban todas las rutas del día, incluidas las despachadas**. Ya hay datos reales de SAP con qué probar. |
| Endpoint `/pedidos/cargar-prueba` y su botón | Misma razón, y estaba a un clic de cualquiera: la API no pide contraseña. |
| `fleet.placas_activas_por_default()` | Nadie la llamaba. |
| `db.sqlite3` | Sobra de cuando había respaldo a SQLite. Postgres es la única base desde hace tiempo; el archivo solo podía causar confusión como segunda fuente de verdad. |

## Lo que sigue pasado de largo

`api/dispatcher.py` (491) y `optimizer/solver.py` (348) son los más grandes que
quedan. Están debajo del límite y partirlos más ahorita separaría cosas que sí
cambian juntas — mejor esperar a que el código pida la división solo.
