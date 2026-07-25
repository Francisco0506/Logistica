# Logística Laben — optimizador de rutas de reparto

Sistema de despacho para **Laben Food Service** (CEDIS Santa Catarina, Monterrey).
Toma los pedidos del día de SAP B1, arma las rutas de los camiones ISUZU con
OR-Tools sobre distancias reales de calle, y le da al despachador un panel para
seguirlas en vivo contra el GPS de la flota.

## Cómo encajan las piezas

| Pieza | Qué aporta | Sin ella |
|-------|-----------|---------|
| **SAP B1** (SQL Server) | Pedidos del día, lat/lng del cliente, ventana de recibo, peso | Se puede trabajar con "Cargar pedidos de prueba" (destinos reales, pedidos simulados) |
| **OSRM** | "De este punto a este otro: X km y Y minutos por calle" | Cae a línea recta y **el orden de las paradas deja de ser confiable** |
| **OR-Tools** | Decide el orden de las paradas y qué camión lleva qué | — |
| **Samsara** | Dónde está cada camión ahora + las constantes ya medidas | El panel funciona, solo pierde la capa de GPS en vivo |
| **PostgreSQL** | La única base de datos | Django no arranca (a propósito) |

Samsara es telemetría: dice qué pasó y qué está pasando. **No calcula rutas** —
eso es OSRM + OR-Tools.

## Levantar el proyecto

Requisitos: Docker, Python 3.12+, Node 20+.

```bash
# 1. Base de datos
cd docker && docker compose up -d db

# 2. Backend  ->  http://127.0.0.1:8000
cd ../backend
cp .env.example .env          # y llenar los valores de esta máquina
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver

# 3. Frontend ->  http://localhost:5173
cd ../frontend
npm install
npm run dev
```

El panel del despachador queda en http://localhost:5173/dispatcher

### La primera vez: cargar los destinos

Las coordenadas y ventanas de recibo de los 195 Ship-To salen de un Excel de SAP:

```bash
cd backend
python manage.py importar_direcciones_excel delivery/data/Carga_direcciones_LineNum_AdresType.xlsx
```

### Probar sin SAP

```bash
python manage.py cargar_prueba --fecha 2026-07-25 --n 80
```

Crea pedidos simulados sobre **destinos reales**. Ojo: borra las rutas de ese
día, incluidas las ya despachadas.

### OSRM propio (recomendado, ver `docker/README.md`)

Sin él todo corre contra el servidor público de demo, que **rechaza más de 100
paradas** y no permite evitar casetas. Los días pico son justo los que se caen a
línea recta.

## Qué va a producción y qué no

| Carpeta | Desarrollo | Producción |
|---------|:----------:|:----------:|
| `backend/` | ✅ `runserver` | ✅ pero detrás de gunicorn, **nunca** `runserver` |
| `backend/delivery/data/*.xlsx` | ✅ semilla, se corre una vez | ❌ no se despliega |
| `backend/delivery/test_data.py` y el botón "Prueba" | ✅ | ❌ **hay que apagarlo**: borra rutas despachadas |
| `frontend/src/` | ✅ | ❌ se compila |
| `frontend/dist/` | ❌ | ✅ **esto es lo que se sirve** (`npm run build`) |
| `frontend/node_modules/` | ✅ | ❌ solo para compilar |
| `docker/` | ✅ | ✅ Postgres y OSRM sí van a producción |
| `docker/osrm/data/*.osm.pbf` | una vez | ❌ se borra después de procesar el mapa |
| `docs/` | ✅ | ❌ |

### Pendiente antes de producción

- `SECRET_KEY` está escrita en `core/settings.py` — debe salir del `.env`.
- `DEBUG = True`, `ALLOWED_HOSTS = []` y `CORS_ALLOW_ALL_ORIGINS = True`.
- El login no valida nada, solo escoge rol.
- No hay entorno virtual ni versiones fijadas de Python.
- No hay pruebas automatizadas.

## Documentación

| Documento | De qué trata |
|-----------|-------------|
| [`docs/como-funciona.md`](docs/como-funciona.md) | **Explicaciones en lenguaje llano**: los dos pesos, las horas, por qué se ven líneas rectas, qué mapa se usa, qué secretos están expuestos |
| [`docs/pendientes.md`](docs/pendientes.md) | **Todo lo que falta**, por prioridad: choferes, datos de SAP, OSRM, seguridad |
| [`docs/flota.md`](docs/flota.md) | Los 8 camiones medidos con GPS real: capacidades por VIN, cuántos operan de verdad, cómo se calibró el optimizador |
| [`docs/calibracion-tiempos-osrm.md`](docs/calibracion-tiempos-osrm.md) | OSRM es ~25% optimista contra el GPS real. Factor de corrección pendiente de aplicar |
| [`docs/pendientes-vendedor-chofer.md`](docs/pendientes-vendedor-chofer.md) | Alcance de los paneles de Vendedor y Chofer, todavía sin construir |
| [`docker/README.md`](docker/README.md) | Levantar Postgres y el servidor OSRM propio |

## Estructura

```
backend/
  core/                Django: settings, urls, wsgi
  delivery/
    models.py            Ruta · Destino · Remisión
    api.py               Endpoints (django-ninja)
    optimizer.py         OR-Tools: ventanas, capacidades, ETAs, asignación manual
    sync.py              SAP B1 -> base de datos
    routing_service.py   Cliente OSRM (+ respaldo en línea recta)
    samsara_service.py   GPS en vivo (solo lectura)
    test_data.py         Pedidos de prueba sobre destinos reales
    data/                Excel semilla de los Ship-To
frontend/src/
  views/Dispatcher/    Panel del despachador
  views/Sales/         Panel de vendedor (por construir)
  views/Driver/        App del chofer (por construir)
  config/fleet.js      Datos de la flota
  services/api.js      Llamadas al backend
docker/                PostgreSQL y OSRM
docs/                  Mediciones y decisiones
```
