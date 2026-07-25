import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { CEDIS } from '../../../config/fleet';

/**
 * Mapa del panel de ventas: dónde están los clientes de ESTA vendedora y dónde
 * va ahorita el camión que lleva sus pedidos (GPS real de Samsara).
 *
 * Es solo para ubicar: no dibuja rutas. La vendedora no necesita el trazo —
 * necesita poder decirle a su cliente "el camión ya viene, va por Guadalupe".
 *
 * Solo se muestran los camiones que llevan pedidos suyos, no toda la flota.
 */

const COLOR_ESTADO = {
  Entregado: '#10b981',
  En_Camino: '#3b82f6',
  Asignado: '#f97316',
  Pendiente: '#94a3b8',
};

const iconoCliente = (estado) =>
  L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:${COLOR_ESTADO[estado] || COLOR_ESTADO.Pendiente};width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.3)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

const iconoCamion = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="position:relative;background:#16a34a;width:28px;height:28px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.35)">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/></svg>
  </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const iconoCedis = L.divIcon({
  className: '',
  html: '<div style="background:#0f172a;width:22px;height:22px;border-radius:5px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>',
  iconSize: [22, 22],
});

// Encuadra el mapa para que se vean todos los pedidos sin tener que arrastrar.
// La firma es el texto de los puntos: así solo se reencuadra cuando cambian de
// verdad, y no en cada refresco de 30 s que devuelve las mismas posiciones —
// si no, el mapa da un brinco mientras la vendedora lo está viendo.
function Encuadrar({ puntos, firma }) {
  const map = useMap();
  useEffect(() => {
    if (!puntos.length) return;
    map.fitBounds(L.latLngBounds(puntos).pad(0.2), { animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, map]);
  return null;
}

export default function MapaPedidos({ pedidos, camionesGPS }) {
  const conUbicacion = pedidos.filter((p) => p.lat && p.lng);
  const sinUbicacion = pedidos.length - conUbicacion.length;

  // Solo los camiones que llevan pedidos de esta vendedora.
  const misPlacas = new Set(pedidos.map((p) => p.camion).filter(Boolean));
  const misCamiones = camionesGPS.filter((c) => misPlacas.has(c.placa));

  const puntos = [
    CEDIS,
    ...conUbicacion.map((p) => [p.lat, p.lng]),
    ...misCamiones.map((c) => [c.lat, c.lng]),
  ];

  if (!conUbicacion.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 h-[320px] flex items-center justify-center">
        <p className="text-sm text-slate-400">Sin pedidos que ubicar en el mapa.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-[10px] font-semibold text-slate-500 flex-wrap">
          {[
            ['En camino', COLOR_ESTADO.En_Camino],
            ['Programado', COLOR_ESTADO.Asignado],
            ['Entregado', COLOR_ESTADO.Entregado],
            ['Sin programar', COLOR_ESTADO.Pendiente],
          ].map(([texto, color]) => (
            <span key={texto} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full border border-white shadow-sm" style={{ backgroundColor: color }} />
              {texto}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-green-600 border border-white shadow-sm" /> Camión en vivo
          </span>
        </div>
        {sinUbicacion > 0 && (
          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
            {sinUbicacion} sin ubicación en SAP
          </span>
        )}
      </div>

      <div className="h-[340px]">
        <MapContainer center={CEDIS} zoom={11} className="w-full h-full" zoomControl={false}>
          <Encuadrar puntos={puntos} firma={JSON.stringify(puntos)} />
          <TileLayer
            attribution='&copy; <a href="https://carto.com">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          <Marker position={CEDIS} icon={iconoCedis}>
            <Popup><b>CEDIS Laben</b><br /><span style={{ fontSize: 11, color: '#64748b' }}>De aquí salen los camiones</span></Popup>
          </Marker>

          {conUbicacion.map((p) => (
            <Marker key={p.id} position={[p.lat, p.lng]} icon={iconoCliente(p.estado)}>
              <Popup>
                <b>{p.card_name}</b><br />
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  #{p.doc_num} · {p.situacion}
                </span>
              </Popup>
            </Marker>
          ))}

          {misCamiones.map((c) => (
            <Marker key={`gps-${c.placa}`} position={[c.lat, c.lng]} icon={iconoCamion}>
              <Popup>
                <b>Camión {c.placa}</b> <span style={{ color: '#16a34a' }}>● en vivo</span><br />
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  {c.velocidad_kmh > 2 ? `Circulando a ${c.velocidad_kmh} km/h` : 'Detenido'}
                  {c.direccion ? ` · ${c.direccion}` : ''}
                </span>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
