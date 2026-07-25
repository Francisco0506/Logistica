import React from 'react';
import { Truck, ChevronDown, ChevronUp, MapPin, Clock, Power } from 'lucide-react';
import EstadoDespacho from './EstadoDespacho';

/**
 * Un camión en el panel: placa, ficha, y al abrirlo el avance de despacho y
 * sus paradas en orden.
 */
export default function TarjetaCamion({
  camion,
  ruta,
  paradas,
  abierto,
  cambiandoEstado,
  onAbrir,
  onToggleActivo,
  onCambiarChofer,
  onCambiarEstado,
  onEnfocar,
}) {
  const entregadas = paradas.filter((o) => o.estado === 'Entregado').length;
  const porcentajeEntregado = paradas.length ? (entregadas / paradas.length) * 100 : 0;
  // La próxima parada es la primera que todavía no se entrega.
  const proxima = paradas.find((o) => o.estado !== 'Entregado');

  return (
    // Abierto = es el que se está viendo en el mapa. El anillo lo conecta con
    // el trazo de allá, para que no haya que adivinar de quién es la línea.
    <div className={`rounded-lg border overflow-hidden transition-all ${
      !camion.active ? 'border-gray-100 bg-gray-50 opacity-60'
        : abierto ? 'border-transparent bg-white ring-2 shadow-sm'
        : 'border-gray-200 bg-white'
    }`}
      style={abierto && camion.active ? { '--tw-ring-color': camion.color } : undefined}
    >
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none"
        onClick={() => camion.active && onAbrir()}
      >
        <Truck className="h-4 w-4 flex-shrink-0" style={{ color: camion.active ? camion.color : '#94a3b8' }} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-gray-800 text-[13px] tracking-wide">{camion.id}</span>
            {camion.capacidadKg && (
              <span
                title={`${camion.modelo}: carga hasta ${camion.capacidadKg.toLocaleString()} kg y ha hecho hasta ${camion.maxParadas} entregas en un día (medido con GPS)`}
                className="text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md flex-shrink-0"
              >
                {(camion.capacidadKg / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} ton · {camion.maxParadas} ped.
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-400 font-medium truncate">
            {camion.modelo ? `${camion.modelo} · ` : ''}
            {camion.samsara ? `Samsara ${camion.samsara} · ` : ''}
            {camion.driver || 'Sin chofer'}
          </div>
        </div>

        {camion.active && paradas.length > 0 && (
          <span className="text-[9px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-md flex-shrink-0">
            {paradas.length} ped.
          </span>
        )}


        <button
          onClick={(e) => { e.stopPropagation(); onToggleActivo(); }}
          className={`p-1.5 rounded-lg border transition flex-shrink-0 ${
            camion.active
              ? 'bg-orange-50 border-orange-200 text-orange-500 hover:bg-orange-100'
              : 'bg-gray-100 border-gray-200 text-gray-400 hover:bg-gray-200'
          }`}
          title={camion.active ? 'Sacar de la optimización' : 'Meter a la optimización'}
        >
          <Power className="h-3.5 w-3.5" />
        </button>

        {camion.active && (abierto
          ? <ChevronUp className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />)}
      </div>

      {abierto && camion.active && (
        <div className="px-3 -mt-1 pb-1">
          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: camion.color }}>
            <MapPin className="w-2.5 h-2.5" /> Viendo esta ruta en el mapa
          </span>
        </div>
      )}

      {/* Avance SIN tener que abrir la tarjeta: cuántas entregó, en qué estado
          va la ruta y cuál es la próxima parada. Antes había que expandir cada
          camión, uno por uno, solo para saber cómo iba. */}
      {camion.active && !abierto && paradas.length > 0 && (
        <div className="px-3 pb-2.5 -mt-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${porcentajeEntregado}%`, backgroundColor: camion.color }}
              />
            </div>
            <span className="text-[9px] font-bold text-gray-400 tabular-nums flex-shrink-0">
              {entregadas}/{paradas.length}
            </span>
            {ruta && (
              <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                ruta.estado === 'En_Ruta' ? 'bg-blue-50 text-blue-700'
                : ruta.estado === 'Finalizada' ? 'bg-emerald-50 text-emerald-700'
                : ruta.estado === 'Borrador' ? 'bg-gray-100 text-gray-500'
                : 'bg-orange-50 text-orange-700'
              }`}>
                {ruta.estado.replace('_', ' ')}
              </span>
            )}
          </div>
          {proxima && (
            <div className="text-[9px] text-gray-500 truncate">
              <span className="font-bold text-gray-400">Sigue:</span> {proxima.card_name}
              {proxima.eta && <span className="text-gray-400"> · {proxima.eta}</span>}
            </div>
          )}
        </div>
      )}

      {abierto && camion.active && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3 space-y-3 text-xs">
          {/* Chofer: texto libre. Hoy vive solo en el navegador y se pierde al
              recargar — no hay lista de choferes todavía (docs/pendientes.md §1). */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase flex-shrink-0">Chofer</span>
            <input
              value={camion.driver}
              onChange={(e) => onCambiarChofer(e.target.value)}
              placeholder="Sin chofer"
              title="Se pierde al recargar la página: todavía no se guarda en el servidor"
              className="w-36 bg-white border border-gray-200 rounded px-2 py-0.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>

          {ruta && (
            <EstadoDespacho ruta={ruta} onCambiarEstado={onCambiarEstado} cambiando={cambiandoEstado} />
          )}

          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1.5">
              Paradas ({paradas.length})
            </span>
            {paradas.length > 0 ? (
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                {paradas.map((o, i) => (
                  <div
                    key={o.id}
                    onClick={(e) => { e.stopPropagation(); onEnfocar([o.lat, o.lng]); }}
                    className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2.5 py-2 cursor-pointer hover:border-gray-300 transition"
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: camion.color }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-700 text-[11px] truncate">
                        <span className="text-gray-400">#{o.doc_num}</span> {o.card_name}
                      </div>
                      <div className="text-[9px] text-gray-500 font-medium flex items-center gap-2">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Llega {o.eta || '—'}
                        </span>
                        {/* La ventana de recibo, que antes no se veía en ningún
                            lado: es lo que explica si la ETA es viable o no. */}
                        {o.ventana && <span className="text-gray-400">· recibe {o.ventana}</span>}
                      </div>
                    </div>
                    <MapPin className="h-3 w-3 text-gray-300 flex-shrink-0" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-gray-400 italic">Sin paradas aún. Presiona Optimizar.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
