# Encender Laben Routing en producción (Mac mini / Mac Studio)

Esto NO es el README del proyecto: es la lista de lo que hay que hacer en la
máquina del cliente, en orden, con cómo comprobar cada paso.

La regla de este documento: **cada paso trae su comprobación**. Un paso sin
comprobar es un paso que no se hizo.

---

## 0. ANTES DE COMPRAR EL HARDWARE 🔴

**Probar que se puede conectar a SAP desde una Mac.** Es un bloqueante que no se
arregla con código.

En macOS **no existe** el "SQL Server Native Client 11.0". El único driver es
`msodbcsql18`, y si el SAP productivo es SQL Server 2012 puede no conectar.

```bash
brew tap microsoft/mssql-release https://github.com/Microsoft/homebrew-mssql-release
HOMEBREW_ACCEPT_EULA=Y brew install msodbcsql18 mssql-tools18 unixodbc

sqlcmd -S 10.x.x.x,1433 -U usuario -P '...' -d BASE -No -C \
       -Q "SELECT TOP 1 DocNum FROM ODLN"
```

**Comprobación:** devuelve un folio. Si devuelve un error de TLS, bajar el nivel
mínimo en `/opt/homebrew/etc/openssl@3/openssl.cnf`:

```
MinProtocol = TLSv1
CipherString = DEFAULT@SECLEVEL=0
```

Si aun así no conecta, **no seguir**: no hay plan B por el lado de Python.

**Mínimo de máquina:** 16 GB de RAM, 256 GB de SSD. OSRM pide 4-8 GB solo para
procesar el mapa.

---

## 1. Cerrar el acceso desde internet 🔴

**Hoy hay 18 endpoints sin autenticación y `/api/docs` publicado.** Cualquiera
con la URL puede bajar la cartera de clientes con teléfonos y montos, y
**falsificar entregas**.

No encender en el cliente sin esto puesto.

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create laben
# Apuntar el túnel a http://localhost:8080 (Caddy) y activar
# Cloudflare Access con login por correo (gratis hasta 50 usuarios).
```

**Comprobación:** abrir la URL en una ventana de incógnito → debe pedir correo
antes de mostrar nada. Y:

```bash
curl -s https://logistica.laben.mx/api/dispatcher/remisiones?fecha=2026-08-01
```
debe devolver una redirección al login, **nunca** JSON con pedidos.

Esto no sustituye la autenticación real de la aplicación (adentro sigue sin
haber roles: un chofer puede abrir el panel del despachador). Es la puerta que
se puede poner en una tarde mientras se construye la de verdad.

---

## 2. Configuración

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

En `backend/.env`:

| Variable | Valor | Por qué |
|---|---|---|
| `DJANGO_SECRET_KEY` | la generada arriba | la vieja quedó publicada en GitHub |
| `DJANGO_DEBUG` | `False` | con `True`, cualquier error muestra la contraseña de SAP |
| `DJANGO_ALLOWED_HOSTS` | el dominio del túnel | con `DEBUG=False` y vacío, todo responde 400 |
| `CORS_ORIGINS` | `https://logistica.laben.mx` | con `DEBUG=False` el navegador bloquea lo que no esté aquí |
| `OSRM_BASE` | `http://localhost:5001` | si se olvida, el ruteo depende del internet de la oficina |
| `SAP_ODBC_DRIVER` | `ODBC Driver 18 for SQL Server` | el 17 y el Native Client no existen en macOS |

**Comprobación:** pedir una URL inexistente → página 404 sobria, sin traza ni
variables de entorno.

---

## 3. OSRM local

Docker Desktop → Resources → **8 GB de RAM**. Con los 2-4 GB por default,
`osrm-extract` muere con OOM sin decir nada útil.

```bash
docker manifest inspect osrm/osrm-backend:v5.27.1 | grep architecture
```

Si no aparece `arm64`, agregar `platform: linux/amd64` al servicio — funciona
bajo emulación, pero `osrm-extract` se vuelve lentísimo. En ese caso: procesar
el mapa **una vez** en otra máquina y copiar los `.osrm.*` ya cocidos.

**Comprobación:** desconectar el internet de la Mac (dejando la LAN) y
optimizar. El mensaje debe decir *"distancias reales de calle"*, **nunca**
*"EN LÍNEA RECTA"*.

---

## 4. Servidor de aplicación

```bash
pip install gunicorn
cd backend
gunicorn core.wsgi:application --bind 127.0.0.1:8000 --workers 5 --timeout 180
```

Los dos parámetros importan y **no** son el default:

