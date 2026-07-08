import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Truck, RefreshCw, Sliders, Search, Compass, AlertCircle, Eye, Package, Power, PowerOff, FileText, Download, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, MapPin, User, Clock, Play, Check, Send, Loader } from 'lucide-react';
import { CEDIS, FLEET, DRIVERS, ID_TO_PLATE, SAP_ALERTS } from '../../config/fleet';
import { syncSAP, getRemisiones, getRutas, generarRutas, updateRutaEstado } from '../../services/api';

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

// Fecha dinámica del sistema
const getToday = () => new Date().toISOString().split('T')[0];

function MapUpdater({ coords }) {
  const map = useMap();
  useEffect(() => { map.setView(coords, 13, { animate: true }); }, [coords]);
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

  // ── OSRM Routing ──
  useEffect(() => {
    const fetchRoutes = async () => {
      const newOsrm = { ...osrmRoutes };
      for (const t of trucks.filter(x => x.active)) {
        const pts = routePts(t.id);
        if (pts.length === 0) continue;
        const allPoints = [CEDIS, ...pts, CEDIS]; // Regresa al CEDIS
        const coordsStr = allPoints.map(p => `${p[1]},${p[0]}`).join(';');
        try {
          const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`);
          const data = await res.json();
          if (data.routes && data.routes[0]) {
            newOsrm[t.id] = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
          }
        } catch (e) {
          console.error("OSRM Fetch Error:", e);
        }
      }
      setOsrmRoutes(newOsrm);
    };
    if (routesGenerated) fetchRoutes();
  }, [orders, trucks, routesGenerated]);

  // ── Data fetching con AbortController ──
  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
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
    } catch (e) {
      if (e.name === 'AbortError') return; // StrictMode unmount — ignore
      console.error('Backend error:', e);
      setSyncStatus('Sin conexión — datos simulados');
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

  const ordersOf = (id) => orders.filter(o => o.truck === id);
  const routePts = (id) => orders.filter(o => o.truck === id && o.lat && o.lng).map(o => [o.lat, o.lng]);

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
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
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

          {/* Fleet Header */}
          <div className="p-4 border-b border-gray-100 space-y-3 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-gray-500 uppercase tracking-wider">
                <Sliders className="h-3.5 w-3.5 text-orange-600" /> Control de Flota
              </span>
              <span className="text-[10px] bg-orange-50 text-orange-700 font-bold px-2 py-0.5 rounded-md border border-orange-200">
                {trucks.filter(t => t.active).length}/5
              </span>
            </div>
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
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
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
                            <span className="text-[10px] font-bold text-gray-400 uppercase">Estado: {r.estado}</span>
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

          {/* SAP Alerts */}
          <div className="border-t border-gray-200 p-3 space-y-2 flex-shrink-0 max-h-[180px] overflow-y-auto">
            <div className="flex items-center gap-1.5 text-red-600 mb-1">
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Alertas SAP</span>
            </div>
            {SAP_ALERTS.map(a => (
              <div key={a.id} className="bg-red-50/60 border border-red-100 rounded-lg p-2.5">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-[10px] font-bold text-red-700">Ped {a.docNum}</span>
                  <button className="text-[10px] text-orange-600 font-bold hover:underline">Resolver</button>
                </div>
                <div className="text-[11px] font-semibold text-gray-700">{a.client}</div>
                <div className="text-[9px] text-gray-400">{a.error}</div>
              </div>
            ))}
          </div>
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

              {/* Trucks */}
              {trucks.map(t => (
                <Marker key={t.id} position={t.pos} icon={createTruckIcon(t.color, t.active)}>
                  <Popup>
                    <b>{t.id}</b> — {t.driver}<br />
                    <span style={{ fontSize: 11, color: '#64748b' }}>{t.route}</span>
                  </Popup>
                </Marker>
              ))}

              {/* Routes */}
              {routesGenerated && trucks.filter(t => t.active).map(t => {
                const pts = routePts(t.id);
                if (!pts.length) return null;
                return (
                  <React.Fragment key={`r-${t.id}`}>
                    {pts.map((p, i) => (
                      <Marker key={`s-${t.id}-${i}`} position={p} icon={L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div style="background:${t.color};width:20px;height:20px;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:900;box-shadow:0 2px 4px rgba(0,0,0,0.4);">${i + 1}</div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                      })} />
                    ))}
                    <Polyline 
                      positions={osrmRoutes[t.id] || [CEDIS, ...pts, CEDIS]} 
                      pathOptions={{ color: t.color, weight: 4, opacity: 0.8 }} 
                    />
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
    </div>
  );
}
