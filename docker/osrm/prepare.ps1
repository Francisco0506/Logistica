# Descarga y procesa el mapa de México para OSRM (version PowerShell / Windows).
# Se corre UNA sola vez. Uso:  ./docker/osrm/prepare.ps1
$ErrorActionPreference = "Stop"

Set-Location "$PSScriptRoot/data"
$PBF = "mexico-latest.osm.pbf"
$URL = "https://download.geofabrik.de/north-america/mexico-latest.osm.pbf"

if (-not (Test-Path $PBF)) {
    Write-Host ">> Descargando mapa de Mexico (~250 MB, una sola vez)..."
    Invoke-WebRequest -Uri $URL -OutFile $PBF
} else {
    Write-Host ">> El mapa ya esta descargado ($PBF), se reutiliza."
}

$dataDir = (Get-Location).Path

Write-Host ">> [1/3] extract (perfil de coche)..."
docker run --rm -t -v "${dataDir}:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua "/data/$PBF"

Write-Host ">> [2/3] partition..."
docker run --rm -t -v "${dataDir}:/data" osrm/osrm-backend osrm-partition /data/mexico-latest.osrm

Write-Host ">> [3/3] customize..."
docker run --rm -t -v "${dataDir}:/data" osrm/osrm-backend osrm-customize /data/mexico-latest.osrm

Write-Host ""
Write-Host ">> Listo. Levanta el servidor con:  docker compose up -d osrm"
Write-Host ">> Luego apunta el backend con:  OSRM_BASE=http://localhost:5001  (en backend/.env)"
