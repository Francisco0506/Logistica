import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Truck, Box, Clock, AlertTriangle, Navigation, CheckCircle2, RefreshCw, Sliders, Search, Compass, AlertCircle, Eye, Package, User, Plus, X, Power, PowerOff } from 'lucide-react';

// Corregir icono por defecto de Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Icono personalizado para camiones
const createTruckIcon = (color, isActive) => {
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: ${isActive ? color : '#94a3b8'}; width: 32px; height: 32px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.25);"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/></svg></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const center = [25.693214524592616, -100.48167993202988]; // CEDIS en Santa Catarina
const defaultDate = "2026-07-05";

const initialDrivers = ['Roberto Sánchez', 'Luis Garza', 'Mario Gómez', 'Saúl Cano', 'Tono Vega'];

const truckColors = {
  'T-001': '#F27A18',
  'T-002': '#D92525',
  'T-003': '#3b82f6',
  'T-004': '#10b981',
  'T-005': '#8b5cf6'
};

// Datos base de los 5 camiones de Laben
const baseTrucks = [
  { id: 'T-001', driver: 'Roberto Sánchez', route: 'Santa Catarina Poniente', load: 85, pos: [25.705, -100.512], color: '#F27A18', nextStop: 'Plaza Sendero', eta: '10:15 AM' },
  { id: 'T-002', driver: 'Luis Garza', route: 'San Pedro / Valle', load: 68, pos: [25.661, -100.421], color: '#D92525', nextStop: 'HEB San Pedro', eta: '10:45 AM' },
  { id: 'T-003', driver: 'Mario Gómez', route: 'Mitras / Lincoln', load: 92, pos: [25.728, -100.445], color: '#3b82f6', nextStop: 'Smart Lincoln', eta: '09:50 AM' },
  { id: 'T-004', driver: 'Saúl Cano', route: 'García Industrial', load: 50, pos: [25.715, -100.535], color: '#10b981', nextStop: 'García Centro', eta: '11:10 AM' },
  { id: 'T-005', driver: 'Tono Vega', route: 'Centro Monterrey', load: 74, pos: [25.679, -100.352], color: '#8b5cf6', nextStop: 'Pabellón M', eta: '10:30 AM' }
];

// Excepciones SAP B1
const sapExceptions = [
  { id: 1, docNum: 'Ped #1915', client: 'Taquería La Fama', error: 'Falta georreferencia en SAP', type: 'error' },
  { id: 2, docNum: 'Ped #1918', client: 'Buffet Express', error: 'Excede ventana de chofer', type: 'warning' },
];

function ChangeMapView({ coords }) {
  const map = useMap();
  map.setView(coords, 13, { animate: true });
  return null;
}

