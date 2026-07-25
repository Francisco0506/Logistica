import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Compass, X } from 'lucide-react';
import { CEDIS } from '../../../config/fleet';

// ── Iconos de Leaflet ──
// Vienen de un CDN externo: si algún día se bloquea, los pines dejan de verse.
// Está anotado en docs/pendientes.md para traerlos al proyecto.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Marcador de ubicación GPS real (Samsara): verde con un puntito "en vivo".
// Es el ÚNICO marcador de camión en el mapa — las posiciones inventadas junto
// al CEDIS se eliminaron, la única posición que se muestra es la real.
const iconoGPS = (enMovimiento) =>
  L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="position:relative;background:#16a34a;width:26px;height:26px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.3)">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/></svg>
      ${enMovimiento ? '<div style="position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#22c55e;border:2px solid #fff"></div>' : ''}
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

// Una parada ya entregada se apaga: se ve que ese pedido ya está hecho y el
// color fuerte queda para lo que todavía falta.
const iconoParada = (color, numero, entregada) =>
  L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:${color};width:24px;height:24px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,0.35);opacity:${entregada ? 0.35 : 1}">${numero}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

const iconoCedis = L.divIcon({
  className: '',
  html: '<div style="background:#0f172a;width:26px;height:26px;border-radius:6px;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.2)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></div>',
  iconSize: [26, 26],
});

function CentrarMapa({ coords }) {
  const map = useMap();
  useEffect(() => { map.setView(coords, 13, { animate: true }); }, [coords, map]);
  return null;
}

// Leaflet mide su contenedor UNA vez, al crearse, y se queda con esa medida.
// Si la página todavía estaba acomodándose en ese momento (que es lo que pasa
// con el mapa dentro de una rejilla y en posición flotante), se queda chico y
// deja una franja en blanco a la derecha y abajo, porque no pide las imágenes
// del mapa que faltan para cubrir el hueco.
//
// Se corrige por partida triple: se recalcula en cuanto monta, otra vez en el
// siguiente cuadro de animación (ya con la rejilla resuelta) y de ahí en
// adelante cada vez que el contenedor cambie de tamaño, sin importar por qué.
function RecalcularTamano() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const raf = requestAnimationFrame(() => map.invalidateSize());
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [map]);
  return null;
}

/**
 * El mapa del despachador: CEDIS, camiones en vivo (GPS real de Samsara),
 * y la ruta de cada camión activo con sus paradas numeradas.
 *
 * `rutasOsrm` trae la geometría por calle real. Cuando falta (el servidor OSRM
 * no respondió), se cae a unir las paradas con líneas rectas — se avisa en la
 * leyenda, porque una recta en el mapa NO es el camino que va a hacer el camión.
 */
