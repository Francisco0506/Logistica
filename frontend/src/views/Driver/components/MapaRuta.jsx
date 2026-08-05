import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Compass, ZoomIn, ZoomOut, Crosshair } from 'lucide-react';
import { CEDIS } from '../../../config/fleet';
import { esVisitada } from '../../../config/estadosRuta';

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

// La parada QUE SIGUE lleva un anillo naranja alrededor, no solo un color
// distinto: es la única del mapa que el chofer tiene que encontrar de un
// vistazo mientras maneja, y el anillo se distingue aunque el mapa vaya lleno
// de puntos o la pantalla esté al sol.
const iconoParada = (numero, hecha, esSiguiente) => {
  const tam = esSiguiente ? 32 : 26;
  const fondo = hecha ? '#10b981' : esSiguiente ? '#EA580C' : '#64748b';
  const anillo = esSiguiente
    ? 'box-shadow:0 0 0 4px rgba(234,88,12,.30),0 2px 8px rgba(0,0,0,.35);'
    : 'box-shadow:0 2px 6px rgba(0,0,0,.35);';
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:${fondo};width:${tam}px;height:${tam}px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:${esSiguiente ? 14 : 12}px;font-weight:900;${anillo}opacity:${hecha ? 0.55 : 1}">${hecha ? '✓' : numero}</div>`,
    iconSize: [tam, tam],
    iconAnchor: [tam / 2, tam / 2],
  });
};

// El camión propio va en el NARANJA DE LABEN (#EA580C), el mismo del logo y el
// del primer camión de la flota.
//
// Estaba en verde, y el verde ya significa "entregado" en toda la app: las
// paradas hechas, las palomitas, las pastillas de estado. La posición del
// propio chofer se leía como una parada ya entregada —dos círculos verdes del
// mismo tamaño en el mismo mapa—, y en la pantalla de un celular a plena luz
// esa diferencia no existe.
//
// Lo que lo separa de la parada "que sigue" (que también es naranja) no es el
// color sino la FORMA: el camión trae el icono de camión y es más grande; las
// paradas traen un número. En una pantalla chica la silueta se distingue antes
// que el tono.
const iconoCamion = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="background:#EA580C;width:34px;height:34px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(234,88,12,.5)">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/></svg>
  </div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

// El CEDIS, con su icono de bodega adentro.
//
// Antes era un cuadro negro VACÍO —sin icono y sin `custom-div-icon`, que es
// la clase que le quita a Leaflet el fondo blanco por default—, así que en el
// mapa aparecía una mancha negra sin explicación junto a Santa Catarina. Los
// mapas del despachador y de ventas sí traían el icono; este se quedó a medias.
const iconoCedis = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="background:#0f172a;width:26px;height:26px;border-radius:6px;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.25)">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-7h6v7"/></svg>
  </div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
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

  // 44 px de lado: es el mínimo que se toca sin fallar con el pulgar, y esta
  // pantalla se usa manejando. Los botones estaban en 36 y el texto en 10 px.
  return (
    <div className="absolute top-2.5 right-2.5 z-[1000] flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {/* Los dos atajos que de verdad ocupa quien va manejando. */}
        {siguiente?.lat && (
          <button
            onClick={() => map.setView([siguiente.lat, siguiente.lng], 15, { animate: true })}
            title="Ir a la parada que sigue"
            className={`${boton} gap-1.5 px-3 h-11 rounded-xl text-[12px] font-extrabold`}
          >
            <Crosshair className="h-4 w-4 text-orange-500" /> La que sigue
          </button>
        )}
        {miPosicion && (
          <button
            onClick={() => map.setView([miPosicion.lat, miPosicion.lng], 15, { animate: true })}
            title="Centrar donde voy"
            className={`${boton} w-11 h-11 rounded-xl`}
          >
            {/* Naranja de Laben, igual que el marcador del camión propio: es
                el mismo concepto ("dónde voy yo"). Estaba en verde, que en
                esta app significa "entregado". */}
            <Compass className="h-5 w-5 text-orange-600" />
          </button>
        )}
      </div>
      <div className="flex flex-col rounded-xl overflow-hidden border border-gray-200 shadow-sm">
        <button onClick={() => map.zoomIn()} aria-label="Acercar" className={`${boton} w-11 h-11 border-0 border-b border-gray-200 rounded-none`}>
          <ZoomIn className="h-5 w-5" />
        </button>
        <button onClick={() => map.zoomOut()} aria-label="Alejar" className={`${boton} w-11 h-11 border-0 rounded-none`}>
          <ZoomOut className="h-5 w-5" />
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
              esVisitada(p.estado),
              siguiente?.id === p.id,
            )}
          >
            <Popup>
              {/* La sucursal, no la razón social — ver la nota en
                  TarjetaParada.jsx. Es la que distingue dos paradas del
                  mismo cliente en el mapa. */}
              <b>{p.ship_to_code || p.card_name}</b><br />
              {p.ship_to_code && (
                <span style={{ fontSize: 11, color: '#64748b' }}>{p.card_name}<br /></span>
              )}
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Parada {p.secuencia_ruta}{p.eta_desde ? ` · llega ${p.eta_desde}-${p.eta_hasta}` : ''}
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
