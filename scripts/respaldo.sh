#!/bin/bash
#
# Respaldo diario de Laben Routing.
#
# QUÉ RESPALDA Y POR QUÉ ESE ORDEN DE IMPORTANCIA:
#
#   1. Las FOTOS Y FIRMAS de entrega (backend/media/). Es lo único del sistema
#      que NO se puede recuperar de ninguna otra fuente. Los pedidos se vuelven
#      a bajar de SAP; la firma que el cliente trazó con el dedo, no. Si se
#      muere el SSD, se perdió la prueba de las entregas.
#   2. La base de datos. Se puede re-sincronizar de SAP, pero se perderían las
#      rutas armadas, los estados de despacho y lo que el chofer reportó.
#   3. El .env, que NO está en git y sin él el sistema no arranca.
#
# CÓMO SE PROGRAMA EN LA MAC (launchd, sin instalar nada):
#   Crear ~/Library/LaunchAgents/mx.laben.respaldo.plist apuntando a este
#   script con StartCalendarInterval a las 20:30 — ya no se captura nada
#   después de las 19:00. Luego:
#       launchctl load ~/Library/LaunchAgents/mx.laben.respaldo.plist
#
# CÓMO SE RESTAURA: ver scripts/restaurar.sh. Y hay que PROBARLO una vez antes
# de encender en el cliente — un respaldo que nadie restauró no es un respaldo,
# es un archivo.

set -euo pipefail

PROYECTO="${LABEN_PROYECTO:-$HOME/Logistica}"
DESTINO_BASE="${LABEN_RESPALDOS:-/Volumes/RespaldoLaben}"
CONTENEDOR_DB="${LABEN_DB_CONTAINER:-logistica-db}"
DIAS_A_CONSERVAR="${LABEN_DIAS_RESPALDO:-30}"

DESTINO="$DESTINO_BASE/$(date +%Y-%m-%d)"

if [ ! -d "$DESTINO_BASE" ]; then
  echo "ERROR: no existe $DESTINO_BASE. ¿Está conectado el disco de respaldo?" >&2
  exit 1
fi

mkdir -p "$DESTINO"
echo "==> Respaldando en $DESTINO"

# 1. Fotos y firmas. Va PRIMERO a propósito: es lo irrecuperable.
#    Sin --delete: si alguien borró una foto por error, el respaldo de ayer la
#    conserva. El espacio no es problema (son ~100 fotos al día).
echo "--> Fotos y firmas de entrega"
rsync -a "$PROYECTO/backend/media/" "$DESTINO/media/"

# 2. Base de datos. Formato -Fc (custom): comprimido y restaurable por partes.
echo "--> Base de datos"
docker exec "$CONTENEDOR_DB" pg_dump -U postgres -Fc laben_routing > "$DESTINO/laben.dump"

# 3. La configuración, que no está en git.
echo "--> backend/.env"
cp "$PROYECTO/backend/.env" "$DESTINO/env.respaldo"

# 4. COMPROBAR QUE EL DUMP SE PUEDE LEER.
#    Este paso es el que separa un respaldo de un archivo de bytes. Un pg_dump
#    que falló a la mitad deja un archivo con tamaño y sin contenido útil, y
#    nadie se entera hasta el día que se necesita.
echo "--> Verificando el dump"
pg_restore --list "$DESTINO/laben.dump" > /dev/null
echo "    OK: $(pg_restore --list "$DESTINO/laben.dump" | grep -c 'TABLE DATA') tablas con datos"

# 5. Tirar lo viejo.
find "$DESTINO_BASE" -maxdepth 1 -type d -name '20*' -mtime "+$DIAS_A_CONSERVAR" -exec rm -rf {} + 2>/dev/null || true

echo "==> Listo: $(du -sh "$DESTINO" | cut -f1) en $DESTINO"
echo
echo "RECORDATORIO: esto respalda a un disco que está en la MISMA oficina."
echo "Si se inunda o se lo roban junto con la Mac, no sirvió de nada."
echo "Copia fuera de sitio con rclone (Drive, B2) o un disco que alguien se lleve."
