import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, LogOut, User, RefreshCw, Truck, CheckCircle2, Package, AlertCircle,
  Map as MapIcon, List, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import LabenLogo from '../../components/LabenLogo';
import { useAviso } from '../../components/useAviso';
import { getVendedores, getPedidosVendedor, getCamionesGPS, getFlota } from '../../services/api';
import TarjetaPedido from './components/TarjetaPedido';
import MapaPedidos from './components/MapaPedidos';

// Se refresca solo para que la vendedora no tenga que recargar mientras le
// contesta a un cliente por teléfono.
const REFRESH_INTERVAL_MS = 60_000;
// El GPS por su cuenta y más seguido: es lo único que se mueve solo.
const GPS_INTERVAL_MS = 20_000;

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Filtros en el orden en que le urgen a la vendedora: primero lo que está
// pasando ahora, luego lo programado, luego lo que NO va a salir (que es lo que
// tiene que resolver) y al final lo entregado, que ya no requiere nada.
const FILTROS = [
  { id: 'todos', texto: 'Todos', icono: List, color: 'text-gray-500' },
  { id: 'En_Camino', texto: 'En camino', icono: Truck, color: 'text-blue-600' },
  { id: 'Asignado', texto: 'Programados', icono: Package, color: 'text-orange-600' },
  { id: 'Pendiente', texto: 'Sin programar', icono: AlertCircle, color: 'text-red-600' },
  { id: 'Entregado', texto: 'Entregados', icono: CheckCircle2, color: 'text-emerald-600' },
];

