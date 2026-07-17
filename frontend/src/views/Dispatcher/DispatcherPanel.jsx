import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Truck, RefreshCw, Sliders, Search, Compass, AlertCircle, Eye, Package, FileText, Download, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, MapPin, User, Clock, Play, Check, Loader, Menu, X, FlaskConical } from 'lucide-react';
import { CEDIS, FLEET, DRIVERS, ID_TO_PLATE } from '../../config/fleet';
import { syncSAP, getRemisiones, getRutas, getAlertas, generarRutas, updateRutaEstado, getSugerencias, asignarManual, cargarPruebaPedidos, getCamionesGPS } from '../../services/api';

// Cada cuánto se refresca la vista para traer lo más nuevo (pedidos nuevos de
// SAP, cambios de estado de otros usuarios) sin que el dispatcher tenga que
// recargar la página manualmente.
const REFRESH_INTERVAL_MS = 45_000;
// La ruta que dibuja el mapa evita autopistas de cuota (mismo criterio que el
// optimizador en el backend), para no cruzar casetas visualmente ni en la práctica.
const OSRM_EXCLUDE = 'motorway';

// ── Leaflet defaults ──
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const createTruckIcon = (color, isActive) =>
  L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:${isActive ? color : '#cbd5e1'};width:30px;height:30px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.25)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/></svg></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

// Marcador de ubicación GPS real (Samsara), distinto del de la flota del
// dispatcher: verde con un puntito "en vivo" para no confundirlo con las
// posiciones fijas/manuales de `trucks`.
const createGPSIcon = (moving) =>
  L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="position:relative;background:#16a34a;width:26px;height:26px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.3)">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/></svg>
      ${moving ? '<div style="position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#22c55e;border:2px solid #fff"></div>' : ''}
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

// Fecha dinámica del sistema, en hora LOCAL (no UTC: toISOString() se
// adelanta de día después de las 6pm en México y rompe la sincronización).
const getToday = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

function MapUpdater({ coords }) {
  const map = useMap();
  useEffect(() => { map.setView(coords, 13, { animate: true }); }, [coords]);
  return null;
}

// Leaflet no se entera cuando el contenedor cambia de tamaño por CSS (al
// colapsar el panel izquierdo), así que hay que decirle explícitamente que
// recalcule su tamaño una vez termine la transición (duration-300 → 320ms).
function MapResizeHandler({ isPanelOpen }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 320);
    return () => clearTimeout(t);
  }, [isPanelOpen, map]);
  return null;
}

