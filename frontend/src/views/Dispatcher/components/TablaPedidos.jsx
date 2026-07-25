import React from 'react';
import { Eye, Search } from 'lucide-react';

const FILTROS = ['todos', 'pendiente', 'asignado', 'en_camino', 'entregado'];

const CLASE_ESTADO = {
  Entregado: 'bg-emerald-50 text-emerald-700',
  En_Camino: 'bg-blue-50 text-blue-700',
  Asignado: 'bg-orange-50 text-orange-700',
};

/**
 * Los pedidos del día. Ahora incluye la ventana de recibo del cliente, que es
 * el dato que explica por qué las rutas van apretadas (97 de 195 destinos
 * cierran antes de las 14:00) y que hasta ahora no se mostraba en ningún lado
 * del panel aunque los 195 destinos la tienen capturada.
 */
export default function TablaPedidos({
  pedidos,
  filtro,
  onFiltro,
  busqueda,
  onBusqueda,
  colorDe,
  onEnfocar,
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0 px-3 pb-3">
      <div className="flex items-center gap-3 border-b border-gray-200 mb-2 flex-shrink-0">
        <div className="flex gap-3 text-[11px] font-bold flex-wrap">
          {FILTROS.map((f) => (
            <button
              key={f}
              onClick={() => onFiltro(f)}
              className={`pb-2 capitalize transition border-b-2 ${
                filtro === f ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="ml-auto relative pb-1.5">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            value={busqueda}
            onChange={(e) => onBusqueda(e.target.value)}
            className="pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium w-40 focus:outline-none focus:ring-2 focus:ring-orange-200"
            placeholder="Buscar…"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-400 uppercase sticky top-0">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2">Recibe</th>
              <th className="px-3 py-2">Llega</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-center">Ver</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
            {pedidos.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50/60 transition">
                <td className="px-3 py-2 font-mono font-bold text-gray-800">#{o.doc_num}</td>
                <td className="px-3 py-2 font-semibold">
                  <div className="truncate max-w-[180px]" title={o.card_name}>{o.card_name}</div>
                  <div className="text-[9px] text-gray-400 truncate max-w-[180px]" title={o.address}>{o.address}</div>
                </td>
                <td className="px-3 py-2">
                  {o.truck ? (
                    <span className="inline-flex items-center gap-1.5 font-bold">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorDe(o.truck) }} />
                      {o.truck}
                    </span>
                  ) : <span className="text-gray-400 italic text-[10px]">—</span>}
                </td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-[10px]">
                  {o.ventana || <span className="italic text-gray-300">sin horario</span>}
                </td>
                <td className="px-3 py-2 font-semibold whitespace-nowrap">
                  {o.eta && o.eta !== 'Pendiente'
                    ? o.eta
                    : <span className="text-gray-300 italic font-normal text-[10px]">—</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                    CLASE_ESTADO[o.estado] || 'bg-gray-100 text-gray-500'
                  }`}>
                    {o.estado?.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  {o.lat && o.lng ? (
                    <button
                      onClick={() => onEnfocar([o.lat, o.lng])}
                      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-orange-600 transition"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  ) : '—'}
                </td>
              </tr>
            ))}
            {!pedidos.length && (
              <tr><td colSpan="7" className="text-center py-8 text-gray-400 italic">Sin pedidos.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
