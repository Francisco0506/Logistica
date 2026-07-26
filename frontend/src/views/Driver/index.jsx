import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Truck, MapPin, Clock, Phone, Navigation, Check, AlertTriangle,
  ChevronRight, LogOut, RefreshCw, PackageCheck,
} from 'lucide-react';
import LabenLogo from '../../components/LabenLogo';
import { useAviso } from '../../components/useAviso';
import { getFlota, getRutaChofer, confirmarEntrega } from '../../services/api';
import HojaEntrega from './components/HojaEntrega';

/**
 * La app del chofer.
 *
 * Pensada PARA CELULAR primero: se usa de pie, en la calle, con una mano y a
 * veces con prisa. De ahí las decisiones — botones grandes, poco texto, la
 * siguiente parada siempre hasta arriba, y el camino normal ("entregué todo")
 * en un solo toque.
 *
 * Es la única pieza que le dice al sistema qué pasó de verdad. Sin ella,
 * "Entregado" solo significa que alguien en la oficina cerró la ruta.
 */

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Se refresca para que el chofer vea si el despachador le movió algo.
const REFRESH_MS = 60_000;

const ESTILO_ESTADO = {
  Entregado:         { texto: 'Entregado',    clase: 'bg-emerald-50 text-emerald-700 border-emerald-200', icono: Check },
  Entregado_Parcial: { texto: 'Incompleto',   clase: 'bg-amber-50 text-amber-700 border-amber-200',       icono: AlertTriangle },
  No_Entregado:      { texto: 'No entregado', clase: 'bg-red-50 text-red-700 border-red-200',             icono: AlertTriangle },
};