export default function MapaRutas({
  camionesActivos,
  paradasDe,
  rutasOsrm,
  camionesGPS,
  rutasGeneradas,
  coordsEnfocadas,
  onEnfocarCedis,
  mensajeEstado,
  alto = 'h-[70vh]',
  acciones = null,
  pantallaCompleta = false,
  placasSeleccionadas = [],
  onLimpiarSeleccion,
  estadoRutaDe = () => null,
}) {
  // Al abrir un camión en la lista, el mapa se queda solo con su ruta. Con cinco
  // rutas encimadas no se alcanza a seguir ninguna: se cruzan por las mismas
  // avenidas y los números de parada se amontonan. Si no hay ninguno abierto,
  // se ven todas.
  const hayFiltro = placasSeleccionadas.length > 0;
  const camionesDibujados = hayFiltro
    ? camionesActivos.filter((c) => placasSeleccionadas.includes(c.id))
    : camionesActivos;

  const hayRutasEnRecta = rutasGeneradas && camionesDibujados.some(
    (c) => paradasDe(c.id).length > 0 && !rutasOsrm[c.id]
  );

  return (
    <div className={
      pantallaCompleta
        // Pantalla completa de verdad: encima de todo y del tamaño de la
        // ventana, para revisar un día completo sin nada alrededor.
        ? 'fixed inset-0 z-[2500] bg-white'
        : `relative rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm ${alto}`
    }>
      <div className="absolute top-3 right-3 z-[400] flex items-center gap-1.5">
        {acciones}
        <button
          onClick={onEnfocarCedis}
          className="bg-white/95 border border-gray-200 px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 text-[11px] font-bold text-gray-700 hover:bg-gray-50 transition"
        >
          <Compass className="h-3.5 w-3.5 text-orange-600" /> CEDIS
        </button>
      </div>

      <div className="absolute top-3 left-3 z-[400] space-y-2 max-w-[320px]">
        {/* Qué se está viendo, y cómo volver a verlas todas. */}
        {hayFiltro && (
          <div className="bg-white border border-gray-200 shadow-sm rounded-lg px-3 py-1.5 flex items-center gap-2">
            <span className="text-[11px] font-bold text-gray-700">
              Solo {placasSeleccionadas.join(', ')}
            </span>
            <button
              onClick={onLimpiarSeleccion}
              title="Ver todas las rutas"
              className="text-gray-400 hover:text-gray-700 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Aviso honesto: si la ruta se dibujó en recta, el mapa NO está
            mostrando el camino real y no se debe medir nada sobre él. */}
        {hayRutasEnRecta && (
          <div className="bg-amber-50 border border-amber-300 px-3 py-2 rounded-lg shadow-sm">
            <p className="text-[10px] font-bold text-amber-800">Rutas dibujadas en línea recta</p>
            <p className="text-[10px] text-amber-700 leading-snug mt-0.5">
              El servidor de rutas no respondió. Las líneas no son el camino real del camión.
            </p>
          </div>
        )}
      </div>

      <div className="absolute bottom-3 left-3 z-[400] bg-white/90 border border-gray-200 px-3 py-1.5 rounded-lg shadow-sm text-[10px] font-semibold text-gray-500 max-w-[260px]">
        {mensajeEstado}
      </div>

      <MapContainer center={CEDIS} zoom={13} className="w-full h-full" zoomControl={false}>
        <CentrarMapa coords={coordsEnfocadas} />
        <RecalcularTamano />
        <TileLayer
          attribution='&copy; <a href="https://carto.com">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />

        <Marker position={CEDIS} icon={iconoCedis}>
          <Popup><b>CEDIS Laben</b><br /><span style={{ fontSize: 11, color: '#64748b' }}>Salida de Embarques</span></Popup>
        </Marker>

        {camionesGPS.map((c) => (
          <Marker key={`gps-${c.placa}`} position={[c.lat, c.lng]} icon={iconoGPS(c.velocidad_kmh > 2)}>
            <Popup>
              <b>{c.nombre_samsara}</b> — {c.placa} <span style={{ color: '#16a34a' }}>● GPS real</span><br />
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {c.velocidad_kmh > 2 ? `${c.velocidad_kmh} km/h` : 'Detenido'} · {c.direccion}
              </span>
            </Popup>
          </Marker>
        ))}

        {rutasGeneradas && camionesDibujados.map((camion) => {
          const paradas = paradasDe(camion.id).filter((o) => o.lat && o.lng);
          if (!paradas.length) return null;
          const puntos = paradas.map((o) => [o.lat, o.lng]);
          const geometria = rutasOsrm[camion.id];
          const posiciones = geometria || [CEDIS, ...puntos, CEDIS];

          // El camión que ya salió lleva la línea más tenue: lo que se está
          // decidiendo son las rutas que todavía se pueden cambiar, y esa ya
          // está en la calle. Se sigue viendo, pero deja de competir por
          // atención con las que sí se están armando.
          const yaSalio = estadoRutaDe(camion.id) === 'En_Ruta' || estadoRutaDe(camion.id) === 'Finalizada';
          const opacidad = yaSalio ? 0.45 : 1;

          return (
            <React.Fragment key={`r-${camion.id}`}>
              {/* Borde blanco debajo + línea de color encima = efecto "tubo" limpio. */}
              <Polyline positions={posiciones} pathOptions={{ color: '#fff', weight: 8, opacity: 0.9 * opacidad }} />
              <Polyline
                positions={posiciones}
                pathOptions={{
                  color: camion.color,
                  weight: 4,
                  opacity: opacidad,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              {paradas.map((o, i) => (
                <Marker
                  key={`s-${camion.id}-${i}`}
                  position={[o.lat, o.lng]}
                  icon={iconoParada(camion.color, i + 1, o.estado === 'Entregado')}
                >
                  {/* Cada ruta numera desde 1, así que varios círculos "1" cercanos
                      son normales — el popup aclara a qué camión pertenece. */}
                  <Popup>
                    <b>{camion.id}</b> — Parada {i + 1}<br />
                    <span style={{ fontSize: 11, color: '#64748b' }}>#{o.doc_num} {o.card_name}</span>
                    {o.eta && <><br /><span style={{ fontSize: 11, color: '#64748b' }}>Llega {o.eta}</span></>}
                    {o.ventana && <><br /><span style={{ fontSize: 11, color: '#64748b' }}>Recibe {o.ventana}</span></>}
                  </Popup>
                </Marker>
              ))}
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}
