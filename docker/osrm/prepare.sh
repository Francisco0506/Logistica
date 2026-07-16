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

if [ ! -f "$PBF" ]; then
  echo ">> Descargando mapa de México (~250 MB, una sola vez)..."
  curl -L -o "$PBF" "$URL"
else
  echo ">> El mapa ya está descargado ($PBF), se reutiliza."
fi

echo ">> [1/3] extract (perfil de coche)..."
docker run --rm -t -v "${PWD}:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua "/data/$PBF"

echo ">> [2/3] partition..."
docker run --rm -t -v "${PWD}:/data" osrm/osrm-backend osrm-partition /data/mexico-latest.osrm

echo ">> [3/3] customize..."
docker run --rm -t -v "${PWD}:/data" osrm/osrm-backend osrm-customize /data/mexico-latest.osrm

echo ""
echo ">> Listo. Levanta el servidor con:  docker compose up -d osrm"
echo ">> Luego apunta el backend a él con:  OSRM_BASE=http://localhost:5001  (en backend/.env)"
