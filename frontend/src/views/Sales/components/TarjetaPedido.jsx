import React from 'react';
import { Truck, Clock, MapPin, CheckCircle2, AlertCircle, Package } from 'lucide-react';

/**
 * Un pedido como lo ve la vendedora: qué es, a qué hora llega y qué está
 * pasando con él. La idea es que pueda contestarle al cliente sin preguntarle
 * a nadie más.
 *
 * La hora se muestra como RANGO ("entre 09:00 y 09:15") y no como hora exacta:
 * una hora al minuto suena a promesa que no se puede cumplir.
 */

const ESTILOS = {
  Entregado: {
    icono: CheckCircle2,
    pill: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    barra: 'bg-emerald-500',
    texto: 'Entregado',
  },
  En_Camino: {
    icono: Truck,
    pill: 'bg-blue-50 text-blue-700 border-blue-200',
    barra: 'bg-blue-500',
    texto: 'En camino',
  },
  Asignado: {
    icono: Package,
    pill: 'bg-orange-50 text-orange-700 border-orange-200',
    barra: 'bg-orange-400',
    texto: 'Programado',
  },
  Pendiente: {
    icono: AlertCircle,
    pill: 'bg-gray-100 text-gray-600 border-gray-200',
    barra: 'bg-gray-300',
    texto: 'Sin programar',
  },
};

export default function TarjetaPedido({ pedido }) {
  const estilo = ESTILOS[pedido.estado] || ESTILOS.Pendiente;
  const Icono = estilo.icono;

  return (
    <article className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex">
      {/* Franja de color: el estado se lee de reojo sin buscar la etiqueta */}
      <div className={`w-1.5 flex-shrink-0 ${estilo.barra}`} />

      <div className="flex-1 min-w-0 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-slate-400 font-mono">#{pedido.doc_num}</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${estilo.pill}`}>
              <Icono className="w-3 h-3" /> {estilo.texto}
            </span>
            {pedido.camion && (
              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {pedido.camion}
              </span>
            )}
          </div>

          <h3 className="text-[15px] font-bold text-slate-800 mt-1 truncate" title={pedido.card_name}>
            {pedido.card_name}
          </h3>

          {pedido.address && (
            <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5 truncate">
              <MapPin className="w-3 h-3 flex-shrink-0" /> {pedido.address}
            </p>
          )}

          <p className="text-[12px] text-slate-600 mt-1.5 leading-snug">{pedido.situacion}</p>
        </div>

        {/* Bloque de horas */}
        <div className="sm:w-44 flex-shrink-0 sm:text-right space-y-1">
          {pedido.eta_desde ? (
            <div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Llega entre</div>
              <div className="text-lg font-extrabold text-slate-800 leading-tight tabular-nums">
                {pedido.eta_desde} – {pedido.eta_hasta}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Llega</div>
              <div className="text-sm font-bold text-slate-300 italic leading-tight">Sin hora aún</div>
            </div>
          )}

          {pedido.ventana && (
            <div className="text-[10px] text-slate-400 flex items-center gap-1 sm:justify-end">
              <Clock className="w-3 h-3" /> El cliente recibe {pedido.ventana}
            </div>
          )}

          <div className="text-[11px] font-bold text-slate-500">
            ${pedido.doc_total?.toLocaleString('es-MX')}
          </div>
        </div>
      </div>
    </article>
  );
}
