import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, LogOut, User, RefreshCw, Truck, CheckCircle2, Package, AlertCircle,
  Map as MapIcon, List, ChevronDown, ChevronUp, Clock,
} from 'lucide-react';
import LabenLogo from '../../components/LabenLogo';
import { useAviso } from '../../components/useAviso';
import { getVendedores, getPedidosVendedor, getCamionesGPS } from '../../services/api';
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

// Los pedidos se agrupan por lo que la vendedora necesita saber, en el orden en
// que le urge: lo que está pasando ahora, lo que ya quedó programado, lo que NO
// va a salir (que es lo que tiene que resolver), y al final lo entregado — ese
// va CERRADO, porque ya no hay nada que hacer con él y es el que más se
// acumula conforme avanza el día.
const GRUPOS = [
  { id: 'En_Camino', titulo: 'En camino', icono: Truck, clase: 'text-blue-600', abierto: true },
  { id: 'Asignado', titulo: 'Programados hoy', icono: Package, clase: 'text-orange-600', abierto: true },
  { id: 'Pendiente', titulo: 'Sin programar', icono: AlertCircle, clase: 'text-red-600', abierto: true },
  { id: 'Entregado', titulo: 'Entregados', icono: CheckCircle2, clase: 'text-emerald-600', abierto: false },
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
  const [cargando, setCargando]     = useState(true);
  const [verMapa, setVerMapa]       = useState(true);
  const [actualizado, setActualizado] = useState(null);
  const [gruposAbiertos, setGruposAbiertos] = useState(
    () => new Set(GRUPOS.filter((g) => g.abierto).map((g) => g.id))
  );

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

  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return pedidos;
    const q = busqueda.toLowerCase();
    return pedidos.filter(
      (p) => p.card_name?.toLowerCase().includes(q)
        || String(p.doc_num).includes(q)
        || p.camion?.toLowerCase().includes(q)
    );
  }, [pedidos, busqueda]);

  const resumen = useMemo(() => ({
    total: pedidos.length,
    enCamino: pedidos.filter((p) => p.estado === 'En_Camino').length,
    sinProgramar: pedidos.filter((p) => p.estado === 'Pendiente').length,
    entregados: pedidos.filter((p) => p.estado === 'Entregado').length,
  }), [pedidos]);

  const alternarGrupo = (id) =>
    setGruposAbiertos((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });

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

        <div className="flex items-center gap-2 sm:gap-4">
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            title="Día que se está consultando"
            className="text-xs font-semibold text-gray-700 bg-gray-100 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          <div className="hidden sm:flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5">
            <User className="h-3.5 w-3.5 text-gray-500" />
            <span className="text-xs font-bold text-gray-700 truncate max-w-[140px]">
              {vendedor?.slp_name || '—'}
            </span>
          </div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg px-2.5 py-1.5 transition"
          >
            <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-5">

        {/* ═══ RESUMEN — mismas tarjetas que el dispatcher ═══ */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { etiqueta: 'Mis pedidos', valor: resumen.total, clase: 'text-gray-800' },
            { etiqueta: 'En camino', valor: resumen.enCamino, clase: resumen.enCamino ? 'text-blue-600' : 'text-gray-300' },
            { etiqueta: 'Sin programar', valor: resumen.sinProgramar, clase: resumen.sinProgramar ? 'text-red-600' : 'text-gray-300' },
            { etiqueta: 'Entregados', valor: resumen.entregados, clase: resumen.entregados ? 'text-emerald-600' : 'text-gray-300' },
          ].map((m) => (
            <div key={m.etiqueta} className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm">
              <div className={`text-2xl font-extrabold leading-none ${m.clase}`}>{m.valor}</div>
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mt-1.5">{m.etiqueta}</div>
            </div>
          ))}
        </section>

        {/* Quién soy y cuándo se actualizó — misma línea de contexto que el
            "Plan generado a las…" del dispatcher. */}
        <div className="flex items-center gap-2 text-[11px] text-gray-500 -mt-2 px-1 flex-wrap">
          <User className="w-3.5 h-3.5 text-gray-400" />
          {vendedores.length > 1 ? (
            <>
              <span>Pedidos de</span>
              <select
                value={slpCode}
                onChange={(e) => setSlpCode(e.target.value)}
                className="font-bold text-gray-700 bg-transparent border-0 p-0 focus:outline-none focus:ring-2 focus:ring-orange-200 rounded cursor-pointer"
              >
                {vendedores.map((v) => (
                  <option key={v.slp_code} value={v.slp_code}>{v.slp_name} ({v.pedidos})</option>
                ))}
              </select>
            </>
          ) : (
            <span>Pedidos de <b className="text-gray-700">{vendedor?.slp_name || '—'}</b></span>
          )}
          {actualizado && (
            <span className="text-gray-400">
              · actualizado {actualizado.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* ═══ BUSCADOR + MAPA ═══ */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center focus-within:ring-2 focus-within:ring-orange-200 transition">
            <Search className="text-gray-400 w-4 h-4 mr-3 flex-shrink-0" />
            <input
              type="text"
              placeholder="Buscar por cliente, remisión o placa…"
              className="w-full text-sm outline-none text-gray-700 bg-transparent"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            {busqueda && (
              <button onClick={() => setBusqueda('')} className="text-[11px] font-bold text-gray-400 hover:text-gray-600 ml-2">
                Limpiar
              </button>
            )}
          </div>
          <button
            onClick={() => setVerMapa((v) => !v)}
            className="flex items-center justify-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl px-4 py-3 text-xs font-bold text-gray-600 transition flex-shrink-0"
          >
            {verMapa ? <><List className="w-4 h-4" /> Ocultar mapa</> : <><MapIcon className="w-4 h-4" /> Ver en el mapa</>}
          </button>
        </div>

        {verMapa && !!pedidos.length && (
          <MapaPedidos pedidos={filtrados} camionesGPS={camionesGPS} />
        )}

        {/* ═══ ESTADOS ═══ */}
        {cargando && !pedidos.length && (
          <div className="text-center py-16 text-gray-400">
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

        {/* ═══ PEDIDOS AGRUPADOS — secciones que se abren y cierran, igual que
            Pedidos y Manifiesto en el dispatcher ═══ */}
        {GRUPOS.map(({ id, titulo, icono: Icono, clase }) => {
          const delGrupo = filtrados.filter((p) => p.estado === id);
          if (!delGrupo.length) return null;
          const abierto = gruposAbiertos.has(id);

          return (
            <section key={id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <button
                onClick={() => alternarGrupo(id)}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 transition text-left"
              >
                <Icono className={`w-4 h-4 ${clase}`} />
                <h2 className="text-sm font-bold text-gray-800">{titulo}</h2>
                <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  {delGrupo.length}
                </span>
                <span className="ml-auto text-gray-400">
                  {abierto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </span>
              </button>

              {abierto && (
                <div className="p-3 pt-0 space-y-2">
                  {delGrupo.map((p) => (
                    <TarjetaPedido
                      key={p.id}
                      pedido={p}
                      camion={p.camion ? camionesGPS.find((c) => c.placa === p.camion) : null}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {busqueda && !filtrados.length && pedidos.length > 0 && (
          <p className="text-center text-sm text-gray-400 py-10">
            Ningún pedido coincide con «{busqueda}».
          </p>
        )}

        {/* Las horas son estimadas, igual que en el dispatcher. Aquí importa
            todavía más: la vendedora es justo quien se las promete al cliente. */}
        {!!pedidos.length && (
          <p className="text-[11px] text-gray-400 flex items-center gap-1.5 px-1 pb-4">
            <Clock className="w-3.5 h-3.5" />
            Las horas son estimadas. Se ajustan solas cuando el camión sale del CEDIS.
          </p>
        )}
      </main>
    </div>
  );
}
