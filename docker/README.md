# Infraestructura Docker — Logistica (Laben)

Dos servicios: **PostgreSQL** (base de datos real) y **OSRM** (servidor de rutas
propio, sin el límite de 100 paradas del público y capaz de evitar casetas).

Todos estos archivos van a GitHub. Las **imágenes** de Docker no: se descargan
solas la primera vez. En otra máquina (ej. la del trabajo) basta instalar
Docker, bajar el repo y correr estos mismos comandos.

---

## 1. PostgreSQL (rápido, ya)

```bash
cd docker
docker compose up -d db
```

Eso levanta Postgres con las credenciales que el backend ya espera por default
(`postgres` / `postgres` / base `laben_routing`). El backend lo detecta solo:
si Postgres está arriba lo usa, si no, cae a SQLite. No hay que configurar nada.

Luego, la primera vez, crear las tablas:

```bash
cd ../backend
python manage.py migrate
```

## 2. OSRM (servidor de rutas propio)

**Una sola vez**, procesar el mapa (baja ~250 MB y tarda unos minutos):

```bash
# Windows PowerShell:
./osrm/prepare.ps1
# Git Bash / Linux / Mac:
bash osrm/prepare.sh
```

Después, levantar el servidor (arranca en segundos):

```bash
docker compose up -d osrm
```

Y decirle al backend que use ESE servidor en vez del público — en
`backend/.env` (créalo si no existe):

```
OSRM_BASE=http://localhost:5001
```

Reinicia el backend y listo: rutas por calle real, sin límite de 100 paradas,
evitando autopistas de cuota.

---

## Comandos útiles

```bash
docker compose ps          # ver qué está corriendo
docker compose logs osrm   # ver logs del servidor de rutas
docker compose down        # apagar todo (los datos de Postgres se conservan)
```

## Requisitos de máquina

- **Postgres:** casi nada.
- **OSRM:** ~4-8 GB de RAM libres para procesar el mapa de México, y ~10 GB de
  disco. Una vez procesado, corre ligero.
