import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { CEDIS } from '../../../config/fleet';

/**
 * Mapa del panel de ventas.
 *
 * Cada pedido se pinta CON EL COLOR DE SU CAMIÓN y con su número de parada.
 * Antes todos eran puntos naranjas iguales, que no decían nada: con 80 pedidos
 * en pantalla no se distinguía qué iba junto con qué ni en qué orden. Ahora se
 * lee de un vistazo "estos cinco los lleva el mismo camión, y el mío es la
 * parada 12".
 *
 * Los ya entregados van apagados, y el camión en vivo (GPS de Samsara) va en
 * verde encima de todo. No dibuja rutas: la vendedora no necesita el trazo,
 * necesita poder decirle a su cliente "el camión ya viene, va por Guadalupe".
 */

const GRIS = '#94a3b8';

const iconoParada = (color, numero, entregado) =>
  L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:${color};width:22px;height:22px;border-radius:50%;border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:800;box-shadow:0 2px 5px rgba(0,0,0,.3);opacity:${entregado ? 0.35 : 1}">${numero ?? ''}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const iconoCamion = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="background:#16a34a;width:28px;height:28px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.35)">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/></svg>
  </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const iconoCedis = L.divIcon({
  className: '',
  html: '<div style="background:#0f172a;width:20px;height:20px;border-radius:5px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>',
  iconSize: [20, 20],
});

// Encuadra el mapa. La firma es el texto de los puntos: así solo se reencuadra
// cuando cambian de verdad, y no en cada refresco que devuelve lo mismo — si
// no, el mapa da un brinco mientras la vendedora lo está viendo.
function Encuadrar({ puntos, firma }) {
  const map = useMap();
  useEffect(() => {
    if (!puntos.length) return;
    map.fitBounds(L.latLngBounds(puntos).pad(0.2), { animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, map]);
  return null;
}

export default function MapaPedidos({ pedidos, camionesGPS, colorDe, alto = 'h-[440px]' }) {
  const conUbicacion = pedidos.filter((p) => p.lat && p.lng);
  const sinUbicacion = pedidos.length - conUbicacion.length;

  // Solo los camiones que llevan pedidos de esta vendedora.
  const misPlacas = [...new Set(pedidos.map((p) => p.camion).filter(Boolean))].sort();
  const misCamiones = camionesGPS.filter((c) => misPlacas.includes(c.placa));

  const puntos = [
    CEDIS,
    ...conUbicacion.map((p) => [p.lat, p.lng]),
    ...misCamiones.map((c) => [c.lat, c.lng]),
  ];

  if (!conUbicacion.length) {
    return (
      <div className={`bg-white rounded-xl border border-gray-200 ${alto} flex items-center justify-center`}>
        <p className="text-sm text-gray-400">Sin pedidos que ubicar en el mapa.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* La leyenda son los CAMIONES, que es lo que distingue un punto de otro.
          Antes eran los estados, y con todos los pedidos programados salían
          todos del mismo color naranja. */}
      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2.5 flex-wrap">
        {misPlacas.map((placa) => (
          <span key={placa} className="flex items-center gap-1.5 text-[10px] font-bold text-gray-600">
            <span className="w-2.5 h-2.5 rounded-full border border-white shadow-sm" style={{ backgroundColor: colorDe(placa) }} />
            {placa}
          </span>
        ))}
        {!misPlacas.length && (
          <span className="text-[10px] font-semibold text-gray-400">Todavía sin camión asignado</span>
        )}
        {sinUbicacion > 0 && (
          <span className="ml-auto text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
            {sinUbicacion} sin ubicación
          </span>
        )}
      </div>

      <div className={alto}>
        <MapContainer center={CEDIS} zoom={11} className="w-full h-full" zoomControl={false} scrollWheelZoom={false}>
          <Encuadrar puntos={puntos} firma={JSON.stringify(puntos)} />
          <TileLayer
            attribution='&copy; <a href="https://carto.com">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            keepBuffer={3}
          />

          <Marker position={CEDIS} icon={iconoCedis}>
            <Popup><b>CEDIS Laben</b><br /><span style={{ fontSize: 11, color: '#64748b' }}>De aquí salen los camiones</span></Popup>
          </Marker>

          {conUbicacion.map((p) => (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              icon={iconoParada(p.camion ? colorDe(p.camion) : GRIS, p.posicion, p.estado === 'Entregado')}
            >
              <Popup>
                <b>{p.card_name}</b><br />
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  #{p.doc_num}
                  {p.camion && p.posicion ? ` · ${p.camion}, parada ${p.posicion}` : ''}
                </span>
                {p.eta_desde && (
                  <><br /><span style={{ fontSize: 11, color: '#64748b' }}>
                    Llega entre {p.eta_desde} y {p.eta_hasta}
                  </span></>
                )}
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
