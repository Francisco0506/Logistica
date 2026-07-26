import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapPin, Minimize2, ZoomIn, ZoomOut, Compass, Truck, X } from 'lucide-react';
import { CEDIS } from '../../../config/fleet';

/**
 * Mapa del panel de ventas.
 *
 * Cada pedido se pinta CON EL COLOR DE SU CAMIÓN y con su número de parada, así
 * que se lee de un vistazo "estos cinco los lleva el mismo camión y el mío es
 * la parada 12". Antes todos eran puntos naranjas iguales y no decían nada.
 *
 * No dibuja rutas: la vendedora no necesita el trazo, necesita poder decirle a
 * su cliente "el camión ya viene, va por Guadalupe".
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

/**
 * Leaflet mide su contenedor UNA sola vez, al crearse, y se queda con esa
 * medida. En una columna flotante que cambia de alto según la lista, se queda
 * chico y deja franjas sin dibujar o parpadea al pasar el ratón.
 *
 * El candado del tamaño es indispensable: invalidateSize() vuelve a pedir las
 * imágenes y puede alterar el contenedor, lo que dispararía al observador otra
 * vez en un bucle que nunca termina de redibujar.
 */
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

function Controles({ pantallaCompleta, onTogglePantalla }) {
  const map = useMap();

  useEffect(() => {
    if (!pantallaCompleta) return;
    const alPresionar = (e) => { if (e.key === 'Escape') onTogglePantalla(); };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [pantallaCompleta, onTogglePantalla]);

  const boton = 'bg-white/95 border border-gray-200 shadow-sm hover:bg-gray-50 transition flex items-center justify-center text-gray-700';

  // z-[1000]: Leaflet dibuja sus capas hasta 700, así que con menos los
  // controles quedan debajo de los marcadores.
  return (
    <div className="absolute top-2.5 right-2.5 z-[1000] flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <button onClick={() => map.setView(CEDIS, 12, { animate: true })} title="Centrar en el CEDIS" className={`${boton} gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold`}>
          <Compass className="h-3.5 w-3.5 text-orange-500" /> CEDIS
        </button>
        <button onClick={onTogglePantalla} title="Cerrar el mapa (Esc)" className={`${boton} w-7 h-7 rounded-lg`}>
          <Minimize2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col rounded-lg overflow-hidden border border-gray-200 shadow-sm">
        <button onClick={() => map.zoomIn()} title="Acercar" className={`${boton} w-7 h-7 border-0 border-b border-gray-200 rounded-none`}>
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => map.zoomOut()} title="Alejar" className={`${boton} w-7 h-7 border-0 rounded-none`}>
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function MapaPedidos({
  pedidos,
  camionesGPS,
  colorDe,
  pantallaCompleta = false,
  onTogglePantalla,
}) {
  const conUbicacion = pedidos.filter((p) => p.lat && p.lng);
  const sinUbicacion = pedidos.length - conUbicacion.length;

  const misPlacas = [...new Set(pedidos.map((p) => p.camion).filter(Boolean))].sort();
  const misCamiones = camionesGPS.filter((c) => misPlacas.includes(c.placa));
  const entregados = pedidos.filter((p) => p.estado === 'Entregado').length;

  const puntos = [
    CEDIS,
    ...conUbicacion.map((p) => [p.lat, p.lng]),
    ...misCamiones.map((c) => [c.lat, c.lng]),
  ];

  const contenedor = pantallaCompleta
    ? 'fixed inset-0 z-[2500] bg-white flex flex-col'
    : 'bg-white rounded-xl border border-gray-200 overflow-hidden';

  if (!conUbicacion.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 h-[420px] flex items-center justify-center">
        <p className="text-sm text-gray-400">Sin pedidos que ubicar en el mapa.</p>
      </div>
    );
  }

  return (
    <div className={contenedor}>
      {/* Cabecera: qué se está viendo, en números. Antes solo había una tira de
          colores sin contexto — no decía cuántas paradas eran ni cuántas ya se
          habían hecho, que es lo primero que se quiere saber. */}
      <div className="px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <MapPin className="w-3.5 h-3.5 text-orange-500 self-center" />
          <span className="text-[13px] font-extrabold text-gray-800">
            {conUbicacion.length} {conUbicacion.length === 1 ? 'parada' : 'paradas'}
          </span>
          {entregados > 0 && (
            <span className="text-[11px] font-bold text-emerald-600">{entregados} entregadas</span>
          )}
          {sinUbicacion > 0 && (
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
              {sinUbicacion} sin ubicación
            </span>
          )}

          {pantallaCompleta && (
            <button
              onClick={onTogglePantalla}
              className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-2.5 py-1.5 transition"
            >
              <X className="w-3.5 h-3.5" /> Cerrar mapa
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap mt-1.5">
          {misPlacas.map((placa) => {
            const n = pedidos.filter((p) => p.camion === placa).length;
            const enVivo = misCamiones.some((c) => c.placa === placa);
            return (
              <span key={placa} className="flex items-center gap-1.5 text-[10px] font-bold text-gray-600">
                <span className="w-2.5 h-2.5 rounded-full border border-white shadow-sm" style={{ backgroundColor: colorDe(placa) }} />
                {placa}
                <span className="text-gray-400 font-semibold">{n}</span>
                {enVivo && <Truck className="w-2.5 h-2.5 text-green-600" title="Reportando posición" />}
              </span>
            );
          })}
          {!misPlacas.length && (
            <span className="text-[10px] font-semibold text-gray-400">Todavía sin camión asignado</span>
          )}
        </div>
      </div>

      <div className={`relative ${pantallaCompleta ? 'flex-1' : 'h-[460px]'}`}>
        <MapContainer
          key={pantallaCompleta ? 'completa' : 'normal'}
          center={CEDIS}
          zoom={11}
          className="w-full h-full"
          zoomControl={false}
          scrollWheelZoom={pantallaCompleta}
        >
          <Encuadrar puntos={puntos} firma={JSON.stringify(puntos)} />
          <RecalcularTamano />
          <Controles pantallaCompleta={pantallaCompleta} onTogglePantalla={onTogglePantalla} />
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
                    {p.estado === 'Entregado' ? 'Llegó' : 'Llega'} entre {p.eta_desde} y {p.eta_hasta}
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
