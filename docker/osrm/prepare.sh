#!/usr/bin/env bash
# Descarga y procesa el mapa de México para OSRM. Se corre UNA sola vez (y de
# nuevo solo si quieres actualizar el mapa). Después, el servidor arranca en
# segundos con: docker compose up -d osrm
#
# Uso:  bash docker/osrm/prepare.sh
set -e

cd "$(dirname "$0")/data"
PBF=mexico-latest.osm.pbf
URL=https://download.geofabrik.de/north-america/mexico-latest.osm.pbf

# LA MISMA VERSIÓN QUE SIRVE EL COMPOSE. No es cosmético: OSRM cambia el formato
# de sus archivos entre versiones, así que si el mapa se procesa con una versión
# y se sirve con otra, `osrm-routed` se niega a arrancar por incompatibilidad de
# archivos y el optimizador se cae a línea recta.
#
# Antes aquí decía `osrm/osrm-backend` a secas —o sea `latest`, un blanco móvil—
# mientras el compose pineaba otra. Si cambias esto, cambia también
# docker/docker-compose.yml y prepare.ps1.
#
# Va por DIGEST y no por tag: el tag lo pueden re-publicar apuntando a otra
# imagen, el digest no cambia nunca. Este es OSRM 5.26.0.
OSRM_IMG=osrm/osrm-backend@sha256:af5d4a83fb90086a43b1ae2ca22872e6768766ad5fcbb07a29ff90ec644ee409

if [ ! -f "$PBF" ]; then
  echo ">> Descargando mapa de México (~250 MB, una sola vez)..."
  curl -L -o "$PBF" "$URL"
else
  echo ">> El mapa ya está descargado ($PBF), se reutiliza."
fi

echo ">> [1/3] extract (perfil de coche)..."
docker run --rm -t -v "${PWD}:/data" "$OSRM_IMG" osrm-extract -p /opt/car.lua "/data/$PBF"

echo ">> [2/3] partition..."
docker run --rm -t -v "${PWD}:/data" "$OSRM_IMG" osrm-partition /data/mexico-latest.osrm

echo ">> [3/3] customize..."
docker run --rm -t -v "${PWD}:/data" "$OSRM_IMG" osrm-customize /data/mexico-latest.osrm

echo ""
echo ">> Listo. Levanta el servidor con:  docker compose up -d osrm"
echo ">> Luego apunta el backend a él con:  OSRM_BASE=http://localhost:5001  (en backend/.env)"
