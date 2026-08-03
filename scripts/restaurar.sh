#!/bin/bash
#
# Restaurar Laben Routing desde un respaldo.
#
#   ./scripts/restaurar.sh /Volumes/RespaldoLaben/2026-08-01
#
# ESTO HAY QUE PROBARLO ANTES DE NECESITARLO. Un respaldo que nadie restauró no
# se sabe si sirve. La prueba correcta es correrlo contra una base vacía y
# después entrar al panel, poner una fecha con entregas, y ver los mismos
# pedidos Y LAS MISMAS FOTOS que había antes. Si las fotos no se ven, el
# respaldo estaba a medias.
#
# BORRA LA BASE ACTUAL. Pide confirmación por eso.

set -euo pipefail

RESPALDO="${1:-}"
PROYECTO="${LABEN_PROYECTO:-$HOME/Logistica}"
CONTENEDOR_DB="${LABEN_DB_CONTAINER:-logistica-db}"

if [ -z "$RESPALDO" ] || [ ! -d "$RESPALDO" ]; then
  echo "Uso: $0 /ruta/al/respaldo/YYYY-MM-DD" >&2
  exit 1
fi
if [ ! -f "$RESPALDO/laben.dump" ]; then
  echo "ERROR: no hay laben.dump en $RESPALDO" >&2
  exit 1
fi

echo "Se va a BORRAR la base de datos actual y reemplazarla con:"
echo "  $RESPALDO/laben.dump  ($(date -r "$RESPALDO/laben.dump" '+%d-%b %H:%M'))"
echo
read -r -p "Escribe RESTAURAR para continuar: " respuesta
[ "$respuesta" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }

echo "==> Levantando Postgres"
(cd "$PROYECTO/docker" && docker compose up -d db)
until docker exec "$CONTENEDOR_DB" pg_isready -U postgres > /dev/null 2>&1; do
  echo "    esperando a Postgres…"; sleep 2
done

echo "==> Recreando la base"
docker exec -i "$CONTENEDOR_DB" dropdb -U postgres --if-exists laben_routing
docker exec -i "$CONTENEDOR_DB" createdb -U postgres laben_routing

echo "==> Restaurando los datos"
docker exec -i "$CONTENEDOR_DB" pg_restore -U postgres -d laben_routing --no-owner < "$RESPALDO/laben.dump"

echo "==> Restaurando fotos y firmas"
rsync -a "$RESPALDO/media/" "$PROYECTO/backend/media/"

# Por si el respaldo es de una versión anterior del código: las migraciones que
# falten se aplican solas. Al revés (respaldo más nuevo que el código) hay que
# actualizar el código primero.
echo "==> Aplicando migraciones pendientes"
(cd "$PROYECTO/backend" && python manage.py migrate)

echo
echo "==> Listo. AHORA COMPRUEBA A MANO, que es la única forma de saber si sirvió:"
echo "    1. Abre el panel y pon una fecha que tuviera entregas."
echo "    2. Que salgan los mismos pedidos y las mismas rutas."
echo "    3. Abre una entrega ya reportada y QUE SE VEA SU FOTO."
echo
echo "    El .env del respaldo quedó en $RESPALDO/env.respaldo (no se copia solo:"
echo "    revísalo antes, puede traer datos de otra máquina)."
