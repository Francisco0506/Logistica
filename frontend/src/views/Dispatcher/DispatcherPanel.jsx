import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, RefreshCw, Search, AlertCircle, Package, FileText, Clock, Loader, FlaskConical, Maximize2, Minimize2 } from 'lucide-react';
import { CEDIS, PALETA_COLORES_CAMION } from '../../config/fleet';
import {
  syncSAP, getRemisiones, getRutas, getAlertas, generarRutas, updateRutaEstado,
  getSugerencias, asignarManual, cargarPruebaPedidos, getCamionesGPS, getFlota,
} from '../../services/api';
import HeaderDespacho from './components/HeaderDespacho';
import TarjetaCamion from './components/TarjetaCamion';
import PanelSinAsignar from './components/PanelSinAsignar';
import TablaPedidos from './components/TablaPedidos';
import Manifiesto from './components/Manifiesto';
import MapaRutas from './components/MapaRutas';
import ModalForzar from './components/ModalForzar';

// Cada cuánto se refresca la vista para traer lo más nuevo (pedidos nuevos de
// SAP, cambios de estado de otros usuarios) sin recargar la página a mano.
const REFRESH_INTERVAL_MS = 45_000;
// La ruta que dibuja el mapa evita autopistas de cuota, mismo criterio que el
// optimizador del backend, para no cruzar casetas ni visual ni realmente.
const OSRM_EXCLUDE = 'motorway';
// Servidor OSRM propio (Docker), igual que OSRM_BASE en el backend. OJO: que el
// contenedor esté corriendo no basta — el backend solo lo usa si OSRM_BASE está
// puesto en su .env; si no, sigue pegándole al público y su límite de 100 paradas.
const OSRM_BASE = import.meta.env.VITE_OSRM_BASE || 'http://localhost:5001';

// Fecha del sistema en hora LOCAL. No se usa toISOString(): se adelanta de día
// después de las 6 pm en México y rompe la sincronización.
const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Un camión como lo manda el backend -> como lo usa el panel. `driver` arranca
// vacío a propósito: quién maneja cada unidad no es un dato que el sistema tenga
// (ver docs/pendientes.md §1), y antes se mostraba un "Chofer 1" inventado.
const aCamionDelPanel = (c) => ({
  id: c.placa,
  samsara: c.samsara,
  modelo: c.modelo,
  capacidadKg: c.capacidad_kg,
  maxParadas: c.max_paradas,
  color: c.color,
  active: c.activo_default,
  driver: '',
});