export default function DispatcherPanel() {
  const [trucks, setTrucks] = useState(baseTrucks.map(t => ({ ...t, active: true })));
  const [routesGenerated, setRoutesGenerated] = useState(true);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedCoords, setFocusedCoords] = useState(center);
  
  // Estado para acordeón expandido en la barra lateral
  const [expandedTruck, setExpandedTruck] = useState(null);

  // Estados para tabla de pedidos
  const [orders, setOrders] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [syncStatus, setSyncStatus] = useState("Sin sincronizar");
  const [orderFilter, setOrderFilter] = useState('todos');
  const [orderSearch, setOrderSearch] = useState('');

  // Modales
  const [showGeocodeModal, setShowGeocodeModal] = useState(false);
  const [selectedException, setSelectedException] = useState(null);
  const [manualAddress, setManualAddress] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const syncRes = await fetch(`http://127.0.0.1:8000/api/dispatcher/sync?fecha=${defaultDate}`, { method: 'POST' });
      const syncData = await syncRes.json();
      setSyncStatus(syncData.message);

      const remRes = await fetch(`http://127.0.0.1:8000/api/dispatcher/remisiones?fecha=${defaultDate}`);
      const remData = await remRes.json();
      setOrders(remData);

      const rutRes = await fetch(`http://127.0.0.1:8000/api/dispatcher/rutas?fecha=${defaultDate}`);
      const rutData = await rutRes.json();
      setRoutes(rutData);
      
      if (rutData.length > 0) {
        setRoutesGenerated(true);
      }
    } catch (e) {
      console.error("Error conectando con el backend Django:", e);
      setSyncStatus("Error de conexión (cargando datos locales)");
    }
  };

  // Alternar el estado activo/inactivo de un camión específico
  const toggleTruckActive = (id) => {
    setTrucks(prev => prev.map(t => {
      if (t.id === id) {
        const newActive = !t.active;
        // Si desactivamos el camión, quitamos sus órdenes asociadas
        if (!newActive) {
          setOrders(ordersArr => ordersArr.map(o => o.truck === id ? { ...o, truck: null, estado: 'Pendiente' } : o));
        }
        return { ...t, active: newActive };
      }
      return t;
    }));
  };

  // Cambiar chofer de un camión de forma manual
  const handleDriverChange = (truckId, newDriver) => {
    setTrucks(prev => prev.map(t => t.id === truckId ? { ...t, driver: newDriver } : t));
  };

  // Filtrar camiones por buscador
  const searchedTrucks = trucks.filter(t => 
    t.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.driver.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.route.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filtrar pedidos según el estado de camiones activos
  const filteredOrders = orders.filter(o => {
    if (o.truck) {
      const truck = trucks.find(t => t.id === o.truck);
      if (!truck || !truck.active) return false;
    }

    if (orderFilter !== 'todos' && o.estado.toLowerCase() !== orderFilter.toLowerCase()) return false;

    if (orderSearch) {
      const q = orderSearch.toLowerCase();
      return o.card_name.toLowerCase().includes(q) || String(o.doc_num).includes(q) || (o.truck && o.truck.toLowerCase().includes(q));
    }
    return true;
  });

  // Optimizar rutas dinámicamente con los camiones que Norberto dejó ACTIVOS
  const handleGenerateRoutes = async () => {
    setIsOptimizing(true);
    setRoutesGenerated(false);
    const activeVehiclesCount = trucks.filter(t => t.active).length;

    if (activeVehiclesCount === 0) {
      alert("Debes activar al menos un camión en la flota para optimizar.");
      setIsOptimizing(false);
      return;
    }

    try {
      const res = await fetch('http://127.0.0.1:8000/api/dispatcher/rutas/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha: defaultDate,
          numero_camiones: activeVehiclesCount
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        await fetchData();
      } else {
        alert(data.message);
      }
    } catch (e) {
      console.error("Error optimizando rutas:", e);
      alert("Error en el optimizador matemático del backend.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleFocusPoint = (pos) => {
    if (pos && pos[0] && pos[1]) {
      setFocusedCoords(pos);
    }
  };

  // Obtener pedidos específicos asignados a un camión
  const getOrdersForTruck = (truckId) => {
    return orders.filter(o => o.truck === truckId);
  };

  // Obtener puntos de ruta para las polilíneas de un camión a partir de las órdenes asignadas
  const getRoutePointsForTruck = (truckId) => {
    return orders
      .filter(o => o.truck === truckId && o.lat && o.lng)
      .map(o => [o.lat, o.lng]);
  };

  // Abrir modal de geocodificación
  const openGeocodeResolver = (exc) => {
    setSelectedException(exc);
    setManualAddress(exc.client);
    setShowGeocodeModal(true);
  };

  const saveGeocode = () => {
    alert(`Georreferencia guardada para ${selectedException.client}. Coordenadas: 25.685, -100.460`);
    setShowGeocodeModal(false);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 text-slate-700 font-sans overflow-hidden">
      
      {/* Top Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <svg width="40" height="32" viewBox="0 0 100 80" className="drop-shadow-sm">
              <path d="M 10,20 L 50,45 L 90,20 L 75,10 L 50,25 L 25,10 Z" fill="#F27A18" />
              <path d="M 10,40 L 50,65 L 90,40 L 80,32 L 50,52 L 20,32 Z" fill="#D92525" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight leading-none">LABEN</h1>
            <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase mt-1">Food Service · Consola de Despacho</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-1.5 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide">SAP B1 Conectado</span>
          </div>
          <span className="text-xs font-extrabold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-xl">
            Norberto (Dispatcher)
          </span>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        
        {/* Sección Superior: Mapa y Gestor de Flota */}
        <div className="flex h-[58%] min-h-[400px] w-full border-b border-slate-200 flex-shrink-0">
          
          {/* Panel Lateral: Gestor de Flota Completo */}
          <div className="w-96 bg-white flex flex-col h-full border-r border-slate-200 flex-shrink-0 overflow-hidden">
            
            {/* Cabecera del Gestor de Flota */}
            <div className="p-4 border-b border-slate-200 bg-slate-50/50 space-y-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <Sliders className="h-4 w-4 text-orange-600" /> Control de Flota
                </span>
                <span className="text-[10px] bg-slate-200 text-slate-700 font-extrabold px-2 py-0.5 rounded-full">
                  {trucks.filter(t => t.active).length} / 5 Camiones Activos
                </span>
              </div>

              {/* Botón Optimizar */}
              <button 
                onClick={handleGenerateRoutes}
                disabled={isOptimizing}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white font-extrabold py-2.5 px-4 rounded-xl shadow-md transition-all text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isOptimizing ? 'animate-spin' : ''}`} />
                {isOptimizing ? 'Optimizando con OR-Tools...' : 'Optimizar Rutas del Día'}
              </button>
            </div>

            {/* Buscador */}
            <div className="p-3 border-b border-slate-200 bg-white flex-shrink-0">
              <div className="relative">
                <Search className="absolute inset-y-0 left-0 pl-2.5 h-3.5 w-3.5 my-auto text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none"
                  placeholder="Buscar camión o chofer..."
                />
              </div>
            </div>

            {/* Listado de Camiones (Con Acordeón y Toggles On/Off) */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/20">
              {searchedTrucks.map(truck => {
                const isExpanded = expandedTruck === truck.id;
                const truckOrders = getOrdersForTruck(truck.id);

                return (
                  <div 
                    key={truck.id} 
                    className={`bg-white border rounded-xl transition-all shadow-sm relative overflow-hidden ${
                      truck.active ? 'border-slate-200 hover:border-slate-300' : 'border-slate-200 opacity-60 bg-slate-100/50'
                    }`}
                  >
                    <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: truck.active ? truck.color : '#94a3b8' }}></div>
                    
                    {/* Fila principal del camión */}
                    <div className="p-3 flex justify-between items-center cursor-pointer" onClick={() => truck.active && setExpandedTruck(isExpanded ? null : truck.id)}>
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4" style={{ color: truck.active ? truck.color : '#94a3b8' }} />
                        <div>
                          <span className="font-extrabold text-slate-800 text-xs">{truck.id}</span>
                          <span className="text-[10px] text-slate-400 ml-2">({truck.route})</span>
                        </div>
                      </div>

                      {/* Botón On/Off para Quitar/Agregar camión */}
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTruckActive(truck.id);
                        }}
                        className={`p-1.5 rounded-lg border transition-colors flex items-center justify-center ${
                          truck.active 
                            ? 'bg-red-50 hover:bg-red-100 border-red-200 text-red-600' 
                            : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-600'
                        }`}
                        title={truck.active ? "Quitar Camión de Flota" : "Agregar Camión a Flota"}
                      >
                        {truck.active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                      </button>
                    </div>

                    {/* Contenido expandido (Detalle de paradas y Chofer) */}
                    {isExpanded && truck.active && (
                      <div className="border-t border-slate-100 p-3 bg-slate-50/50 space-y-3 text-xs">
                        
                        {/* Selector de Chofer */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Chofer Asignado:</span>
                          <select 
                            value={truck.driver}
                            onChange={(e) => handleDriverChange(truck.id, e.target.value)}
                            className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-xs font-semibold focus:outline-none"
                          >
                            {initialDrivers.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>

                        {/* Paradas */}
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Secuencia de Entregas:</span>
                          {truckOrders.length > 0 ? (
                            truckOrders.map((o, idx) => (
                              <div 
                                key={o.id} 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleFocusPoint([o.lat, o.lng]);
                                }}
                                className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-150 hover:border-slate-300 transition-all cursor-pointer"
                              >
                                <span className="font-bold truncate text-[11px]">{idx + 1}. {o.card_name}</span>
                                <span className="text-[10px] font-mono text-slate-500 font-bold flex-shrink-0 ml-2">{o.eta}</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-[10px] text-slate-400 italic">No hay pedidos asignados.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mapa Claro */}
          <div className="flex-1 relative h-full bg-slate-100">
            <button 
              onClick={() => handleFocusPoint(center)}
              className="absolute top-4 right-4 z-[400] bg-white hover:bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl shadow-md flex items-center gap-1.5 text-xs font-bold text-slate-700"
            >
              <Compass className="h-4 w-4 text-orange-600" /> CEDIS Base
            </button>

            <div className="absolute bottom-4 left-4 z-[400] bg-white/95 border border-slate-200 px-3 py-2 rounded-xl shadow-md text-[10px] font-bold text-slate-500 max-w-[280px]">
              {syncStatus}
            </div>

            <div className="w-full h-full z-0">
              <MapContainer center={center} zoom={13} className="w-full h-full" zoomControl={false}>
                <ChangeMapView coords={focusedCoords} />
                <TileLayer
                  attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
                  url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                />
                
                {/* CEDIS */}
                <Marker position={center} icon={L.divIcon({
                    className: 'custom-depot-icon',
                    html: `<div style="background-color: #0f172a; width: 28px; height: 28px; border-radius: 8px; border: 3px solid #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 8px rgba(0,0,0,0.2);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg></div>`,
                    iconSize: [28, 28],
                })}>
                  <Popup>
                    <div className="font-bold text-slate-800 text-sm">CEDIS Laben</div>
                    <div className="text-xs text-slate-400">Punto de salida exacto</div>
                  </Popup>
                </Marker>

                {/* Camiones */}
                {trucks.map(truck => (
                  <Marker key={truck.id} position={truck.pos} icon={createTruckIcon(truck.color, truck.active)}>
                    <Popup>
                      <div className="font-bold text-slate-800">{truck.id} - {truck.driver}</div>
                      <div className="text-xs text-slate-500">Estado: {truck.active ? 'Activo' : 'Fuera de Servicio'}</div>
                    </Popup>
                  </Marker>
                ))}

                {/* Líneas de rutas */}
                {routesGenerated && trucks.filter(t => t.active).map(truck => {
                  const points = getRoutePointsForTruck(truck.id);
                  if (points.length === 0) return null;
                  
                  return (
                    <React.Fragment key={`lines-${truck.id}`}>
                      {points.map((pt, idx) => (
                        <Marker key={`pt-${truck.id}-${idx}`} position={pt} icon={L.divIcon({
                          className: 'custom-stop',
                          html: `<div style="background-color: ${truck.color}; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white;"></div>`,
                          iconSize: [10, 10],
                        })} />
                      ))}
                      <Polyline positions={[center, ...points, truck.pos]} pathOptions={{ color: truck.color, weight: 3, opacity: 0.7 }} />
                    </React.Fragment>
                  );
                })}
              </MapContainer>
            </div>
          </div>

        </div>

        {/* Sección Inferior: Lista de Pedidos */}
        <div className="flex-grow flex min-h-[300px] bg-white">
          
          {/* Panel Izquierdo: Alertas de SAP */}
          <div className="w-80 border-r border-slate-200 bg-slate-50/50 p-4 space-y-3 flex-shrink-0 flex flex-col overflow-y-auto">
            <div className="flex items-center gap-1.5 text-red-600">
              <AlertCircle className="h-4 w-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Alertas de SAP B1</h3>
            </div>
            <div className="space-y-2 flex-1">
              {sapExceptions.map(exc => (
                <div key={exc.id} className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col shadow-sm animate-pulse-slow">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] bg-red-50 text-red-700 font-extrabold px-1.5 py-0.5 rounded">{exc.docNum}</span>
                    <button onClick={() => openGeocodeResolver(exc)} className="text-[10px] text-orange-600 font-bold hover:underline">Resolver</button>
                  </div>
                  <span className="text-xs font-bold text-slate-700">{exc.client}</span>
                  <p className="text-[10px] text-slate-400 mt-1">{exc.error}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Panel Derecho: Tabla de Pedidos */}
          <div className="flex-1 p-5 flex flex-col min-h-0">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-orange-600" />
                <h2 className="text-lg font-black text-slate-800">Plan de Carga y Pedidos</h2>
              </div>
              
              <div className="relative w-full sm:w-64">
                <Search className="absolute inset-y-0 left-0 pl-3 h-4 w-4 my-auto text-slate-400" />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none"
                  placeholder="Buscar por ID SAP, cliente..."
                />
              </div>
            </div>

            <div className="flex border-b border-slate-200 gap-6 text-xs font-bold mb-4 flex-shrink-0">
              {['todos', 'pendiente', 'asignado', 'en_camino', 'entregado'].map(filter => (
                <button
                  key={filter}
                  onClick={() => setOrderFilter(filter)}
                  className={`pb-2 capitalize border-b-2 transition-all ${
                    orderFilter === filter
                      ? 'border-orange-600 text-orange-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {filter.replace('_', ' ')}
                </button>
              ))}
            </div>

            <div className="flex-grow overflow-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="p-3 pl-4">ID SAP</th>
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Vehículo</th>
                    <th className="p-3">Monto / Cajas</th>
                    <th className="p-3">Dirección de Entrega</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3 pr-4 text-center">Ubicación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                  {filteredOrders.map(order => (
                    <tr key={order.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-3 pl-4 font-mono font-bold text-slate-800">#{order.doc_num}</td>
                      <td className="p-3 font-bold text-slate-800">{order.card_name}</td>
                      <td className="p-3">
                        {order.truck ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: truckColors[order.truck] }}></span>
                            {order.truck}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">No asignado</span>
                        )}
                      </td>
                      <td className="p-3">${order.doc_total.toLocaleString()}</td>
                      <td className="p-3 text-slate-500 max-w-xs truncate">{order.ship_to_code}</td>
                      <td className="p-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          order.estado === 'Entregado' ? 'bg-emerald-50 text-emerald-700' :
                          order.estado === 'En_Camino' ? 'bg-blue-50 text-blue-700' :
                          order.estado === 'Asignado' ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {order.estado.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="p-3 pr-4 text-center">
                        {order.lat && order.lng ? (
                          <button 
                            onClick={() => handleFocusPoint([order.lat, order.lng])}
                            className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-orange-600 transition-colors"
                            title="Ubicar en Mapa"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan="7" className="text-center py-6 text-slate-400 italic">No hay pedidos disponibles.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

          </div>

        </div>

      </div>

      {/* Modal interactivo para georreferenciación manual */}
      {showGeocodeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 w-full max-w-md space-y-4">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2 text-orange-600">
                <Compass className="h-5 w-5 animate-spin-slow" />
                <h3 className="font-extrabold text-slate-800">Resolver Georreferencia</h3>
              </div>
              <button onClick={() => setShowGeocodeModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <p className="text-xs text-slate-500">
              El pedido <b>{selectedException?.docNum}</b> de <b>{selectedException?.client}</b> no tiene coordenadas válidas en SAP B1.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Dirección de búsqueda</label>
                <input 
                  type="text" 
                  value={manualAddress} 
                  onChange={(e) => setManualAddress(e.target.value)}
                  className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:bg-white" 
                />
              </div>
              <div className="bg-slate-200 rounded-xl h-36 flex items-center justify-center text-xs text-slate-400 border border-slate-300">
                [Minimapa para dar clic]
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowGeocodeModal(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 rounded-xl text-xs">
                Cancelar
              </button>
              <button onClick={saveGeocode} className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold py-2 rounded-xl text-xs shadow-md">
                Guardar Posición
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