export default function SalesPanel() {
  const navigate = useNavigate();
  const avisar = useAviso();

  const [fecha, setFecha]           = useState(hoy());
  const [vendedores, setVendedores] = useState([]);
  const [slpCode, setSlpCode]       = useState('');
  const [pedidos, setPedidos]       = useState([]);
  const [camionesGPS, setCamionesGPS] = useState([]);
  const [busqueda, setBusqueda]     = useState('');
  const [filtro, setFiltro]         = useState('todos');
  const [cargando, setCargando]     = useState(true);
  const [verMapa, setVerMapa]       = useState(true);
  const [mapaCompleto, setMapaCompleto] = useState(false);
  const [verLista, setVerLista]     = useState(true);
  const [actualizado, setActualizado] = useState(null);
  const [flota, setFlota] = useState([]);
  const [camionFiltro, setCamionFiltro] = useState('todos');


  // ── Vendedores del día ──
  // El selector es temporal: hoy el login no valida nada, así que no hay forma
  // de saber quién entró. Cuando haya usuarios de verdad, el SlpCode sale de la
  // sesión y esto desaparece (ver docs/pendientes.md §5).
  useEffect(() => {
    const controller = new AbortController();
    getVendedores(fecha, { signal: controller.signal })
      .then((vs) => {
        setVendedores(vs);
        setSlpCode((actual) => (vs.some((v) => v.slp_code === actual) ? actual : vs[0]?.slp_code || ''));
      })
      .catch((e) => { if (e.name !== 'AbortError') console.error('Vendedores:', e); });
    return () => controller.abort();
  }, [fecha]);

  // ── Pedidos de esa vendedora ──
  useEffect(() => {
    if (!slpCode) { setPedidos([]); setCargando(false); return; }
    const controller = new AbortController();

    const traer = () => {
      getPedidosVendedor(fecha, slpCode, { signal: controller.signal })
        .then((ps) => { setPedidos(ps); setActualizado(new Date()); })
        .catch((e) => {
          if (e.name === 'AbortError') return;
          console.error('Pedidos:', e);
          avisar('No se pudo conectar con el servidor. Se reintenta en un minuto.', 'error');
        })
        .finally(() => setCargando(false));
    };

    setCargando(true);
    traer();
    const interval = setInterval(traer, REFRESH_INTERVAL_MS);
    return () => { controller.abort(); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, slpCode]);

  // ── La flota, para pintar cada pedido con el color de su camión ──
  useEffect(() => {
    const controller = new AbortController();
    getFlota({ signal: controller.signal })
      .then(setFlota)
      .catch((e) => { if (e.name !== 'AbortError') console.error('Flota:', e); });
    return () => controller.abort();
  }, []);

  // ── Camiones en vivo ──
  // Aparte de los pedidos: si Samsara falla, la lista sigue funcionando.
  useEffect(() => {
    const controller = new AbortController();
    const traerGPS = () => {
      getCamionesGPS({ signal: controller.signal })
        .then(setCamionesGPS)
        .catch((e) => { if (e.name !== 'AbortError') console.error('GPS:', e); });
    };
    traerGPS();
    const interval = setInterval(traerGPS, GPS_INTERVAL_MS);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);

  const vendedor = vendedores.find((v) => v.slp_code === slpCode);

  const cuenta = useMemo(() => {
    const c = { todos: pedidos.length };
    for (const f of FILTROS.slice(1)) c[f.id] = pedidos.filter((p) => p.estado === f.id).length;
    return c;
  }, [pedidos]);

  // Los camiones que llevan pedidos de esta vendedora hoy.
  const misCamiones = useMemo(
    () => [...new Set(pedidos.map((p) => p.camion).filter(Boolean))].sort(),
    [pedidos],
  );

  const colorDe = (placa) => flota.find((c) => c.placa === placa)?.color || '#94a3b8';

  const visibles = useMemo(() => {
    let lista = filtro === 'todos' ? pedidos : pedidos.filter((p) => p.estado === filtro);
    // El filtro de camión se encadena con el de estado: filtrar por vendedora y
    // luego por camión deja SOLO sus pedidos en ese camión, que es lo que se
    // ocupa para contestar "¿y los míos que van en el 027?".
    if (camionFiltro !== 'todos') lista = lista.filter((p) => p.camion === camionFiltro);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(
        (p) => p.card_name?.toLowerCase().includes(q)
          || String(p.doc_num).includes(q)
          || p.camion?.toLowerCase().includes(q)
          || p.address?.toLowerCase().includes(q)
      );
    }
    return lista;
  }, [pedidos, filtro, busqueda, camionFiltro]);

  // El que urge: lo primero que va a llegar de lo que todavía no llega.
  const proximo = useMemo(() => {
    const enCurso = pedidos
      .filter((p) => p.eta_desde && p.estado !== 'Entregado')
      .sort((a, b) => a.eta_desde.localeCompare(b.eta_desde));
    return enCurso[0] || null;
  }, [pedidos]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* ═══ HEADER — mismo patrón que el dispatcher ═══ */}
      <header className="sticky top-0 z-[1100] bg-white/95 backdrop-blur border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <LabenLogo variant="horizontal" />
          <span className="text-[9px] text-gray-300 font-bold tracking-[.2em] uppercase self-end pb-0.5 hidden sm:inline">
            · Ventas
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            title="Día que se está consultando"
            className="text-xs font-semibold text-gray-700 bg-gray-100 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          {vendedores.length > 1 ? (
            <select
              value={slpCode}
              onChange={(e) => setSlpCode(e.target.value)}
              className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded-lg px-2 py-1.5 max-w-[160px] focus:outline-none focus:ring-2 focus:ring-orange-200"
            >
              {vendedores.map((v) => (
                <option key={v.slp_code} value={v.slp_code}>{v.slp_name} ({v.pedidos})</option>
              ))}
            </select>
          ) : (
            <div className="hidden sm:flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5">
              <User className="h-3.5 w-3.5 text-gray-500" />
              <span className="text-xs font-bold text-gray-700 truncate max-w-[140px]">{vendedor?.slp_name || '—'}</span>
            </div>
          )}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg px-2.5 py-1.5 transition"
          >
            <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 py-4 space-y-4">

        {/* ═══ LO QUE SIGUE + resumen en una sola franja ═══ */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 flex items-center gap-5 flex-wrap">
          {proximo ? (
            <div className="min-w-0">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Lo próximo en llegar</div>
              <div className="text-sm font-bold text-gray-800 truncate">
                {proximo.card_name}
                <span className="text-orange-600 ml-2 tabular-nums">{proximo.eta_desde}–{proximo.eta_hasta}</span>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Lo próximo en llegar</div>
              <div className="text-sm font-bold text-gray-300">Nada pendiente</div>
            </div>
          )}

          <div className="flex items-stretch gap-5 ml-auto border-l border-gray-100 pl-5">
            {[
              { t: 'Pedidos', n: cuenta.todos, c: 'text-gray-800' },
              { t: 'En camino', n: cuenta.En_Camino, c: cuenta.En_Camino ? 'text-blue-600' : 'text-gray-300' },
              { t: 'Sin programar', n: cuenta.Pendiente, c: cuenta.Pendiente ? 'text-red-600' : 'text-gray-300' },
              { t: 'Entregados', n: cuenta.Entregado, c: cuenta.Entregado ? 'text-emerald-600' : 'text-gray-300' },
            ].map((m) => (
              <div key={m.t}>
                <div className={`text-xl font-extrabold leading-none ${m.c}`}>{m.n}</div>
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mt-1">{m.t}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ FILTROS + BUSCADOR ═══ */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2.5 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {FILTROS.map(({ id, texto, icono: Icono, color }) => (
              <button
                key={id}
                onClick={() => setFiltro(id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition ${
                  filtro === id ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <Icono className={`w-3.5 h-3.5 ${filtro === id ? 'text-white' : color}`} />
                {texto}
                <span className={filtro === id ? 'text-gray-300' : 'text-gray-400'}>{cuenta[id] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto flex-1 min-w-[220px] justify-end">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Cliente, remisión, placa o calle…"
                className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
            </div>
            {/* Filtro por camión, encadenado con el de estado. Solo salen los
                camiones que llevan pedidos de esta vendedora. */}
            {misCamiones.length > 1 && (
              <select
                value={camionFiltro}
                onChange={(e) => setCamionFiltro(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-200 flex-shrink-0"
              >
                <option value="todos">Todos los camiones</option>
                {misCamiones.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <button
              onClick={() => setVerMapa((v) => !v)}
              title={verMapa ? 'Ocultar el mapa' : 'Ver el mapa'}
              className="flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-600 transition flex-shrink-0"
            >
              {verMapa ? <List className="w-3.5 h-3.5" /> : <MapIcon className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{verMapa ? 'Ocultar mapa' : 'Ver mapa'}</span>
            </button>
          </div>
        </div>

        {/* ═══ LISTA + MAPA, lado a lado ═══
            El mapa a la derecha y flotante, igual que en el dispatcher: así no
            se come la pantalla y la lista aprovecha el ancho. */}
        {/* ═══ MAPA, a todo lo ancho ═══
            Aquí sí hay espacio para separar 80 marcadores; en la columna
            angosta de antes se encimaban y no se distinguía cuál era cuál. */}
        {verMapa && !!pedidos.length && (
          <MapaPedidos
            pedidos={visibles}
            camionesGPS={camionesGPS}
            colorDe={colorDe}
            pantallaCompleta={mapaCompleto}
            onTogglePantalla={() => setMapaCompleto((v) => !v)}
          />
        )}

        {/* ═══ LA LISTA, abajo y colapsable ═══ */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setVerLista((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition text-left"
          >
            <Package className="h-4 w-4 text-orange-500" />
            <h2 className="text-sm font-bold text-gray-800">Mis pedidos</h2>
            <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {visibles.length}
            </span>
            <span className="ml-auto text-gray-400">
              {verLista ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </button>

          {verLista && (
          <div className="p-3 space-y-1.5">
            {cargando && !pedidos.length && (
              <div className="bg-white rounded-xl border border-gray-200 text-center py-16 text-gray-400">
                <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
                <p className="text-sm">Cargando pedidos…</p>
              </div>
            )}

            {!cargando && !pedidos.length && (
              <div className="bg-white rounded-xl border border-gray-200 text-center py-16 px-4">
                <Package className="w-8 h-8 mx-auto mb-3 text-gray-200" />
                <p className="text-sm font-semibold text-gray-600">No hay pedidos para este día</p>
                <p className="text-xs text-gray-400 mt-1">Prueba con otra fecha.</p>
              </div>
            )}

            {!!pedidos.length && !visibles.length && (
              <div className="bg-white rounded-xl border border-gray-200 text-center py-10 px-4">
                <p className="text-sm text-gray-500">
                  {busqueda ? `Ningún pedido coincide con «${busqueda}».` : 'No hay pedidos en este filtro.'}
                </p>
              </div>
            )}

            {visibles.map((p) => (
              <TarjetaPedido
                key={p.id}
                pedido={p}
                camion={p.camion ? camionesGPS.find((c) => c.placa === p.camion) : null}
                color={p.camion ? colorDe(p.camion) : null}
              />
            ))}

          </div>
          )}
        </section>

        {!!pedidos.length && (
          <p className="text-[10px] text-gray-400 flex items-center gap-1.5 pb-4 px-1">
            <Clock className="w-3 h-3" />
            Las horas son estimadas; se ajustan cuando el camión sale del CEDIS.
            {actualizado && ` Actualizado ${actualizado.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}.`}
          </p>
        )}
      </main>
    </div>
  );
}