export default function DispatcherPanel() {
  const navigate = useNavigate();

  // ── Flota (fuente única: backend/delivery/fleet.py) ──
  const [trucks, setTrucks]             = useState([]);
  const [ordenFlota, setOrdenFlota]     = useState([]);
  const [flotaCargada, setFlotaCargada] = useState(false);

  // ── Datos del día ──
  const [orders, setOrders]             = useState([]);
  const [rutas, setRutas]               = useState([]);
  const [alertas, setAlertas]           = useState([]);
  const [camionesGPS, setCamionesGPS]   = useState([]);
  const [selectedDate, setSelectedDate] = useState(hoy());
  const [syncStatus, setSyncStatus]     = useState('Conectando…');
  const [syncStatusTipo, setSyncStatusTipo] = useState('cargando');

  // ── Interfaz ──
  // El mapa se puede ensanchar a toda la página cuando hace falta verlo grande.
  const [mapaAncho, setMapaAncho]       = useState(false);
  // Solo dos pestañas en la columna de operación: camiones y lo que no cupo.
  // Los pedidos y el manifiesto ya no son pestañas — viven más abajo en la
  // misma página, y se llega a ellos recorriendo, no clicando.
  const [sidebarTab, setSidebarTab]     = useState('camiones');
  const [searchQuery, setSearchQuery]   = useState('');
  const [orderFilter, setOrderFilter]   = useState('todos');
  const [orderSearch, setOrderSearch]   = useState('');
  // Varios camiones abiertos a la vez. Antes solo cabía uno: comparar dos rutas
  // obligaba a cerrar una para abrir la otra, y volver a buscarla en la lista.
  const [expandedTrucks, setExpandedTrucks] = useState(() => new Set());
  const [focusedCoords, setFocusedCoords] = useState(CEDIS);

  // ── Optimización y despacho ──
  const [routesGenerated, setRoutesGenerated] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [horasTurno, setHorasTurno]     = useState(6);
  const [cambiandoEstado, setCambiandoEstado] = useState(null);
  const [osrmRoutes, setOsrmRoutes]     = useState({});
  const [osrmCache, setOsrmCache]       = useState({});

  // ── Asignación manual ──
  const [alertaAbierta, setAlertaAbierta] = useState(null);
  const [sugerencias, setSugerencias]   = useState(null);
  const [cargandoSugerencias, setCargandoSugerencias] = useState(false);
  const [asignando, setAsignando]       = useState(null);
  const [confirmacion, setConfirmacion] = useState(null);

  // ── Formularios ──
  const [mostrarAgregarCamion, setMostrarAgregarCamion] = useState(false);
  const [nuevaPlaca, setNuevaPlaca]     = useState('');
  const [nuevoChofer, setNuevoChofer]   = useState('');
  const [mostrarCargarPrueba, setMostrarCargarPrueba] = useState(false);
  const [nPruebaPedidos, setNPruebaPedidos] = useState(80);
  const [cargandoPrueba, setCargandoPrueba] = useState(false);

  // ── La flota, una sola vez al abrir ──
  // A propósito NO se recarga en el refresco de 45 s: eso borraría los choferes
  // capturados y volvería a prender los camiones que el despachador apagó.
  useEffect(() => {
    const controller = new AbortController();
    getFlota({ signal: controller.signal })
      .then((flota) => {
        setTrucks(flota.map(aCamionDelPanel));
        setOrdenFlota(flota.map((c) => c.placa));
        setFlotaCargada(true);
      })
      .catch((e) => { if (e.name !== 'AbortError') console.error('No se pudo cargar la flota:', e); });
    return () => controller.abort();
  }, []);

  // ── Datos del día + refresco periódico ──
  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    const interval = setInterval(() => fetchData(controller.signal), REFRESH_INTERVAL_MS);
    return () => { controller.abort(); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const fetchData = async (signal) => {
    const fecha = selectedDate;
    try {
      const syncData = await syncSAP(fecha, { signal });
      setSyncStatus(syncData.message);
      setSyncStatusTipo(syncData.status === 'success' ? 'ok' : syncData.status === 'warning' ? 'warning' : 'error');

      // `truck` ya viene como placa real del backend.
      const remData = await getRemisiones(fecha, { signal });
      setOrders(remData.map((o) => ({ ...o, truck: o.truck || null })));

      const rutData = await getRutas(fecha, { signal });
      setRutas(rutData);
      if (rutData.length > 0) setRoutesGenerated(true);

      setAlertas(await getAlertas(fecha, { signal }));
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('Backend error:', e);
      setSyncStatus('Sin conexión con el backend');
      setSyncStatusTipo('error');
    }

    // Aparte: si Samsara falla no debe tumbar el resto del panel.
    try {
      setCamionesGPS(await getCamionesGPS({ signal }));
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Camiones GPS error:', e);
    }
  };

  // ── Rutas dibujadas por calle (OSRM), cacheadas por firma de puntos ──
  useEffect(() => {
    if (!routesGenerated) return;
    const fetchRoutes = async () => {
      const activos = trucks.filter((t) => t.active);
      const results = await Promise.all(activos.map(async (t) => {
        const pts = routePts(t.id);
        if (!pts.length) return [t.id, null, null];
        const signature = JSON.stringify(pts);
        if (osrmCache[t.id]?.signature === signature) return [t.id, osrmCache[t.id].geometry, signature];

        const coordsStr = [CEDIS, ...pts, CEDIS].map((p) => `${p[1]},${p[0]}`).join(';');
        const baseUrl = `${OSRM_BASE}/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
        // Se intenta primero evitando autopistas; si el servidor no lo soporta
        // (el público no), se reintenta sin excluir — mejor calles reales que nada.
        for (const url of [`${baseUrl}&exclude=${OSRM_EXCLUDE}`, baseUrl]) {
          try {
            const data = await (await fetch(url)).json();
            if (data.routes?.[0]) {
              return [t.id, data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]), signature];
            }
          } catch { /* se intenta la siguiente variante */ }
        }
        return [t.id, null, null];
      }));

      const nuevas = {};
      const cache = { ...osrmCache };
      for (const [id, geometry, signature] of results) {
        if (geometry) { nuevas[id] = geometry; cache[id] = { signature, geometry }; }
      }
      setOsrmRoutes(nuevas);
      setOsrmCache(cache);
    };
    fetchRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, trucks, routesGenerated]);

  // ── Derivados ──
  const rankFlota = Object.fromEntries(ordenFlota.map((placa, i) => [placa, i]));
  const camionesActivos = trucks.filter((t) => t.active);

  const visibleTrucks = trucks
    .filter((t) =>
      t.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.driver.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => (rankFlota[a.id] ?? 99) - (rankFlota[b.id] ?? 99));

  const visibleOrders = orders.filter((o) => {
    if (o.truck) {
      const t = trucks.find((x) => x.id === o.truck);
      if (t && !t.active) return false;
    }
    if (orderFilter !== 'todos' && o.estado?.toLowerCase() !== orderFilter) return false;
    if (orderSearch) {
      const q = orderSearch.toLowerCase();
      return o.card_name?.toLowerCase().includes(q) || String(o.doc_num).includes(q) || o.truck?.toLowerCase().includes(q);
    }
    return true;
  });

  const ordersOf = (id) => orders.filter((o) => o.truck === id).sort((a, b) => (a.secuencia_ruta ?? 0) - (b.secuencia_ruta ?? 0));
  const routePts = (id) => ordersOf(id).filter((o) => o.lat && o.lng).map((o) => [o.lat, o.lng]);
  const colorOf = (placa) => trucks.find((t) => t.id === placa)?.color || '#94a3b8';
  const rutaDe = (placa) => rutas.find((r) => r.camion === placa);
  const truckLabel = (placa) => ({ placa, chofer: trucks.find((t) => t.id === placa)?.driver || null });
  const focus = (pos) => pos?.[0] && pos?.[1] && setFocusedCoords(pos);

  // Resumen del día, para no tener que contar a ojo en la tabla.
  const resumen = {
    total: orders.length,
    asignados: orders.filter((o) => o.truck).length,
    sinAsignar: alertas.length,
    enCalle: rutas.filter((r) => r.estado === 'En_Ruta').length,
  };

  // ── Acciones ──
  const optimize = async () => {
    // Se mandan las PLACAS activas, no un conteo: el backend saca de cada placa
    // su capacidad y su tope de paradas.
    const placasActivas = camionesActivos.map((t) => t.id);
    if (!placasActivas.length) { alert('Activa al menos un camión.'); return; }
    setIsOptimizing(true);
    setRoutesGenerated(false);
    try {
      const data = await generarRutas(selectedDate, placasActivas, horasTurno);
      if (data.status === 'success') await fetchData();
      else alert(data.message);
    } catch { alert('Error del optimizador.'); }
    finally { setIsOptimizing(false); }
  };

  const toggleTruck = (id) =>
    setTrucks((prev) => prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t)));

  const changeDriver = (id, d) =>
    setTrucks((prev) => prev.map((t) => (t.id === id ? { ...t, driver: d } : t)));

  const changeTruckState = async (placa, nuevoEstado) => {
    const ruta = rutaDe(placa);
    if (!ruta) { alert('Este camión no tiene ruta todavía. Genera rutas primero.'); return; }
    setCambiandoEstado(placa);
    try {
      const res = await updateRutaEstado(ruta.id, nuevoEstado);
      if (res.status === 'error') alert(res.message);
      await fetchData();
    } catch (e) {
      alert('Error cambiando estado: ' + e.message);
    } finally {
      setCambiandoEstado(null);
    }
  };

  const agregarCamion = () => {
    if (!nuevaPlaca.trim()) return;
    const color = PALETA_COLORES_CAMION[trucks.length % PALETA_COLORES_CAMION.length];
    setTrucks((prev) => [...prev, {
      id: nuevaPlaca.trim().toUpperCase(),
      driver: nuevoChofer.trim(),
      color,
      active: true,
    }]);
    setNuevaPlaca(''); setNuevoChofer(''); setMostrarAgregarCamion(false);
  };

  const cargarPrueba = async () => {
    const n = Number(nPruebaPedidos);
    if (!n || n < 1) return;
    if (!window.confirm(
      `Esto va a borrar todas las rutas de ${selectedDate} (incluidas las ya despachadas) y crear ${n} pedidos de prueba. ¿Continuar?`
    )) return;
    setCargandoPrueba(true);
    try {
      const data = await cargarPruebaPedidos(selectedDate, n);
      if (data.status === 'success') { setMostrarCargarPrueba(false); await fetchData(); }
      else alert(data.message);
    } catch { alert('Error al cargar pedidos de prueba.'); }
    finally { setCargandoPrueba(false); }
  };

  const toggleAlerta = async (alerta) => {
    if (alertaAbierta === alerta.id) { setAlertaAbierta(null); setSugerencias(null); return; }
    setAlertaAbierta(alerta.id);
    setSugerencias(null);
    setCargandoSugerencias(true);
    try { setSugerencias(await getSugerencias(alerta.id)); }
    catch (e) { console.error('Error al pedir sugerencias:', e); }
    finally { setCargandoSugerencias(false); }
  };

  const handleAsignar = async (remisionId, opcion, forzar = false) => {
    setAsignando(opcion.ruta_id);
    try {
      const res = await asignarManual(remisionId, {
        rutaId: opcion.ruta_id, posicion: opcion.posicion_sugerida, forzar,
      });
      if (res.status === 'requiere_confirmacion') {
        setConfirmacion({ remisionId, opcion, mensaje: res.message });
        return;
      }
      setAlertaAbierta(null); setSugerencias(null);
      await fetchData();
    } catch (e) {
      console.error('Error al asignar manualmente:', e);
      alert('No se pudo asignar el pedido. Intenta de nuevo.');
    } finally {
      setAsignando(null);
    }
  };

  const alternarCamion = (placa) =>
    setExpandedTrucks((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(placa)) siguiente.delete(placa);
      else siguiente.add(placa);
      return siguiente;
    });

  return (
    // La página se recorre. Antes era una aplicación clavada a la pantalla
    // (h-screen + overflow-hidden): no se podía bajar, y todo tenía que caber
    // en el alto del monitor a costa de letra chica y scrolls internos.
    <div className="min-h-screen w-full bg-gray-50 text-gray-800" style={{ fontFamily: "'Inter', sans-serif" }}>
      <HeaderDespacho
        fecha={selectedDate}
        onFecha={setSelectedDate}
        estadoSync={syncStatus}
        tipoSync={syncStatusTipo}
        onSalir={() => navigate('/')}
      />

      <main className="max-w-[1700px] mx-auto px-5 py-5 space-y-5">

        {/* ═══ RESUMEN DEL DÍA ═══ */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { etiqueta: 'Pedidos del día', valor: resumen.total, clase: 'text-gray-800' },
            { etiqueta: 'En un camión', valor: resumen.asignados, clase: 'text-emerald-600' },
            { etiqueta: 'Sin asignar', valor: resumen.sinAsignar, clase: resumen.sinAsignar ? 'text-red-600' : 'text-gray-300' },
            { etiqueta: 'En la calle', valor: resumen.enCalle, clase: resumen.enCalle ? 'text-blue-600' : 'text-gray-300' },
            { etiqueta: 'Camiones activos', valor: camionesActivos.length, clase: 'text-gray-800' },
          ].map((m) => (
            <div key={m.etiqueta} className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm">
              <div className={`text-2xl font-extrabold leading-none ${m.clase}`}>{m.valor}</div>
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mt-1.5">{m.etiqueta}</div>
            </div>
          ))}
        </section>

        {/* ═══ MAPA (izquierda, flotante) + OPERACIÓN (derecha) ═══ */}
        <div className={mapaAncho ? 'space-y-5' : 'grid grid-cols-1 xl:grid-cols-2 gap-5 items-start'}>

          {/* El mapa NO va anclado: se queda pegado arriba mientras recorres la
              columna de la derecha, y se despega solo cuando la página sigue
              hacia abajo. Así no lo pierdes de vista sin que se coma la pantalla. */}
          <div className={mapaAncho ? '' : 'xl:sticky xl:top-[76px]'}>
            <MapaRutas
              camionesActivos={camionesActivos}
              paradasDe={ordersOf}
              rutasOsrm={osrmRoutes}
              camionesGPS={camionesGPS}
              rutasGeneradas={routesGenerated}
              coordsEnfocadas={focusedCoords}
              onEnfocarCedis={() => focus(CEDIS)}
              mensajeEstado={syncStatus}
              alto={mapaAncho ? 'h-[78vh]' : 'h-[72vh]'}
              acciones={
                <button
                  onClick={() => setMapaAncho((v) => !v)}
                  title={mapaAncho ? 'Volver a dos columnas' : 'Ver el mapa a todo lo ancho'}
                  className="bg-white/95 border border-gray-200 px-2.5 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 text-[11px] font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  {mapaAncho ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  {mapaAncho ? 'Reducir' : 'Ampliar'}
                </button>
              }
            />
          </div>

          {/* ── Columna de operación ── */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-stretch border-b border-gray-200">
              {[
                { id: 'camiones', icono: Truck, texto: 'Camiones', badge: camionesActivos.length, color: 'orange' },
                { id: 'alertas', icono: AlertCircle, texto: 'Sin asignar', badge: alertas.length || null, color: 'red' },
              ].map(({ id, icono: Icono, texto, badge, color }) => (
                <button
                  key={id}
                  onClick={() => setSidebarTab(id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-3 text-xs font-bold transition border-b-2 whitespace-nowrap ${
                    sidebarTab === id
                      ? color === 'red' ? 'text-red-600 border-red-500 bg-red-50/50' : 'text-orange-600 border-orange-500 bg-orange-50/50'
                      : 'text-gray-400 border-transparent hover:text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icono className="h-4 w-4 flex-shrink-0" /> {texto}
                  {badge != null && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      color === 'red' ? 'bg-red-100 text-red-700' : 'bg-white text-gray-500 border border-gray-200'
                    }`}>{badge}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ── CAMIONES ── */}
            {sidebarTab === 'camiones' && (
              <div>
                <div className="p-4 border-b border-gray-100 space-y-3">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => setMostrarCargarPrueba((v) => !v)}
                    title="Cargar pedidos de prueba (sin depender de SAP)"
                    className="flex items-center gap-1 text-[10px] font-bold text-purple-600 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition rounded-md px-2 py-1"
                  >
                    <FlaskConical className="h-3 w-3" /> Prueba
                  </button>
                  <button
                    onClick={() => setMostrarAgregarCamion((v) => !v)}
                    className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 hover:bg-orange-100 transition rounded-md px-2 py-1"
                  >
                    + Agregar camión
                  </button>
                </div>

                {mostrarCargarPrueba && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5 space-y-2">
                    <p className="text-[10px] text-purple-700">
                      Carga pedidos con destinos reales del Excel de SAP, sin depender de la conexión a SAP. Borra las rutas del día.
                    </p>
                    <div className="flex gap-1.5">
                      <input
                        type="number" min="1" value={nPruebaPedidos}
                        onChange={(e) => setNPruebaPedidos(e.target.value)}
                        className="w-20 px-2.5 py-1.5 bg-white border border-purple-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-purple-200"
                      />
                      <button
                        onClick={cargarPrueba} disabled={cargandoPrueba}
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
                    <p className="text-[10px] text-gray-500">
                      Un camión que no está en la flota registrada entra con capacidad estimada de 3,000 kg y 25 paradas.
                    </p>
                    <input
                      value={nuevaPlaca} onChange={(e) => setNuevaPlaca(e.target.value)}
                      placeholder="Placa (ej. ABC1234)"
                      className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <input
                      value={nuevoChofer} onChange={(e) => setNuevoChofer(e.target.value)}
                      placeholder="Nombre del chofer (opcional)"
                      className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={agregarCamion} disabled={!nuevaPlaca.trim()}
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

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Turno chofer
                  </span>
                  <select
                    value={horasTurno} onChange={(e) => setHorasTurno(Number(e.target.value))}
                    className={`bg-white border rounded-md px-2 py-1 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-orange-200 ${
                      horasTurno > 6 ? 'border-amber-400 text-amber-700' : 'border-gray-200 text-gray-700'
                    }`}
                  >
                    {[6, 6.5, 7, 7.5, 8].map((h) => (
                      <option key={h} value={h}>{h} horas{h === 6 ? ' (normal)' : ''}</option>
                    ))}
                  </select>
                </div>
                {horasTurno > 6 && (
                  <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                    Turno ampliado a {horasTurno} h: las rutas podrán ser más largas de lo normal. Confírmalo con los choferes.
                  </p>
                )}

                <button
                  onClick={optimize}
                  disabled={isOptimizing || !flotaCargada}
                  title={!flotaCargada ? 'Esperando la flota del servidor…' : undefined}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold py-2.5 rounded-lg shadow transition-all text-xs disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isOptimizing || !flotaCargada ? 'animate-spin' : ''}`} />
                  {!flotaCargada ? 'Cargando flota…' : isOptimizing ? 'Optimizando…' : `Optimizar Rutas (turno ${horasTurno} h)`}
                </button>
              </div>

                <div className="px-4 py-2 border-b border-gray-100">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input
                      value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-200"
                      placeholder="Buscar placa o chofer…"
                    />
                  </div>
                </div>

                <div className="p-3 space-y-2.5">
                  {!flotaCargada && (
                    <p className="text-[11px] text-gray-400 italic flex items-center gap-1.5 py-2">
                      <Loader className="w-3.5 h-3.5 animate-spin" /> Cargando la flota…
                    </p>
                  )}
                  {flotaCargada && !visibleTrucks.length && (
                    <p className="text-[11px] text-gray-400 italic py-2">
                      {trucks.length ? 'Ningún camión coincide con la búsqueda.' : 'No se pudo cargar la flota del servidor.'}
                    </p>
                  )}
                  {visibleTrucks.map((truck) => (
                    <TarjetaCamion
                      key={truck.id}
                      camion={truck}
                      ruta={rutaDe(truck.id)}
                      paradas={ordersOf(truck.id)}
                      abierto={expandedTrucks.has(truck.id)}
                      cambiandoEstado={cambiandoEstado === truck.id}
                      onAbrir={() => alternarCamion(truck.id)}
                      onToggleActivo={() => toggleTruck(truck.id)}
                      onCambiarChofer={(d) => changeDriver(truck.id, d)}
                      onCambiarEstado={(estado) => changeTruckState(truck.id, estado)}
                      onEnfocar={focus}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── SIN ASIGNAR ── */}
            {sidebarTab === 'alertas' && (
              <PanelSinAsignar
                alertas={alertas}
                alertaAbierta={alertaAbierta}
                sugerencias={sugerencias}
                cargandoSugerencias={cargandoSugerencias}
                asignando={asignando}
                onAbrirAlerta={toggleAlerta}
                onAsignar={handleAsignar}
                onIrAAgregarCamion={() => { setSidebarTab('camiones'); setMostrarAgregarCamion(true); }}
                etiquetaCamion={truckLabel}
              />
            )}
          </div>
        </div>

        {/* ═══ MÁS ABAJO: PEDIDOS DEL DÍA ═══
            Ya no son pestañas. Se llega recorriendo la página, que es lo que
            uno hace sin pensarlo, en vez de tener que acordarse de que existe
            una pestaña y hacer clic. */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
            <Package className="h-4 w-4 text-orange-500" />
            <h2 className="text-sm font-bold text-gray-800">Pedidos del día</h2>
            <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {visibleOrders.length}
            </span>
          </div>
          <TablaPedidos
            pedidos={visibleOrders}
            filtro={orderFilter} onFiltro={setOrderFilter}
            busqueda={orderSearch} onBusqueda={setOrderSearch}
            colorDe={colorOf} onEnfocar={focus}
          />
        </section>

        {/* ═══ MÁS ABAJO: MANIFIESTO DE CARGA ═══ */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
            <FileText className="h-4 w-4 text-orange-500" />
            <h2 className="text-sm font-bold text-gray-800">Manifiesto de carga</h2>
          </div>
          <Manifiesto camionesActivos={camionesActivos} paradasDe={ordersOf} />
        </section>
      </main>

      <ModalForzar
        confirmacion={confirmacion}
        placa={confirmacion ? truckLabel(confirmacion.opcion.camion).placa : ''}
        onCancelar={() => setConfirmacion(null)}
        onConfirmar={async () => {
          const { remisionId, opcion } = confirmacion;
          setConfirmacion(null);
          await handleAsignar(remisionId, opcion, true);
        }}
      />
    </div>
  );
}
