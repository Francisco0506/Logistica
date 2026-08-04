import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Compass, X, ZoomIn, ZoomOut, Maximize2, Minimize2 } from 'lucide-react';
import { CEDIS } from '../../../config/fleet';
import { ESTILO_ENTREGA, esVisitada, salioMal } from '../../../config/estadosRuta';

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
    html: `<div style="background:${color};width:24px;height:24px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:11px;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,0.35);opacity:${entregada ? 0.35 : 1}">${numero}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

const iconoCedis = L.divIcon({
  className: '',
  html: '<div style="background:#0f172a;width:26px;height:26px;border-radius:6px;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.2)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></div>',
  iconSize: [26, 26],
});

// `token` cambia en CADA petición de centrado, aunque sea al mismo punto.
// Antes el efecto dependía del arreglo de coordenadas: como el CEDIS es una
// constante, la segunda vez que se apretaba el botón el arreglo era el mismo
// objeto, React no veía cambio y el mapa se quedaba donde estaba. Por eso el
// botón de CEDIS "no servía" salvo la primera vez.
function CentrarMapa({ coords, token }) {
  const map = useMap();
  useEffect(() => {
    if (coords?.[0] && coords?.[1]) map.setView(coords, 14, { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return null;
}

/**
 * Los controles del mapa, encima de él.
 *
 * El zoom va con botones y NO con la rueda del ratón: la página se recorre
 * hacia abajo, y un mapa que atrapa la rueda deja al usuario clavado en cuanto
 * pasa el cursor por encima. Se puede seguir usando la rueda manteniendo Ctrl,
 * que es el gesto que ya usa todo el mundo en mapas embebidos.
 */
function ControlesMapa({ onEnfocarCedis, pantallaCompleta, onTogglePantallaCompleta }) {
  const map = useMap();
  const [pista, setPista] = React.useState(false);

  useEffect(() => {
    if (!pantallaCompleta) return;
    const alPresionar = (e) => { if (e.key === 'Escape') onTogglePantallaCompleta(); };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [pantallaCompleta, onTogglePantallaCompleta]);

  // Zoom con la rueda SIN quitarle el scroll a la página: manteniendo Ctrl
  // (o Cmd en Mac) la rueda hace zoom; sin Ctrl, la página baja normal. Es el
  // mismo trato que hacen los mapas embebidos, y la primera vez que alguien
  // gira la rueda sobre el mapa se le dice, porque si no nadie lo adivina.
  useEffect(() => {
    if (pantallaCompleta) return; // ahí la rueda ya hace zoom directo
    const contenedor = map.getContainer();
    let temporizador;

    const alGirar = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) map.zoomIn(1);
        else map.zoomOut(1);
        return;
      }
      setPista(true);
      clearTimeout(temporizador);
      temporizador = setTimeout(() => setPista(false), 1600);
    };

    contenedor.addEventListener('wheel', alGirar, { passive: false });
    return () => { contenedor.removeEventListener('wheel', alGirar); clearTimeout(temporizador); };
  }, [map, pantallaCompleta]);

  const boton = 'bg-white/95 border border-gray-200 shadow-sm hover:bg-gray-50 transition flex items-center justify-center text-gray-700';

  // z-[1000]: Leaflet dibuja sus capas hasta z-index 700 (líneas en 400,
  // marcadores en 600, popups en 700). Con z-400 los controles quedaban DEBAJO
  // de las rutas y se perdían justo cuando el mapa tenía trazos encima.
  return (
    <>
      {/* Aviso pasajero cuando alguien gira la rueda sobre el mapa esperando
          hacer zoom. Sin él, la regla de Ctrl no se descubre nunca. */}
      {pista && (
        <div className="absolute inset-0 z-[999] flex items-center justify-center pointer-events-none">
          <div className="bg-gray-900/80 text-white text-sm font-semibold px-4 py-2.5 rounded-lg shadow-lg">
            Usa <kbd className="bg-white/20 rounded px-1.5 py-0.5 mx-0.5">Ctrl</kbd> + rueda para hacer zoom
          </div>
        </div>
      )}

      <div className="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2">
      <div className="flex items-center gap-1.5">
        <button
          onClick={onEnfocarCedis}
          title="Centrar el mapa en el CEDIS"
          className={`${boton} gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold`}
        >
          <Compass className="h-3.5 w-3.5 text-orange-500" /> CEDIS
        </button>
        <button
          onClick={onTogglePantallaCompleta}
          title={pantallaCompleta ? 'Salir de pantalla completa (Esc)' : 'Ver el mapa en pantalla completa'}
          className={`${boton} w-8 h-8 rounded-lg`}
        >
          {pantallaCompleta ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex flex-col rounded-lg overflow-hidden border border-gray-200 shadow-sm">
        <button onClick={() => map.zoomIn()} title="Acercar" className={`${boton} w-8 h-8 border-0 border-b border-gray-200 rounded-none`}>
          <ZoomIn className="h-4 w-4" />
        </button>
        <button onClick={() => map.zoomOut()} title="Alejar" className={`${boton} w-8 h-8 border-0 rounded-none`}>
          <ZoomOut className="h-4 w-4" />
        </button>
        </div>
      </div>
    </>
  );
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
    const contenedor = map.getContainer();
    let ultimo = { w: 0, h: 0 };

    const recalcular = () => {
      const { clientWidth: w, clientHeight: h } = contenedor;
      // Solo si de verdad cambió de tamaño. invalidateSize() vuelve a pedir las
      // imágenes del mapa, y como él mismo puede alterar el contenedor, sin
      // este candado el observador se dispara a sí mismo en bucle: el mapa
      // parpadea en blanco mientras el ratón está encima porque nunca termina
      // de redibujar.
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
  pantallaCompleta = false,
  onTogglePantallaCompleta,
  placasSeleccionadas = [],
  onLimpiarSeleccion,
  onAlternarCamion,
  estadoRutaDe = () => null,
  tokenEnfoque = 0,
}) {
  // Al abrir un camión en la lista, el mapa se queda solo con su ruta. Con cinco
  // rutas encimadas no se alcanza a seguir ninguna: se cruzan por las mismas
  // avenidas y los números de parada se amontonan. Si no hay ninguno abierto,
  // se ven todas.
  const hayFiltro = placasSeleccionadas.length > 0;
  const camionesDibujados = hayFiltro
    ? camionesActivos.filter((c) => placasSeleccionadas.includes(c.id))
    : camionesActivos;

  // Solo los camiones que de verdad traen paradas hoy.
  const camionesConRuta = camionesActivos.filter((c) => paradasDe(c.id).length > 0);

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
      <div className="absolute top-3 left-3 z-[1000] space-y-2 max-w-[60%]">
        {/* Los camiones, sobre el mapa: se puede aislar una ruta sin salir de
            aquí, que hacía falta sobre todo en pantalla completa, donde la
            lista de la derecha no se ve. Solo salen los que TIENEN ruta: un
            camión activo pero sin paradas no pinta nada en el mapa. */}
        {rutasGeneradas && !!camionesConRuta.length && (
          <div className="bg-white/95 backdrop-blur border border-gray-200 shadow-sm rounded-lg px-2 py-1.5 flex items-center gap-1.5 flex-wrap">
            {camionesConRuta.map((c) => {
              const encendida = !hayFiltro || placasSeleccionadas.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => onAlternarCamion?.(c.id)}
                  title={`${paradasDe(c.id).length} paradas · ${estadoRutaDe(c.id) || 'sin ruta'}`}
                  className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 transition ${
                    encendida ? 'hover:bg-gray-100' : 'opacity-35 hover:opacity-70'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                  <span className="text-[11px] font-bold text-gray-700">{c.id}</span>
                  <span className="text-[10px] text-gray-400">{paradasDe(c.id).length}</span>
                </button>
              );
            })}
            {hayFiltro && (
              <button
                onClick={onLimpiarSeleccion}
                title="Ver todas las rutas"
                className="flex items-center gap-1 text-[10px] font-bold text-orange-600 hover:text-orange-700 px-1.5 py-1"
              >
                <X className="w-3 h-3" /> Ver todas
              </button>
            )}
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

      {/* La rueda hace zoom SOLO en pantalla completa, donde no hay página que
          recorrer. Dentro de la página va apagada: si no, al pasar el cursor
          por encima el mapa atrapa la rueda y ya no se puede bajar. Fuera de
          pantalla completa el zoom va con los botones o con Ctrl + rueda. */}
      <MapContainer
        key={pantallaCompleta ? 'completa' : 'normal'}
        center={CEDIS}
        zoom={13}
        className="w-full h-full"
        zoomControl={false}
        scrollWheelZoom={pantallaCompleta}
      >
        <CentrarMapa coords={coordsEnfocadas} token={tokenEnfoque} />
        <RecalcularTamano />
        <ControlesMapa
          onEnfocarCedis={onEnfocarCedis}
          pantallaCompleta={pantallaCompleta}
          onTogglePantallaCompleta={onTogglePantallaCompleta}
        />
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
                  key={`s-${camion.id}-${o.id ?? i}`}
                  position={[o.lat, o.lng]}
                  // El número sale de `secuencia_ruta`, NO del índice del arreglo.
                  //
                  // Era `i + 1`, y sobre un arreglo ya filtrado por coordenadas
                  // (arriba: `.filter(o => o.lat && o.lng)`). Bastaba que una
                  // parada viniera sin coordenada para que el mapa la saltara y
                  // corriera un número TODAS las siguientes: la tarjeta del
                  // camión y el celular del chofer decían "6" donde el mapa
                  // decía "5". Es justo la llamada de "voy en la 7 / aquí la 7
                  // es otra" que este sistema viene a quitar.
                  //
                  // Y se atenúa por VISITADA, no por `=== 'Entregado'`: una
                  // parada donde el camión pasó y no pudo entregar seguía
                  // pintada a color pleno, idéntica a una pendiente.
                  icon={iconoParada(camion.color, o.secuencia_ruta ?? i + 1, esVisitada(o.estado))}
                >
                  {/* Cada ruta numera desde 1, así que varios círculos "1" cercanos
                      son normales — el popup aclara a qué camión pertenece. */}
                  <Popup>
                    <b>{camion.id}</b> — Parada {o.secuencia_ruta ?? i + 1}
                    {salioMal(o.estado) && (
                      <> · <span style={{ color: ESTILO_ENTREGA[o.estado].color, fontWeight: 700 }}>
                        {ESTILO_ENTREGA[o.estado].corto}
                      </span></>
                    )}
                    <br />
                    <span style={{ fontSize: 11, color: '#64748b' }}>#{o.doc_num} {o.card_name}</span>
                    {o.eta_desde && <><br /><span style={{ fontSize: 11, color: '#64748b' }}>Llega entre {o.eta_desde} y {o.eta_hasta}</span></>}
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
