import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { CEDIS } from '../config/fleet';

/**
 * Mapita para ver dónde queda UN cliente, sin salir de donde estás.
 *
 * Se usa en el detalle de un pedido (dispatcher) y en la tarjeta de la
 * vendedora. No dibuja rutas ni permite navegar: es para ubicar de un vistazo
 * —"¿este cliente está para el lado de Guadalupe o de Santa Catarina?"— y por
 * eso va sin controles y sin arrastre. Para lo demás está el mapa grande.
 *
 * Si el camión que lleva el pedido está reportando posición, también sale, que
 * es la pregunta que sigue: "¿y por dónde va el camión?".
 */

const iconoCliente = (color) =>
  L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

const iconoCamion = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="background:#16a34a;width:24px;height:24px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35)">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/></svg>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const iconoCedis = L.divIcon({
  className: '',
  html: '<div style="background:#0f172a;width:16px;height:16px;border-radius:4px;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.25)"></div>',
  iconSize: [16, 16],
});

export default function MiniMapa({
  lat,
  lng,
  nombre,
  color = '#f97316',
  camion = null,
  alto = 'h-44',
}) {
  if (lat == null || lng == null) {
    return (
      <div className={`${alto} rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center`}>
        <p className="text-[11px] text-gray-400 px-4 text-center">
          Este cliente no tiene ubicación en SAP, así que no se puede mostrar en el mapa.
        </p>
      </div>
    );
  }

  const punto = [lat, lng];
  // Encuadre: si el camión está reportando, se ven los dos; si no, el cliente
  // solo, con un acercamiento que deja ver la colonia.
  const puntos = camion?.lat ? [punto, [camion.lat, camion.lng]] : [punto];
  const limites = L.latLngBounds(puntos).pad(camion?.lat ? 0.35 : 0.9);

  return (
    <div className={`${alto} rounded-lg overflow-hidden border border-gray-200`}>
      <MapContainer
        bounds={limites}
        className="w-full h-full"
        zoomControl={false}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          keepBuffer={4}
        />
        <Marker position={CEDIS} icon={iconoCedis}>
          <Popup>CEDIS Laben</Popup>
        </Marker>
        <Marker position={punto} icon={iconoCliente(color)}>
          <Popup>{nombre}</Popup>
        </Marker>
        {camion?.lat && (
          <Marker position={[camion.lat, camion.lng]} icon={iconoCamion}>
            <Popup>
              <b>{camion.placa}</b><br />
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {camion.velocidad_kmh > 2 ? `Circulando a ${camion.velocidad_kmh} km/h` : 'Detenido'}
              </span>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