- **`--timeout 180`** — el default de gunicorn son **30 s**. El optimizador se
  toma ~20 s y `/rutas/escenarios` corre hasta cuatro simulaciones seguidas. Con
  el default, gunicorn **mata al worker a media optimización** y el despachador
  ve un 502. Es un fallo garantizado el primer día.
- **`--workers 5`** — con menos, un `/sync` lento a SAP bloquea al chofer que
  está subiendo una firma desde la calle.

### Frontend y archivos de media

```bash
npm ci && npm run build      # OJO: `npm ci`, no copiar node_modules de Windows
brew install caddy
```

`Caddyfile`:

```
logistica.laben.mx {
    handle /api/*   { reverse_proxy 127.0.0.1:8000 }
    handle /admin/* { reverse_proxy 127.0.0.1:8000 }
    handle /media/* { root * /Users/laben/Logistica/backend; file_server }
    handle          {
        root * /Users/laben/Logistica/frontend/dist
        try_files {path} /index.html
        file_server
    }
}
```

El bloque `/media/*` **no es opcional**: con `DEBUG=False`, Django deja de
servir `/media/` (`core/urls.py` solo lo monta en debug). La subida sigue
funcionando, la URL se sigue devolviendo, todo se ve normal… y **cada foto de
evidencia da 404 al abrirla**. Es fácil no notarlo hasta que alguien reclama una
entrega.

**Comprobación:** subir una foto desde la app del chofer y **abrirla** desde el
panel de ventas. Y correr Optimizar con 100 pedidos: debe terminar, no dar 502.

---

## 5. Que todo vuelva solo tras un apagón

```bash
sudo pmset -a autorestart 1      # encender sola al volver la luz
sudo pmset -a sleep 0 disksleep 0 # que no se duerma a las 6 de la mañana
```

**El punto donde más gente se atora:** Docker Desktop **no arranca sin una
sesión gráfica iniciada**. Si la Mac arranca a la pantalla de login, no hay
Postgres ni OSRM y no hay sistema. Hay que activar el inicio de sesión
automático para un usuario dedicado y marcar en Docker Desktop *"Start Docker
Desktop when you sign in"*. Con la Mac bajo llave en la oficina es aceptable.

Backend y Caddy como `LaunchDaemon` con `KeepAlive=true`, `RunAtLoad=true` y
`ThrottleInterval=20`. El backend truena si Postgres no está todavía
(`apps.py`), así que se va a morir unas cuantas veces mientras Docker levanta y
después engancha solo. Es feo y es robusto.

**Comprobación — la única que vale:** desconectar el cable de corriente con el
sistema en uso. Volver a conectarlo. **Sin tocar teclado ni ratón**, abrir el
panel desde otra máquina antes de 5 minutos.

---

## 6. UPS

Línea-interactiva con AVR, **1000-1500 VA, con puerto USB** (macOS los reconoce
nativamente: aparecen en Ajustes → Batería). APC Back-UPS Pro o CyberPower
CP1500.

**Conectar la Mac Y el módem/router.** Si se cae el router, el chofer en la
calle pierde el sistema aunque la Mac siga encendida.

Con un Mac mini (~15-40 W) más el equipo de red, un 1000 VA da **2-4 horas**.
Configurar además "apagar al 20% de batería" para el corte largo.

**Comprobación:** desconectar el UPS de la pared con el sistema en uso → el
panel sigue respondiendo desde un celular en datos móviles.

---

## 7. Respaldos

```bash
./scripts/respaldo.sh
```

Programarlo a las **20:30** con launchd (ya no se captura nada después de las
19:00).

**Comprobación, y hay que hacerla ANTES de encender:** restaurar sobre una base
vacía con `./scripts/restaurar.sh` y ver los pedidos **y las fotos** de un día
real. Un respaldo que nadie restauró no se sabe si sirve.

Y sacar una copia **fuera de la oficina** (rclone a Drive o B2). Un disco USB al
lado de la Mac no protege de un robo ni de una inundación.

---

## Lo que queda pendiente para la primera semana

1. **Autenticación de verdad en Django**, con roles. Cloudflare Access tapa el
   agujero hacia internet, pero adentro sigue sin haber separación: un chofer
   puede abrir el panel del despachador, y el código de vendedora viaja en la
   URL, así que cualquiera ve los pedidos de otra.
2. **Que OSRM deje de mentir al dar "Salida"**: si el servidor de rutas no
   responde, hoy se escriben ETAs de línea recta con la misma cara que una ETA
   real.
3. **Estado persistente de SAP** + banner con la hora del último dato bueno +
   correo de alerta cuando lleve 3 fallos seguidos.
4. **Botón de reintentar la foto/firma** en una parada ya confirmada: hoy, si la
   subida falla por señal, la evidencia se perdió sin recurso.
