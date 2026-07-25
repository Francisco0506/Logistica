import React from 'react';
import { User, LogOut } from 'lucide-react';
import LabenLogo from '../../../components/LabenLogo';

// Cómo se ve el estado de la conexión con SAP. El texto largo va en el `title`
// para no ocupar el header, pero el color y la etiqueta corta dicen de un
// vistazo si los pedidos que estás viendo son reales o de prueba.
const ESTILOS_SYNC = {
  ok:       { caja: 'bg-emerald-50 border-emerald-200', punto: 'bg-emerald-500 animate-pulse', texto: 'text-emerald-700', etiqueta: 'SAP B1' },
  warning:  { caja: 'bg-amber-50 border-amber-200',     punto: 'bg-amber-500',                 texto: 'text-amber-700',   etiqueta: 'Sin SAP · prueba' },
  error:    { caja: 'bg-red-50 border-red-200',         punto: 'bg-red-500',                   texto: 'text-red-700',     etiqueta: 'SAP falló' },
  cargando: { caja: 'bg-gray-100 border-gray-200',      punto: 'bg-gray-400 animate-pulse',    texto: 'text-gray-500',    etiqueta: 'Conectando…' },
};

export default function HeaderDespacho({
  fecha,
  onFecha,
  estadoSync,
  tipoSync,
  onSalir,
}) {
  const estilo = ESTILOS_SYNC[tipoSync] || ESTILOS_SYNC.cargando;

  // Pegado arriba: la página se recorre hacia abajo y la fecha y el estado de
  // SAP tienen que seguir a la vista sin importar dónde vayas.
  return (
    <header className="sticky top-0 z-[1100] bg-white/95 backdrop-blur border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <LabenLogo variant="horizontal" />
        <span className="text-[9px] text-gray-300 font-bold tracking-[.2em] uppercase self-end pb-0.5">· Despacho</span>
      </div>

      <div className="flex items-center gap-4">
        <input
          type="date"
          value={fecha}
          onChange={(e) => onFecha(e.target.value)}
          title="Día que se está viendo y sincronizando"
          className="text-xs font-semibold text-gray-700 bg-gray-100 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-200"
        />

        <div title={estadoSync} className={`flex items-center gap-2 rounded-lg px-3 py-1 border ${estilo.caja}`}>
          <span className={`w-2 h-2 rounded-full ${estilo.punto}`} />
          <span className={`text-[10px] font-bold uppercase ${estilo.texto}`}>{estilo.etiqueta}</span>
        </div>

        <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5">
          <User className="h-3.5 w-3.5 text-gray-500" />
          <span className="text-xs font-bold text-gray-700">Norberto</span>
        </div>

        <button
          onClick={onSalir}
          title="Cerrar sesión — las rutas y pedidos quedan guardados en el servidor, no se pierden"
          className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg px-2.5 py-1.5 transition"
        >
          <LogOut className="h-3.5 w-3.5" /> Salir
        </button>
      </div>
    </header>
  );
}