// ── Component ──
export default function DispatcherPanel() {
  const [trucks, setTrucks]             = useState(FLEET.map(t => ({ ...t, active: true })));
  const [routesGenerated, setRoutesGenerated] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [searchQuery, setSearchQuery]   = useState('');
  const [focusedCoords, setFocusedCoords] = useState(CEDIS);
  const [expandedTruck, setExpandedTruck] = useState(null);
  const [orders, setOrders]             = useState([]);
  const [rutas, setRutas]               = useState([]);
  const [syncStatus, setSyncStatus]     = useState('Conectando…');
  const [orderFilter, setOrderFilter]   = useState('todos');
  const [orderSearch, setOrderSearch]   = useState('');
  const [activeTab, setActiveTab]       = useState('pedidos');
  const [isPanelOpen, setIsPanelOpen]   = useState(true);
  const [osrmRoutes, setOsrmRoutes]     = useState({});
  const [osrmCache, setOsrmCache]       = useState({}); // signature de puntos → geometría, evita refetch
  const [alertas, setAlertas]           = useState([]);
  const [sidebarTab, setSidebarTab]     = useState('camiones'); // 'camiones' | 'alertas' — pestañas del sidebar, en vez de dos secciones apiladas
  const [alertaAbierta, setAlertaAbierta] = useState(null); // id de la remisión con el panel de sugerencias abierto
  const [sugerencias, setSugerencias]   = useState(null);   // respuesta de getSugerencias para alertaAbierta
  const [cargandoSugerencias, setCargandoSugerencias] = useState(false);
  const [asignando, setAsignando]       = useState(null);   // ruta_id que se está confirmando, para deshabilitar el botón
  const [confirmacion, setConfirmacion] = useState(null);   // {remisionId, opcion, mensaje} | null — modal de "forzar" pendiente
  const [mostrarAgregarCamion, setMostrarAgregarCamion] = useState(false);
  const [nuevaPlaca, setNuevaPlaca]     = useState('');
  const [nuevoChofer, setNuevoChofer]   = useState('');
  const [mostrarCargarPrueba, setMostrarCargarPrueba] = useState(false);
  const [nPruebaPedidos, setNPruebaPedidos] = useState(80);
  const [cargandoPrueba, setCargandoPrueba] = useState(false);
  const [camionesGPS, setCamionesGPS]   = useState([]); // ubicación en vivo real (Samsara), independiente de `trucks`

  const PALETA_COLORES_CAMION = ['#F27A18', '#D92525', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#eab308', '#06b6d4'];

  const agregarCamion = () => {
    if (!nuevaPlaca.trim() || !nuevoChofer.trim()) return;
    const color = PALETA_COLORES_CAMION[trucks.length % PALETA_COLORES_CAMION.length];
    setTrucks(prev => [
      ...prev,
      { id: nuevaPlaca.trim(), driver: nuevoChofer.trim(), route: 'Sin ruta asignada', pos: [CEDIS[0], CEDIS[1]], color, active: true },
    ]);
    setNuevaPlaca('');
    setNuevoChofer('');
    setMostrarAgregarCamion(false);
  };

  // Solo para pruebas: carga N pedidos con destinos reales (sin depender de
  // SAP) para poder probar el optimizador. Borra las rutas que hubiera hoy,
  // incluidas las ya despachadas — por eso pide confirmación antes.
  const cargarPrueba = async () => {
    const n = Number(nPruebaPedidos);
    if (!n || n < 1) return;
    if (!window.confirm(
      `Esto va a borrar todas las rutas de hoy (incluidas las ya despachadas) y crear ${n} pedidos de prueba. ¿Continuar?`
    )) return;
    setCargandoPrueba(true);
    try {
      const data = await cargarPruebaPedidos(getToday(), n);
      if (data.status === 'success') {
        setMostrarCargarPrueba(false);
        await fetchData();
      } else {
        alert(data.message);
      }
    } catch {
      alert('Error al cargar pedidos de prueba.');
    } finally {
      setCargandoPrueba(false);
    }
  };

  // ── OSRM Routing (paralelo, cacheado por firma de puntos, evitando casetas) ──
  useEffect(() => {
    const fetchRoutes = async () => {
      const activeTrucks = trucks.filter(x => x.active);
      const results = await Promise.all(activeTrucks.map(async (t) => {
        const pts = routePts(t.id);
        if (pts.length === 0) return [t.id, null, null];
        const signature = JSON.stringify(pts);
        if (osrmCache[t.id]?.signature === signature) {
          return [t.id, osrmCache[t.id].geometry, signature];
        }
        const allPoints = [CEDIS, ...pts, CEDIS];
        const coordsStr = allPoints.map(p => `${p[1]},${p[0]}`).join(';');
        const baseUrl = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
        // El servidor público de OSRM no soporta excluir autopistas en su perfil
        // por defecto (responde 400 "Exclude flag combination is not supported").
        // Se intenta igual por si algún día se apunta a un servidor propio, y si
        // falla se reintenta sin exclude — mejor calles reales que nada.
        for (const url of [`${baseUrl}&exclude=${OSRM_EXCLUDE}`, baseUrl]) {
          try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.routes && data.routes[0]) {
              return [t.id, data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]), signature];
            }
          } catch (e) {
            console.error("OSRM Fetch Error:", e);
          }
        }
        return [t.id, null, null];
      }));

      const newOsrm = {};
      const newCache = { ...osrmCache };
      for (const [id, geometry, signature] of results) {
        if (geometry) {
          newOsrm[id] = geometry;
          newCache[id] = { signature, geometry };
        }
      }
      setOsrmRoutes(newOsrm);
      setOsrmCache(newCache);
    };
    if (routesGenerated) fetchRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, trucks, routesGenerated]);

  // ── Data fetching con AbortController + refresco periódico ──
  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);

    // Siempre trae lo más nuevo: reintenta sync + refetch cada REFRESH_INTERVAL_MS
    // sin que el dispatcher tenga que recargar la página manualmente.
    const interval = setInterval(() => fetchData(controller.signal), REFRESH_INTERVAL_MS);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);

  const fetchData = async (signal) => {
    const fecha = getToday();
    try {
      const syncData = await syncSAP(fecha, { signal });
      setSyncStatus(syncData.message);

      const remData = await getRemisiones(fecha, { signal });
      setOrders(remData.map(o => ({ ...o, truck: ID_TO_PLATE[o.truck] || o.truck || null })));

      const rutData = await getRutas(fecha, { signal });
      setRutas(rutData);
      if (rutData.length > 0) setRoutesGenerated(true);

      const alertData = await getAlertas(fecha, { signal });
      setAlertas(alertData);
    } catch (e) {
      if (e.name === 'AbortError') return; // StrictMode unmount / refresh cancelado — ignore
      console.error('Backend error:', e);
      setSyncStatus('Sin conexión con el backend');
    }

    // Aparte del try/catch principal: si Samsara falla, no debe tumbar el
    // resto del dispatcher (pedidos/rutas siguen funcionando sin GPS en vivo).
    try {
      const gpsData = await getCamionesGPS({ signal });
      setCamionesGPS(gpsData);
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Camiones GPS error:', e);
    }
  };

  // ── Sugerencia de camión para un pedido que quedó fuera ──
  const toggleAlerta = async (alerta) => {
    if (alertaAbierta === alerta.id) {
      setAlertaAbierta(null);
      setSugerencias(null);
      return;
    }
    setAlertaAbierta(alerta.id);
    setSugerencias(null);
    setCargandoSugerencias(true);
    try {
      const data = await getSugerencias(alerta.id);
      setSugerencias(data);
    } catch (e) {
      console.error('Error al pedir sugerencias:', e);
    } finally {
      setCargandoSugerencias(false);
    }
  };

  const handleAsignar = async (remisionId, opcion, forzar = false) => {
    setAsignando(opcion.ruta_id);
    try {
      const res = await asignarManual(remisionId, {
        rutaId: opcion.ruta_id,
        posicion: opcion.posicion_sugerida,
        forzar,
      });
      if (res.status === 'requiere_confirmacion') {
        setConfirmacion({ remisionId, opcion, mensaje: res.message });
        return;
      }
      // Éxito: cerrar el panel de sugerencias y refrescar todo (alertas, rutas, pedidos)
      setAlertaAbierta(null);
      setSugerencias(null);
      await fetchData();
    } catch (e) {
      console.error('Error al asignar manualmente:', e);
      alert('No se pudo asignar el pedido. Intenta de nuevo.');
    } finally {
      setAsignando(null);
    }
  };

  // ── Truck toggle ──
  const toggleTruck = (id) =>
    setTrucks(prev => prev.map(t => {
      if (t.id !== id) return t;
      const next = !t.active;
      if (!next) setOrders(o => o.map(x => x.truck === id ? { ...x, truck: null, estado: 'Pendiente' } : x));
      return { ...t, active: next };
    }));

  const changeDriver = (id, d) => setTrucks(p => p.map(t => t.id === id ? { ...t, driver: d } : t));

  // El backend identifica camiones con códigos genéricos (T-001, T-002…) y les
  // pone un chofer placeholder ("Chofer 1") al crear la ruta — no conoce la
  // placa real ni el chofer que el dispatcher asignó en el panel. Acá se
  // resuelve siempre a la placa real (ID_TO_PLATE) y al chofer real vigente
  // en `trucks`, para no mostrar identificadores genéricos en la UI.
  const truckLabel = (camionCode) => {
    const placa = ID_TO_PLATE[camionCode] || camionCode;
    const truckReal = trucks.find(t => t.id === placa);
    return { placa, chofer: truckReal?.driver || null };
  };

  // ── Dispatch Actions ──
  const changeTruckState = async (truckId, newState) => {
    const ruta = rutas.find(r => ID_TO_PLATE[r.camion] === truckId || r.camion === truckId);
    if (!ruta) {
        alert('Ruta no encontrada para este camión. Genera rutas primero.');
        return;
    }
    try {
      await updateRutaEstado(ruta.id, newState);
      await fetchData(); // Refresh to sync ETAs and statuses
    } catch (e) {
      alert('Error cambiando estado: ' + e.message);
    }
  };

  // ── Filters ──
  const visibleTrucks = trucks.filter(t =>
    t.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.driver.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const visibleOrders = orders.filter(o => {
    if (o.truck) { const t = trucks.find(x => x.id === o.truck); if (!t?.active) return false; }
    if (orderFilter !== 'todos' && o.estado?.toLowerCase() !== orderFilter) return false;
    if (orderSearch) {
      const q = orderSearch.toLowerCase();
      return o.card_name?.toLowerCase().includes(q) || String(o.doc_num).includes(q) || o.truck?.toLowerCase().includes(q);
    }
    return true;
  });

  const ordersOf = (id) => orders.filter(o => o.truck === id).sort((a, b) => (a.secuencia_ruta ?? 0) - (b.secuencia_ruta ?? 0));
  const routePts = (id) => ordersOf(id).filter(o => o.lat && o.lng).map(o => [o.lat, o.lng]);

  // ── Optimize ──
  const optimize = async () => {
    setIsOptimizing(true);
    setRoutesGenerated(false);
    const fecha = getToday();
    const n = trucks.filter(t => t.active).length;
    if (!n) { alert('Activa al menos un camión.'); setIsOptimizing(false); return; }
    try {
      const data = await generarRutas(fecha, n);
      if (data.status === 'success') await fetchData();
      else alert(data.message);
    } catch { alert('Error del optimizador.'); }
    finally { setIsOptimizing(false); }
  };

  const focus = (pos) => pos?.[0] && pos?.[1] && setFocusedCoords(pos);

  const colorOf = (plate) => trucks.find(t => t.id === plate)?.color || '#94a3b8';

  // ── JSX ──
  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 text-gray-800 overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ═══ HEADER ═══ */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0 z-20 relative">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPanelOpen(v => !v)}
            title={isPanelOpen ? 'Ocultar camiones y pedidos sin asignar' : 'Ver camiones y pedidos sin asignar'}
            className="p-1.5 -ml-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition"
          >
            {isPanelOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <svg width="38" height="30" viewBox="0 0 100 80">
            <path d="M10,20 L50,45 L90,20 L75,10 L50,25 L25,10Z" fill="#F27A18" />
            <path d="M10,40 L50,65 L90,40 L80,32 L50,52 L20,32Z" fill="#D92525" />
          </svg>
          <div>
            <h1 className="text-xl font-black text-gray-900 tracking-tight leading-none">LABEN</h1>
            <p className="text-[9px] text-gray-400 font-bold tracking-[.2em] uppercase">Food Service · Despacho</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-700 uppercase">SAP B1</span>
          </div>
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5">
            <User className="h-3.5 w-3.5 text-gray-500" />
            <span className="text-xs font-bold text-gray-700">Norberto</span>
          </div>
        </div>
      </header>

      {/* ═══ BODY ═══ */}
      <div className="flex-1 flex min-h-0 relative">

        {/* ─── LEFT SIDEBAR ─── */}
        <aside className={`relative w-[340px] bg-white border-r border-gray-200 flex flex-col flex-shrink-0 transition-all duration-300 z-10 ${isPanelOpen ? 'ml-0' : '-ml-[340px]'}`}>

          {/* ── PESTAÑAS DEL SIDEBAR: Camiones / Sin asignar ── */}
          <div className="flex items-stretch border-b border-gray-200 flex-shrink-0">
            <button
              onClick={() => setSidebarTab('camiones')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-3 text-xs font-bold transition border-b-2 ${
                sidebarTab === 'camiones'
                  ? 'text-orange-600 border-orange-500 bg-orange-50/50'
                  : 'text-gray-400 border-transparent hover:text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Truck className="h-4 w-4" /> Camiones
              <span className="text-[9px] bg-white text-gray-500 font-bold px-1.5 py-0.5 rounded-full border border-gray-200">
                {trucks.filter(t => t.active).length}
              </span>
            </button>
            <button
              onClick={() => setSidebarTab('alertas')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-3 text-xs font-bold transition border-b-2 ${
                sidebarTab === 'alertas'
                  ? 'text-red-600 border-red-500 bg-red-50/50'
                  : 'text-gray-400 border-transparent hover:text-gray-600 hover:bg-gray-50'
              }`}
            >
              <AlertCircle className="h-4 w-4" /> Sin asignar
              {alertas.length > 0 && (
                <span className="text-[9px] bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded-full">
                  {alertas.length}
                </span>
              )}
            </button>
          </div>

          {sidebarTab === 'camiones' && (
          <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 border-b border-gray-100 space-y-3 flex-shrink-0">
            <div className="flex items-center justify-end gap-1.5">
              <button
                onClick={() => setMostrarCargarPrueba(v => !v)}
                title="Cargar pedidos de prueba (sin depender de SAP)"
                className="flex items-center gap-1 text-[10px] font-bold text-purple-600 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition rounded-md px-2 py-1"
              >
                <FlaskConical className="h-3 w-3" /> Prueba
              </button>
              <button
                onClick={() => setMostrarAgregarCamion(v => !v)}
                title="Agregar camión"
                className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 hover:bg-orange-100 transition rounded-md px-2 py-1"
              >
                + Agregar camión
              </button>
            </div>

            {mostrarCargarPrueba && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5 space-y-2">
                <p className="text-[10px] text-purple-700">
                  Carga pedidos con destinos reales del Excel de SAP, sin depender de la conexión a SAP. Borra las rutas de hoy.
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min="1"
                    value={nPruebaPedidos}
                    onChange={e => setNPruebaPedidos(e.target.value)}
                    className="w-20 px-2.5 py-1.5 bg-white border border-purple-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-purple-200"
                  />
                  <button
                    onClick={cargarPrueba}
                    disabled={cargandoPrueba}
                    className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-1.5 rounded-md transition disabled:opacity-40"
                  >
                    {cargandoPrueba ? 'Cargando…' : `Cargar ${nPruebaPedidos} pedidos`}
                  </button>
                  <button
                    onClick={() => setMostrarCargarPrueba(false)}
                    className="px-3 bg-white border border-gray-200 text-gray-500 font-bold text-xs py-1.5 rounded-md hover:bg-gray-100 transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {mostrarAgregarCamion && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 space-y-2">
                <input
                  value={nuevaPlaca}
                  onChange={e => setNuevaPlaca(e.target.value)}
                  placeholder="Placa (ej. ABC-12-34)"
                  className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
                <input
                  value={nuevoChofer}
                  onChange={e => setNuevoChofer(e.target.value)}
                  placeholder="Nombre del chofer"
                  className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={agregarCamion}
                    disabled={!nuevaPlaca.trim() || !nuevoChofer.trim()}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs py-1.5 rounded-md transition disabled:opacity-40"
                  >
                    Agregar
                  </button>
                  <button
                    onClick={() => { setMostrarAgregarCamion(false); setNuevaPlaca(''); setNuevoChofer(''); }}
                    className="flex-1 bg-white border border-gray-200 text-gray-500 font-bold text-xs py-1.5 rounded-md hover:bg-gray-100 transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={optimize}
              disabled={isOptimizing}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold py-2.5 rounded-lg shadow transition-all text-xs disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isOptimizing ? 'animate-spin' : ''}`} />
              {isOptimizing ? 'Optimizando…' : 'Optimizar Rutas'}
            </button>
          </div>

          {/* Search */}
          <div className="px-4 py-2 border-b border-gray-100 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-200"
                placeholder="Buscar placa o chofer…"
              />
            </div>
          </div>

          {/* Truck List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {visibleTrucks.map(truck => {
              const expanded = expandedTruck === truck.id;
              const tOrders = ordersOf(truck.id);

              return (
                <div key={truck.id} className={`rounded-lg border overflow-hidden transition-all ${truck.active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-50'}`}>

                  {/* Card header */}
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none"
                    onClick={() => truck.active && setExpandedTruck(expanded ? null : truck.id)}
                  >
                    <Truck className="h-4 w-4 flex-shrink-0" style={{ color: truck.active ? truck.color : '#94a3b8' }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-extrabold text-gray-800 text-[13px] tracking-wide">{truck.id}</div>
                      <div className="text-[10px] text-gray-400 font-medium truncate">{truck.driver} · {truck.route}</div>
                    </div>

                    {/* Order count badge */}
                    {truck.active && tOrders.length > 0 && (
                      <span className="text-[9px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-md flex-shrink-0">
                        {tOrders.length} ped.
                      </span>
                    )}

                    {/* Toggle */}
                    <button
                      onClick={e => { e.stopPropagation(); toggleTruck(truck.id); }}
                      className={`p-1.5 rounded-lg border transition flex-shrink-0 ${truck.active ? 'bg-orange-50 border-orange-200 text-orange-500 hover:bg-orange-100' : 'bg-gray-100 border-gray-200 text-gray-400 hover:bg-gray-200'}`}
                      title={truck.active ? 'Desactivar' : 'Activar'}
                    >
                      <Truck className="h-3.5 w-3.5" />
                    </button>

                    {/* Chevron */}
                    {truck.active && (
                      expanded ? <ChevronUp className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                    )}
                  </div>

                  {/* Expanded detail */}
                  {expanded && truck.active && (
                    <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3 space-y-3 text-xs">
                      {/* Driver select */}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-400 uppercase">Chofer</span>
                        <select
                          value={truck.driver}
                          onChange={e => changeDriver(truck.id, e.target.value)}
                          className="bg-white border border-gray-200 rounded px-2 py-0.5 text-xs font-semibold focus:outline-none"
                        >
                          {DRIVERS.map(d => <option key={d}>{d}</option>)}
                        </select>
                      </div>

                      {/* Dispatch Controls */}
                      {(() => {
                        const r = rutas.find(x => ID_TO_PLATE[x.camion] === truck.id || x.camion === truck.id);
                        if (!r) return null;
                        
                        return (
                          <div className="bg-white p-2 rounded-lg border border-gray-200 flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-gray-400 uppercase">Estado: {r.estado}</span>
                              {r.hora_salida && (
                                <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                                  <Play className="w-3 h-3" /> Salió {r.hora_salida}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                              <button 
                                onClick={() => changeTruckState(truck.id, 'Cargando')}
                                disabled={r.estado !== 'Borrador'}
                                className={`flex flex-col items-center justify-center p-1.5 rounded border transition-all ${r.estado === 'Borrador' ? 'bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100 cursor-pointer' : 'bg-gray-50 border-gray-100 text-gray-300'}`}
                              >
                                <Loader className="w-3.5 h-3.5 mb-0.5" /> <span className="text-[9px] font-bold">Cargar</span>
                              </button>
                              <button 
                                onClick={() => changeTruckState(truck.id, 'Listo')}
                                disabled={r.estado !== 'Cargando'}
                                className={`flex flex-col items-center justify-center p-1.5 rounded border transition-all ${r.estado === 'Cargando' ? 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100 cursor-pointer' : 'bg-gray-50 border-gray-100 text-gray-300'}`}
                              >
                                <Check className="w-3.5 h-3.5 mb-0.5" /> <span className="text-[9px] font-bold">Listo</span>
                              </button>
                              <button 
                                onClick={() => changeTruckState(truck.id, 'En_Ruta')}
                                disabled={r.estado !== 'Listo'}
                                className={`flex flex-col items-center justify-center p-1.5 rounded border transition-all ${r.estado === 'Listo' ? 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100 cursor-pointer' : 'bg-gray-50 border-gray-100 text-gray-300'}`}
                              >
                                <Play className="w-3.5 h-3.5 mb-0.5" /> <span className="text-[9px] font-bold">Salida</span>
                              </button>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Stops */}
                      <div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1.5">Paradas ({tOrders.length})</span>
                        {tOrders.length > 0 ? (
                          <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                            {tOrders.map((o, i) => (
                              <div
                                key={o.id}
                                onClick={e => { e.stopPropagation(); focus([o.lat, o.lng]); }}
                                className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2.5 py-2 cursor-pointer hover:border-gray-300 transition"
                              >
                                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" style={{ backgroundColor: truck.color }}>{i + 1}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="font-bold text-gray-700 text-[11px] truncate">
                                    <span className="text-gray-400">#{o.doc_num}</span> {o.card_name}
                                  </div>
                                  <div className="text-[9px] text-gray-500 font-medium flex items-center gap-1">
                                    <Clock className="w-3 h-3" /> {o.eta || 'Pendiente'}
                                  </div>
                                </div>
                                <MapPin className="h-3 w-3 text-gray-300 flex-shrink-0" />
                              </div>
                            ))}
                          </div>
                        ) : <p className="text-[10px] text-gray-400 italic">Sin paradas aún. Presiona Optimizar.</p>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </div>
          )}

          {/* ── PESTAÑA: SIN ASIGNAR ── (calculada en vivo desde la BD, no una
              lista fija) */}
          {sidebarTab === 'alertas' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-red-50/20">
            {alertas.length === 0 && (
              <p className="text-xs text-gray-400 italic">Sin alertas pendientes.</p>
            )}
            {alertas.map(a => {
              const abierta = alertaAbierta === a.id;
              return (
                <div
                  key={a.doc_num}
                  className={`bg-white border rounded-xl overflow-hidden transition-shadow ${
                    abierta ? 'border-orange-300 shadow-md' : 'border-red-100 shadow-sm hover:shadow-md'
                  }`}
                >
                  <button
                    onClick={() => toggleAlerta(a)}
                    className="w-full text-left cursor-pointer flex items-center justify-between gap-2 p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">#{a.doc_num}</span>
                        <span className="text-[11px] text-gray-400">{a.motivo}</span>
                      </div>
                      <div className="text-[13px] font-semibold text-gray-800 truncate mt-0.5">{a.card_name}</div>
                    </div>
                    {abierta
                      ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                  </button>

                  {abierta && (
                    <div className="bg-gray-50 border-t border-gray-100 p-2.5 space-y-1.5">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        ¿A qué camión lo mando?
                      </p>
                      {cargandoSugerencias && (
                        <p className="text-[11px] text-gray-400 italic flex items-center gap-1.5 py-1">
                          <Loader className="w-3.5 h-3.5 animate-spin" /> Calculando mejor camión…
                        </p>
                      )}
                      {sugerencias?.error && (
                        <p className="text-[11px] text-red-500">{sugerencias.error}</p>
                      )}
                      {sugerencias?.opciones?.map(o => {
                        const { placa, chofer } = truckLabel(o.camion);
                        return (
                        <div
                          key={o.ruta_id}
                          className={`bg-white border rounded-lg p-2.5 flex items-center justify-between gap-2 ${
                            o.factible ? 'border-green-200' : 'border-red-200'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <Truck className={`w-3.5 h-3.5 flex-shrink-0 ${o.factible ? 'text-green-600' : 'text-red-500'}`} />
                              <span className="text-[12px] font-bold text-gray-800">{placa}</span>
                              <span className="text-[10px] text-gray-400">· {chofer || o.chofer}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
                              <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" /> Llega ~{o.eta_estimada}</span>
                              <span>· agrega {o.minutos_agregados} min a la ruta</span>
                            </div>
                            {!o.factible && (
                              <div className="text-[10px] text-red-500 mt-1 flex items-start gap-1">
                                <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                <span>{o.motivos_riesgo.join('; ')}</span>
                              </div>
                            )}
                          </div>
                          <button
                            disabled={asignando === o.ruta_id}
                            onClick={() => handleAsignar(a.id, o)}
                            className={`text-[11px] font-bold px-3 py-1.5 rounded-lg flex-shrink-0 transition-colors ${
                              o.factible
                                ? 'bg-green-600 text-white hover:bg-green-700'
                                : 'bg-white text-red-600 border border-red-300 hover:bg-red-50'
                            } disabled:opacity-50`}
                          >
                            {asignando === o.ruta_id ? '...' : o.factible ? 'Asignar' : 'Forzar'}
                          </button>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </aside>

        {/* ─── MAP AREA ─── */}
        <div className="flex-1 flex flex-col min-w-0 bg-gray-100 relative">

          {/* Collapsible toggle handle floating dynamically over the map edge */}
          <button
            onClick={() => setIsPanelOpen(!isPanelOpen)}
            className="absolute top-1/2 -translate-y-1/2 left-0 z-[2000] bg-white border border-l-0 border-gray-200 text-gray-500 hover:text-gray-800 rounded-r-md p-1 shadow-md hover:shadow-lg transition-all flex items-center justify-center cursor-pointer w-4 h-14"
            title={isPanelOpen ? "Ocultar Panel" : "Mostrar Panel"}
          >
            {isPanelOpen ? (
              <ChevronLeft className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>

          <div className="flex-1 relative">
            <button
              onClick={() => focus(CEDIS)}
              className="absolute top-3 right-3 z-[400] bg-white/95 border border-gray-200 px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 text-[11px] font-bold text-gray-700 hover:bg-gray-50 transition"
            >
              <Compass className="h-3.5 w-3.5 text-orange-600" /> CEDIS
            </button>

            <div className="absolute bottom-3 left-3 z-[400] bg-white/90 border border-gray-200 px-3 py-1.5 rounded-lg shadow-sm text-[10px] font-semibold text-gray-500 max-w-[260px]">
              {syncStatus}
            </div>

            <MapContainer center={CEDIS} zoom={13} className="w-full h-full" zoomControl={false}>
              <MapUpdater coords={focusedCoords} />
              <MapResizeHandler isPanelOpen={isPanelOpen} />
              <TileLayer
                attribution='&copy; <a href="https://carto.com">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              />

              {/* CEDIS marker */}
              <Marker position={CEDIS} icon={L.divIcon({
                className: '',
                html: '<div style="background:#0f172a;width:26px;height:26px;border-radius:6px;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.2)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></div>',
                iconSize: [26, 26],
              })}>
                <Popup><b>CEDIS Laben</b><br /><span style={{ fontSize: 11, color: '#64748b' }}>Salida de Embarques</span></Popup>
              </Marker>

              {/* Ubicación GPS real (Samsara) de los camiones ISUZU de reparto */}
              {camionesGPS.map(c => (
                <Marker key={`gps-${c.placa}`} position={[c.lat, c.lng]} icon={createGPSIcon(c.velocidad_kmh > 2)}>
                  <Popup>
                    <b>{c.nombre_samsara}</b> — {c.placa} <span style={{ color: '#16a34a' }}>● GPS real</span><br />
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      {c.velocidad_kmh > 2 ? `${c.velocidad_kmh} km/h` : 'Detenido'} · {c.direccion}
                    </span>
                  </Popup>
                </Marker>
              ))}

              {/* Trucks */}
              {trucks.map(t => (
                <Marker key={t.id} position={t.pos} icon={createTruckIcon(t.color, t.active)}>
                  <Popup>
                    <b>{t.id}</b> — {t.driver}<br />
                    <span style={{ fontSize: 11, color: '#64748b' }}>{t.route}</span>
                  </Popup>
                </Marker>
              ))}

              {/* Routes — borde blanco debajo + línea de color encima para efecto "tubo" limpio */}
              {routesGenerated && trucks.filter(t => t.active).map(t => {
                const stops = ordersOf(t.id).filter(o => o.lat && o.lng);
                if (!stops.length) return null;
                const pts = stops.map(o => [o.lat, o.lng]);
                const positions = osrmRoutes[t.id] || [CEDIS, ...pts, CEDIS];
                return (
                  <React.Fragment key={`r-${t.id}`}>
                    {/* Sombra/borde blanco debajo */}
                    <Polyline positions={positions} pathOptions={{ color: '#fff', weight: 8, opacity: 0.9 }} />
                    {/* Línea de color encima */}
                    <Polyline positions={positions} pathOptions={{ color: t.color, weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />
                    {stops.map((o, i) => (
                      <Marker key={`s-${t.id}-${i}`} position={[o.lat, o.lng]} icon={L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div style="background:${t.color};width:24px;height:24px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${i + 1}</div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                      })}>
                        {/* Distingue paradas superpuestas de distintos camiones: cada
                            ruta numera desde 1, así que varios círculos "1" cercanos
                            son normales — el tooltip aclara a qué camión pertenece. */}
                        <Popup>
                          <b>{t.id}</b> — Parada {i + 1}<br />
                          <span style={{ fontSize: 11, color: '#64748b' }}>#{o.doc_num} {o.card_name}</span>
                        </Popup>
                      </Marker>
                    ))}
                  </React.Fragment>
                );
              })}
            </MapContainer>
          </div>

          {/* ═══ BOTTOM PANEL ═══ */}
          <div className="h-[340px] flex flex-col border-t border-gray-200 bg-white flex-shrink-0">

            {/* Tab bar */}
            <div className="flex items-center gap-1 px-5 pt-3 pb-0 flex-shrink-0">
              <button
                onClick={() => setActiveTab('pedidos')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-xs font-bold transition ${activeTab === 'pedidos' ? 'bg-white border border-b-0 border-gray-200 text-orange-600' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <Package className="h-3.5 w-3.5" /> Pedidos del Día
              </button>
              <button
                onClick={() => setActiveTab('manifiesto')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-xs font-bold transition ${activeTab === 'manifiesto' ? 'bg-white border border-b-0 border-gray-200 text-orange-600' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <FileText className="h-3.5 w-3.5" /> Manifiesto de Carga
              </button>

              {/* Search (pedidos only) */}
              {activeTab === 'pedidos' && (
                <div className="ml-auto relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <input
                    value={orderSearch}
                    onChange={e => setOrderSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium w-56 focus:outline-none focus:ring-2 focus:ring-orange-200"
                    placeholder="Buscar pedido…"
                  />
                </div>
              )}
            </div>

            {/* ── TAB: PEDIDOS ── */}
            {activeTab === 'pedidos' && (
              <div className="flex-1 flex flex-col min-h-0 px-5 pb-3">
                {/* Status filter */}
                <div className="flex gap-4 border-b border-gray-200 text-[11px] font-bold mb-2 flex-shrink-0">
                  {['todos', 'pendiente', 'asignado', 'en_camino', 'entregado'].map(f => (
                    <button
                      key={f}
                      onClick={() => setOrderFilter(f)}
                      className={`pb-2 capitalize transition border-b-2 ${orderFilter === f ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                    >{f.replace('_', ' ')}</button>
                  ))}
                </div>
                {/* Table */}
                <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-400 uppercase sticky top-0">
                      <tr>
                        <th className="px-3 py-2">ID</th>
                        <th className="px-3 py-2">Cliente</th>
                        <th className="px-3 py-2">Placa</th>
                        <th className="px-3 py-2">ID Dirección</th>
                        <th className="px-3 py-2">Dirección</th>
                        <th className="px-3 py-2">Estado</th>
                        <th className="px-3 py-2 text-center">📍</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                      {visibleOrders.map(o => (
                        <tr key={o.id} className="hover:bg-gray-50/60 transition">
                          <td className="px-3 py-2 font-mono font-bold text-gray-800">#{o.doc_num}</td>
                          <td className="px-3 py-2 font-semibold">{o.card_name}</td>
                          <td className="px-3 py-2">
                            {o.truck ? (
                              <span className="inline-flex items-center gap-1.5 font-bold">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorOf(o.truck) }} />
                                {o.truck}
                              </span>
                            ) : <span className="text-gray-400 italic text-[10px]">—</span>}
                          </td>
                          <td className="px-3 py-2 font-mono font-bold text-gray-600">{o.ship_to_code}</td>
                          <td className="px-3 py-2 text-gray-500 truncate max-w-[180px]" title={o.address}>{o.address || 'Sin dirección'}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                              o.estado === 'Entregado' ? 'bg-emerald-50 text-emerald-700' :
                              o.estado === 'En_Camino' ? 'bg-blue-50 text-blue-700' :
                              o.estado === 'Asignado'  ? 'bg-orange-50 text-orange-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>{o.estado?.replace('_', ' ')}</span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {o.lat && o.lng ? (
                              <button onClick={() => focus([o.lat, o.lng])} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-orange-600 transition">
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                      {!visibleOrders.length && (
                        <tr><td colSpan="7" className="text-center py-8 text-gray-400 italic">Sin pedidos.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── TAB: MANIFIESTO DE CARGA ── */}
            {activeTab === 'manifiesto' && (
              <div className="flex-1 overflow-auto px-5 py-3">
                <p className="text-[11px] text-gray-400 mb-3 font-medium">
                  Orden de carga <b>LIFO</b> — lo primero que se carga en almacén es lo último que se entrega en ruta.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {trucks.filter(t => t.active).map(truck => {
                    const tOrders = ordersOf(truck.id);
                    // LIFO: reverse the delivery sequence for loading order
                    const loadSeq = [...tOrders].reverse();

                    return (
                      <div key={truck.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                        {/* Truck header */}
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100" style={{ borderLeft: `4px solid ${truck.color}` }}>
                          <div className="flex-1">
                            <div className="font-extrabold text-gray-800 text-sm">{truck.id}</div>
                            <div className="text-[10px] text-gray-400 font-medium">{truck.driver}</div>
                          </div>
                          <span className="text-[9px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{tOrders.length} pedidos</span>
                        </div>

                        {/* Loading sequence */}
                        <div className="px-3 py-2 space-y-1.5 max-h-[160px] overflow-y-auto">
                          {loadSeq.length > 0 ? loadSeq.map((o, i) => (
                            <div key={o.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 text-xs">
                              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" style={{ backgroundColor: truck.color }}>{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <div className="font-bold text-gray-700 text-[11px] truncate">{o.card_name}</div>
                              </div>
                              <span className="font-bold text-gray-800 text-[11px] flex-shrink-0">${o.doc_total?.toLocaleString()}</span>
                            </div>
                          )) : (
                            <p className="text-[10px] text-gray-400 italic text-center py-4">Sin pedidos asignados.</p>
                          )}
                        </div>

                        {/* Download */}
                        <div className="px-3 pb-3 pt-1">
                          <button
                            onClick={() => alert(`Imprimiendo manifiesto: ${truck.id}`)}
                            className="w-full flex items-center justify-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold py-2 rounded-lg text-[11px] transition border border-gray-200"
                          >
                            <Download className="h-3 w-3" /> Descargar Guía
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ MODAL DE CONFIRMACIÓN: forzar un pedido que no cabe limpio ═══ */}
      {confirmacion && (
        <div className="fixed inset-0 z-[3000] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
            <div className="bg-red-50 border-b border-red-100 px-5 py-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-red-700">Este pedido no cabe limpio</h3>
                <p className="text-xs text-red-600 mt-0.5">{confirmacion.mensaje}</p>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600">
                ¿Meterlo de todos modos a <span className="font-bold text-gray-800">{truckLabel(confirmacion.opcion.camion).placa}</span>?
              </p>
            </div>
            <div className="px-5 pb-5 flex gap-2 justify-end">
              <button
                onClick={() => setConfirmacion(null)}
                className="px-4 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const { remisionId, opcion } = confirmacion;
                  setConfirmacion(null);
                  await handleAsignar(remisionId, opcion, true);
                }}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition"
              >
                Forzar de todos modos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
