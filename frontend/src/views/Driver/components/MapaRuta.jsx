import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Compass, ZoomIn, ZoomOut, Crosshair } from 'lucide-react';
import { CEDIS } from '../../../config/fleet';

/**
 * El mapa de la ruta del chofer.
 *
 * Sigue el mismo patrón que los mapas del dispatcher y de ventas —mismos
 * controles, mismo recálculo de tamaño, misma forma de encuadrar— pero muestra
 * lo único que le importa a quien va manejando: sus paradas numeradas, cuáles
 * ya hizo, y dónde está él ahorita.
 *
 * La rueda del ratón no hace zoom: en el celular no aplica, y en una pantalla
 * que se recorre atraparía el desplazamiento.
 */

const iconoParada = (numero, hecha, esSiguiente) =>
  L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:${hecha ? '#10b981' : esSiguiente ? '#f97316' : '#64748b'};width:${esSiguiente ? 30 : 24}px;height:${esSiguiente ? 30 : 24}px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:${esSiguiente ? 13 : 11}px;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,.35);opacity:${hecha ? 0.5 : 1}">${hecha ? '✓' : numero}</div>`,
    iconSize: esSiguiente ? [30, 30] : [24, 24],
    iconAnchor: esSiguiente ? [15, 15] : [12, 12],
  });

const iconoCamion = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="background:#16a34a;width:30px;height:30px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.4)">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/></svg>
  </div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const iconoCedis = L.divIcon({
  className: '',
  html: '<div style="background:#0f172a;width:20px;height:20px;border-radius:5px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>',
  iconSize: [20, 20],
});

function Encuadrar({ puntos, firma }) {
  const map = useMap();
  useEffect(() => {
    if (!puntos.length) return;
    map.fitBounds(L.latLngBounds(puntos).pad(0.2), { animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, map]);
  return null;
}

// Mismo candado que en los otros mapas: sin él, invalidateSize() se dispara a
// sí mismo en bucle y el mapa parpadea.
function RecalcularTamano() {
  const map = useMap();
  useEffect(() => {
    const contenedor = map.getContainer();
    let ultimo = { w: 0, h: 0 };
    const recalcular = () => {
      const { clientWidth: w, clientHeight: h } = contenedor;
      if (w === ultimo.w && h === ultimo.h) return;
      ultimo = { w, h };
      map.invalidateSize({ debounceMoveend: true });
    };
    recalcular();
    const raf = requestAnimationFrame(recalcular);
    const observer = new ResizeObserver(recalcular);
    observer.observe(contenedor);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [map]);
  return null;
}

function Controles({ siguiente, miPosicion }) {
  const map = useMap();
  const boton = 'bg-white/95 border border-gray-200 shadow-sm active:bg-gray-100 transition flex items-center justify-center text-gray-700';

  return (
    <div className="absolute top-2.5 right-2.5 z-[1000] flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        {/* Los dos atajos que de verdad ocupa quien va manejando. */}
        {siguiente?.lat && (
          <button
            onClick={() => map.setView([siguiente.lat, siguiente.lng], 15, { animate: true })}
            title="Ir a la parada que sigue"
            className={`${boton} gap-1 px-2.5 py-2 rounded-lg text-[10px] font-bold`}
          >
            <Crosshair className="h-3.5 w-3.5 text-orange-500" /> La que sigue
          </button>
        )}
        {miPosicion && (
          <button
            onClick={() => map.setView([miPosicion.lat, miPosicion.lng], 15, { animate: true })}
            title="Centrar donde voy"
            className={`${boton} w-9 h-9 rounded-lg`}
          >
            <Compass className="h-4 w-4 text-green-600" />
          </button>
        )}
      </div>
      <div className="flex flex-col rounded-lg overflow-hidden border border-gray-200 shadow-sm">
        <button onClick={() => map.zoomIn()} className={`${boton} w-9 h-9 border-0 border-b border-gray-200 rounded-none`}>
          <ZoomIn className="h-4 w-4" />
        </button>
        <button onClick={() => map.zoomOut()} className={`${boton} w-9 h-9 border-0 rounded-none`}>
          <ZoomOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function MapaRuta({ paradas, siguiente, miPosicion, alto = 'h-[300px]' }) {
  const conUbicacion = paradas.filter((p) => p.lat && p.lng);
  if (!conUbicacion.length) {
    return (
      <div className={`${alto} rounded-xl border border-gray-200 bg-white flex items-center justify-center`}>
        <p className="text-sm text-gray-400">Tus paradas no tienen ubicación.</p>
      </div>
    );
  }

  const puntos = [CEDIS, ...conUbicacion.map((p) => [p.lat, p.lng])];
  // Sin la posición del camión: cambia cada refresco y reencuadraría el mapa
  // encima del chofer mientras lo está viendo.
  const firma = conUbicacion.map((p) => `${p.id}:${p.estado}`).join(',');

  return (
    <div className={`relative rounded-xl border border-gray-200 overflow-hidden bg-white ${alto}`}>
      <MapContainer center={CEDIS} zoom={11} className="w-full h-full" zoomControl={false} scrollWheelZoom={false}>
        <Encuadrar puntos={puntos} firma={firma} />
        <RecalcularTamano />
        <Controles siguiente={siguiente} miPosicion={miPosicion} />
        <TileLayer
          attribution='&copy; <a href="https://carto.com">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          keepBuffer={3}
        />

        <Marker position={CEDIS} icon={iconoCedis}>
          <Popup>CEDIS Laben</Popup>
        </Marker>

        {conUbicacion.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={iconoParada(
              p.secuencia_ruta,
              ['Entregado', 'Entregado_Parcial', 'No_Entregado'].includes(p.estado),
              siguiente?.id === p.id,
            )}
          >
            <Popup>
              <b>{p.card_name}</b><br />
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Parada {p.secuencia_ruta}{p.eta ? ` · llega ${p.eta}` : ''}
              </span>
            </Popup>
          </Marker>
        ))}

        {miPosicion && (
          <Marker position={[miPosicion.lat, miPosicion.lng]} icon={iconoCamion}>
            <Popup>
              <b>Aquí vas</b><br />
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {miPosicion.velocidad_kmh > 2 ? `${miPosicion.velocidad_kmh} km/h` : 'Detenido'}
              </span>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
