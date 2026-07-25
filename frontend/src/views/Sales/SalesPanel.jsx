import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LogOut, User, RefreshCw, Truck, CheckCircle2, Package, AlertCircle } from 'lucide-react';
import LabenLogo from '../../components/LabenLogo';
import { getVendedores, getPedidosVendedor } from '../../services/api';
import TarjetaPedido from './components/TarjetaPedido';

// Se refresca solo para que la vendedora no tenga que recargar mientras le
// contesta a un cliente por teléfono.
const REFRESH_INTERVAL_MS = 60_000;

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Los pedidos se agrupan por lo que la vendedora necesita saber, en el orden en
// que le urge: lo que está pasando ahora, lo que ya quedó programado, lo que
// NO va a salir (que es lo que tiene que resolver), y al final lo entregado.
const GRUPOS = [
  { id: 'En_Camino', titulo: 'En camino', icono: Truck,        clase: 'text-blue-600' },
  { id: 'Asignado',  titulo: 'Programados hoy', icono: Package, clase: 'text-orange-600' },
  { id: 'Pendiente', titulo: 'Sin programar', icono: AlertCircle, clase: 'text-red-600' },
  { id: 'Entregado', titulo: 'Entregados', icono: CheckCircle2, clase: 'text-emerald-600' },
];

export default function SalesPanel() {
  const navigate = useNavigate();
  const [fecha, setFecha]           = useState(hoy());
  const [vendedores, setVendedores] = useState([]);
  const [slpCode, setSlpCode]       = useState('');
  const [pedidos, setPedidos]       = useState([]);
  const [busqueda, setBusqueda]     = useState('');
  const [cargando, setCargando]     = useState(true);
  const [error, setError]           = useState(null);

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
        .then((ps) => { setPedidos(ps); setError(null); })
        .catch((e) => {
          if (e.name === 'AbortError') return;
          console.error('Pedidos:', e);
          setError('No se pudo conectar con el servidor.');
        })
        .finally(() => setCargando(false));
    };

    setCargando(true);
    traer();
    const interval = setInterval(traer, REFRESH_INTERVAL_MS);
    return () => { controller.abort(); clearInterval(interval); };
  }, [fecha, slpCode]);

  const vendedor = vendedores.find((v) => v.slp_code === slpCode);

  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return pedidos;
    const q = busqueda.toLowerCase();
    return pedidos.filter(
      (p) => p.card_name?.toLowerCase().includes(q) || String(p.doc_num).includes(q)
    );
  }, [pedidos, busqueda]);

  const resumen = useMemo(() => ({
    total: pedidos.length,
    enCamino: pedidos.filter((p) => p.estado === 'En_Camino').length,
    programados: pedidos.filter((p) => p.estado === 'Asignado').length,
    sinProgramar: pedidos.filter((p) => p.estado === 'Pendiente').length,
    entregados: pedidos.filter((p) => p.estado === 'Entregado').length,
  }), [pedidos]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* ═══ HEADER ═══ */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <LabenLogo variant="horizontal" />
            <span className="text-[9px] text-slate-300 font-bold tracking-[.2em] uppercase self-end pb-0.5 hidden sm:inline">
              · Ventas
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg px-2.5 py-1.5 transition"
            >
              <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* ── Quién soy ── */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
            <User className="w-5 h-5 text-orange-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Mostrando los pedidos de</div>
            {vendedores.length > 1 ? (
              <select
                value={slpCode}
                onChange={(e) => setSlpCode(e.target.value)}
                className="text-lg font-extrabold text-slate-800 bg-transparent border-0 -ml-1 px-1 py-0 focus:outline-none focus:ring-2 focus:ring-orange-200 rounded cursor-pointer"
              >
                {vendedores.map((v) => (
                  <option key={v.slp_code} value={v.slp_code}>{v.slp_name} ({v.pedidos})</option>
                ))}
              </select>
            ) : (
              <div className="text-lg font-extrabold text-slate-800 truncate">
                {vendedor?.slp_name || (cargando ? 'Cargando…' : 'Sin pedidos este día')}
              </div>
            )}
          </div>

          {/* Resumen */}
          <div className="flex items-stretch gap-4 sm:gap-6 border-t sm:border-t-0 sm:border-l border-slate-100 pt-3 sm:pt-0 sm:pl-6">
            {[
              { n: resumen.total, t: 'Pedidos', c: 'text-slate-800' },
              { n: resumen.enCamino, t: 'En camino', c: resumen.enCamino ? 'text-blue-600' : 'text-slate-300' },
              { n: resumen.sinProgramar, t: 'Sin programar', c: resumen.sinProgramar ? 'text-red-600' : 'text-slate-300' },
            ].map((m) => (
              <div key={m.t}>
                <div className={`text-xl font-extrabold leading-none ${m.c}`}>{m.n}</div>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mt-1">{m.t}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Buscador ── */}
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center focus-within:ring-2 focus-within:ring-orange-200 transition">
          <Search className="text-slate-400 w-4 h-4 mr-3 flex-shrink-0" />
          <input
            type="text"
            placeholder="Buscar por cliente o número de remisión…"
            className="w-full text-sm outline-none text-slate-700 bg-transparent"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          {busqueda && (
            <button onClick={() => setBusqueda('')} className="text-[11px] font-bold text-slate-400 hover:text-slate-600 ml-2">
              Limpiar
            </button>
          )}
        </div>

        {/* ── Estados ── */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {cargando && !pedidos.length && (
          <div className="text-center py-16 text-slate-400">
            <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
            <p className="text-sm">Cargando pedidos…</p>
          </div>
        )}

        {!cargando && !pedidos.length && !error && (
          <div className="bg-white rounded-xl border border-slate-200 text-center py-16 px-4">
            <Package className="w-8 h-8 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">No hay pedidos para este día</p>
            <p className="text-xs text-slate-400 mt-1">Prueba con otra fecha.</p>
          </div>
        )}

        {/* ── Pedidos agrupados ── */}
        {GRUPOS.map(({ id, titulo, icono: Icono, clase }) => {
          const delGrupo = filtrados.filter((p) => p.estado === id);
          if (!delGrupo.length) return null;
          return (
            <section key={id} className="space-y-2">
              <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 px-1">
                <Icono className={`w-3.5 h-3.5 ${clase}`} /> {titulo}
                <span className="text-slate-300 font-semibold">({delGrupo.length})</span>
              </h2>
              <div className="space-y-2">
                {delGrupo.map((p) => <TarjetaPedido key={p.id} pedido={p} />)}
              </div>
            </section>
          );
        })}

        {busqueda && !filtrados.length && pedidos.length > 0 && (
          <p className="text-center text-sm text-slate-400 py-10">
            Ningún pedido coincide con «{busqueda}».
          </p>
        )}
      </main>
    </div>
  );
}
