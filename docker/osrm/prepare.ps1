# Descarga y procesa el mapa de México para OSRM (version PowerShell / Windows).
# Se corre UNA sola vez. Uso:  ./docker/osrm/prepare.ps1
$ErrorActionPreference = "Stop"

Set-Location "$PSScriptRoot/data"
$PBF = "mexico-latest.osm.pbf"
$URL = "https://download.geofabrik.de/north-america/mexico-latest.osm.pbf"

# LA MISMA VERSIÓN QUE SIRVE EL COMPOSE. OSRM cambia el formato de sus archivos
# entre versiones: procesar el mapa con una y servirlo con otra hace que
# `osrm-routed` no arranque. Si cambias esto, cambia también
# docker/docker-compose.yml y prepare.sh.
#
# Va por DIGEST y no por tag: el tag lo pueden re-publicar apuntando a otra
# imagen, el digest no cambia nunca. Este es OSRM 5.26.0.
$OSRM_IMG = "osrm/osrm-backend@sha256:af5d4a83fb90086a43b1ae2ca22872e6768766ad5fcbb07a29ff90ec644ee409"

if (-not (Test-Path $PBF)) {
    Write-Host ">> Descargando mapa de Mexico (~250 MB, una sola vez)..."
    Invoke-WebRequest -Uri $URL -OutFile $PBF
} else {
    Write-Host ">> El mapa ya esta descargado ($PBF), se reutiliza."
}

$dataDir = (Get-Location).Path

Write-Host ">> [1/3] extract (perfil de coche)..."
docker run --rm -t -v "${dataDir}:/data" $OSRM_IMG osrm-extract -p /opt/car.lua "/data/$PBF"

Write-Host ">> [2/3] partition..."
docker run --rm -t -v "${dataDir}:/data" $OSRM_IMG osrm-partition /data/mexico-latest.osrm

Write-Host ">> [3/3] customize..."
docker run --rm -t -v "${dataDir}:/data" $OSRM_IMG osrm-customize /data/mexico-latest.osrm

Write-Host ""
Write-Host ">> Listo. Levanta el servidor con:  docker compose up -d osrm"
Write-Host ">> Luego apunta el backend con:  OSRM_BASE=http://localhost:5001  (en backend/.env)"
