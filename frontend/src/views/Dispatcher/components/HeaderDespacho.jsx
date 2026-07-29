import React from 'react';
import { User, LogOut, RefreshCw } from 'lucide-react';
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
  jornada,
  onActualizar,
  actualizando = false,
}) {
  const estilo = ESTILOS_SYNC[tipoSync] || ESTILOS_SYNC.cargando;

  // La fecha del panel no es la de hoy y eso confunde si no se explica: la
  // entrega capturada un día sale al siguiente (ver docs/flujo-documentos-sap.md).
  // En la mañana el panel prepara el reparto de HOY con las entregas de ayer;
  // pasadas las 11 ya prepara el de MAÑANA con las de hoy.
  //
  // El aviso solo sale mientras se esté viendo el día que el backend propuso: si
  // el usuario se mueve a otra fecha a mano, estorba.
  const enJornada = jornada && jornada.fecha_carga === fecha;
  const paraMañana = enJornada && jornada.para === 'mañana';

  // Pegado arriba: la página se recorre hacia abajo y la fecha y el estado de
  // SAP tienen que seguir a la vista sin importar dónde vayas.
  return (
    <header className="sticky top-0 z-[1100] bg-white/95 backdrop-blur border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <LabenLogo variant="horizontal" />
        <span className="text-[9px] text-gray-300 font-bold tracking-[.2em] uppercase self-end pb-0.5">· Despacho</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {/* Para qué día se está planeando. Es lo primero que hay que saber al
              ver el panel: la fecha del selector es la de los DOCUMENTOS, no la
              del reparto, y sin esto se leen al revés. */}
          {enJornada && (
            <span
              className={`text-[10px] font-bold uppercase tracking-wide rounded-md px-2 py-1 border ${
                paraMañana
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
            >
              {paraMañana ? 'Preparando mañana' : 'Sale hoy'}
            </span>
          )}

          <div className="flex flex-col items-end">
            <input
              type="date"
              value={fecha}
              onChange={(e) => onFecha(e.target.value)}
              title="Día en que se CAPTURARON las entregas, no el día que salen"
              className="text-xs font-semibold text-gray-700 bg-gray-100 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            {enJornada && (
              <span
                title={jornada.explicacion}
                className="text-[10px] text-gray-500 mt-0.5 max-w-[17rem] truncate"
              >
                {jornada.explicacion}
              </span>
            )}
          </div>
        </div>

        {onActualizar && (
          <button
            onClick={onActualizar}
            disabled={actualizando}
            title="Traer lo que almacén haya capturado desde la última vez, sin recargar la página"
            className="flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-orange-600 hover:bg-orange-50 disabled:opacity-50 border border-gray-200 rounded-lg px-2.5 py-1.5 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${actualizando ? 'animate-spin' : ''}`} />
            {actualizando ? 'Buscando…' : 'Actualizar'}
          </button>
        )}

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