export default function DriverApp() {
  const navigate = useNavigate();
  const avisar = useAviso();
  const [params, setParams] = useSearchParams();

  // La placa puede venir en la dirección (?camion=RA7475A) para que el chofer
  // llegue directo a su ruta desde un enlace o un acceso directo del celular.
  // Si no viene, la escoge de una lista. Cuando haya usuarios de chofer esto
  // saldrá de su sesión y la lista desaparece.
  const camion = params.get('camion') || '';
  const [flota, setFlota] = useState([]);
  const [ruta, setRuta] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [abierta, setAbierta] = useState(null);   // parada con la hoja de entrega abierta
  const [guardando, setGuardando] = useState(false);
  const fecha = hoy();

  useEffect(() => {
    const c = new AbortController();
    getFlota({ signal: c.signal }).then(setFlota).catch(() => {});
    return () => c.abort();
  }, []);

  useEffect(() => {
    if (!camion) { setRuta(null); return; }
    const c = new AbortController();
    const traer = () => {
      getRutaChofer(fecha, camion, { signal: c.signal })
        .then(setRuta)
        .catch((e) => { if (e.name !== 'AbortError') console.error('Ruta chofer:', e); })
        .finally(() => setCargando(false));
    };
    setCargando(true);
    traer();
    const i = setInterval(traer, REFRESH_MS);
    return () => { c.abort(); clearInterval(i); };
  }, [camion, fecha]);

  const paradas = ruta?.paradas || [];
  const hechas = paradas.filter((p) => ESTILO_ESTADO[p.estado]).length;
  // La primera que todavía no se reporta. Sin useMemo a propósito: son 20
  // elementos y `paradas` se recrea en cada render, así que memorizarlo no
  // ahorraría nada y solo escondería la dependencia.
  const siguiente = paradas.find((p) => !ESTILO_ESTADO[p.estado]);

  const confirmar = async (datos) => {
    setGuardando(true);
    try {
      const res = await confirmarEntrega(abierta.id, datos);
      avisar(res.message, res.estado === 'Entregado' ? 'exito' : 'info');
      setAbierta(null);
      setRuta(await getRutaChofer(fecha, camion));
    } catch (e) {
      console.error('Confirmar entrega:', e);
      avisar('No se pudo guardar. Revisa tu señal e inténtalo otra vez.', 'error');
    } finally {
      setGuardando(false);
    }
  };

  // ── Escoger camión ──
  if (!camion) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
        <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
          <LabenLogo variant="horizontal" />
          <button onClick={() => navigate('/')} className="text-xs font-bold text-gray-400 flex items-center gap-1.5">
            <LogOut className="w-3.5 h-3.5" /> Salir
          </button>
        </header>
        <div className="flex-1 p-4">
          <h1 className="text-lg font-extrabold text-gray-800 mb-1">¿Cuál camión traes?</h1>
          <p className="text-[13px] text-gray-500 mb-4">Escoge tu unidad para ver tus entregas de hoy.</p>
          <div className="space-y-2">
            {flota.map((c) => (
              <button
                key={c.placa}
                onClick={() => setParams({ camion: c.placa })}
                className="w-full flex items-center gap-3 bg-white border border-gray-200 hover:border-gray-300 active:bg-gray-50 rounded-xl px-4 py-4 text-left transition"
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-extrabold text-gray-800">{c.placa}</div>
                  <div className="text-[11px] text-gray-400">{c.modelo} · Samsara {c.samsara}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* ═══ CABECERA — pegada arriba, con el avance siempre visible ═══ */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Truck className="w-5 h-5 text-orange-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[15px] font-extrabold text-gray-800 leading-none">{camion}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                {ruta?.hora_salida ? `Salió ${ruta.hora_salida}` : 'Sin salir del CEDIS'}
              </div>
            </div>
          </div>
          <button
            onClick={() => setParams({})}
            className="text-[11px] font-bold text-gray-400 hover:text-gray-600 px-2 py-1"
          >
            Cambiar
          </button>
        </div>

        {!!paradas.length && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between text-[11px] font-bold mb-1.5">
              <span className="text-gray-500">{hechas} de {paradas.length} entregas</span>
              <span className="text-gray-400">{paradas.length - hechas} por hacer</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${paradas.length ? (hechas / paradas.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </header>

      <main className="px-4 py-4 space-y-4 max-w-2xl mx-auto">
        {cargando && !ruta && (
          <div className="text-center py-16 text-gray-400">
            <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
            <p className="text-sm">Cargando tus entregas…</p>
          </div>
        )}

        {!cargando && !ruta && (
          <div className="bg-white rounded-xl border border-gray-200 text-center py-14 px-4">
            <Truck className="w-8 h-8 mx-auto mb-3 text-gray-200" />
            <p className="text-sm font-bold text-gray-600">El {camion} no tiene ruta para hoy</p>
            <p className="text-xs text-gray-400 mt-1">Pregunta en el CEDIS si ya se generaron las rutas.</p>
          </div>
        )}

        {!!paradas.length && hechas === paradas.length && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
            <PackageCheck className="w-7 h-7 mx-auto mb-2 text-emerald-600" />
            <p className="text-sm font-extrabold text-emerald-800">Terminaste tus {paradas.length} entregas</p>
            <p className="text-xs text-emerald-700 mt-0.5">Ya puedes regresar al CEDIS.</p>
          </div>
        )}

        {/* ── LA QUE SIGUE, destacada ── */}
        {siguiente && (
          <section>
            <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2 px-1">La que sigue</h2>
            <TarjetaParada parada={siguiente} destacada onAbrir={() => setAbierta(siguiente)} />
          </section>
        )}

        {/* ── TODAS ── */}
        {paradas.length > 1 && (
          <section>
            <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2 px-1">
              Todas tus paradas
            </h2>
            <div className="space-y-2">
              {paradas.map((p) => (
                <TarjetaParada key={p.id} parada={p} onAbrir={() => setAbierta(p)} />
              ))}
            </div>
          </section>
        )}
      </main>

      {abierta && (
        <HojaEntrega
          parada={abierta}
          guardando={guardando}
          onCerrar={() => setAbierta(null)}
          onConfirmar={confirmar}
        />
      )}
    </div>
  );
}

/**
 * Una parada en la lista: todo lo que el chofer necesita antes de bajarse del
 * camión, y los atajos para llamar o abrir la navegación.
 */
function TarjetaParada({ parada, destacada = false, onAbrir }) {
  const estado = ESTILO_ESTADO[parada.estado];
  const Icono = estado?.icono;
  const hecha = !!estado;

  return (
    <div className={`rounded-xl border overflow-hidden transition ${
      destacada ? 'border-orange-300 bg-white shadow-sm ring-2 ring-orange-100'
        : hecha ? 'border-gray-100 bg-gray-50/60'
        : 'border-gray-200 bg-white'
    }`}>
      <button onClick={onAbrir} className="w-full text-left px-4 py-3.5 flex items-start gap-3">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-extrabold flex-shrink-0 ${
          hecha ? 'bg-emerald-500 text-white' : destacada ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-600'
        }`}>
          {hecha ? <Check className="w-4 h-4" strokeWidth={3} /> : parada.secuencia_ruta}
        </span>

        <div className="flex-1 min-w-0">
          <div className={`text-[15px] font-extrabold leading-snug ${hecha ? 'text-gray-500' : 'text-gray-900'}`}>
            {parada.card_name}
          </div>
          <div className="text-[12px] text-gray-400 mt-0.5">{parada.address || 'Sin dirección'}</div>

          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
            {parada.eta && (
              <span className="text-[11px] font-bold text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {parada.eta}
              </span>
            )}
            {parada.ventana && <span className="text-[11px] text-gray-400">recibe {parada.ventana}</span>}
            <span className="text-[11px] text-gray-400">
              {parada.lineas.length} producto{parada.lineas.length === 1 ? '' : 's'}
            </span>
          </div>

          {estado && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border mt-2 ${estado.clase}`}>
              <Icono className="w-3 h-3" /> {estado.texto}
              {parada.entregado_en && ` · ${parada.entregado_en}`}
            </span>
          )}
        </div>

        <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0 mt-1" />
      </button>

      {/* Atajos: llamar y navegar. Van FUERA del botón principal para que un
          toque no abra la hoja de entrega sin querer. */}
      {!hecha && (
        <div className="flex border-t border-gray-100 divide-x divide-gray-100">
          {parada.telefono && (
            <a
              href={`tel:${parada.telefono}`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-bold text-gray-600 active:bg-gray-50"
            >
              <Phone className="w-3.5 h-3.5" /> Llamar
            </a>
          )}
          {parada.lat && parada.lng && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${parada.lat},${parada.lng}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-bold text-gray-600 active:bg-gray-50"
            >
              <Navigation className="w-3.5 h-3.5" /> Cómo llegar
            </a>
          )}
          <button
            onClick={onAbrir}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-extrabold text-orange-600 active:bg-orange-50"
          >
            <MapPin className="w-3.5 h-3.5" /> Entregar
          </button>
        </div>
      )}
    </div>
  );
}
