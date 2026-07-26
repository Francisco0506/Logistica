import React, { useState } from 'react';
import { Eye, Search, MapPin, Clock, Truck, X, Package, ChevronDown, Check } from 'lucide-react';
import MiniMapa from '../../../components/MiniMapa';

const FILTROS = ['todos', 'pendiente', 'asignado', 'en_camino', 'entregado'];

const CLASE_ESTADO = {
  Entregado: 'bg-emerald-50 text-emerald-700',
  En_Camino: 'bg-blue-50 text-blue-700',
  Asignado: 'bg-orange-50 text-orange-700',
};

/**
 * Los pedidos del día.
 *
 * Incluye la ventana de recibo del cliente, que es el dato que explica por qué
 * las rutas van apretadas (97 de 195 destinos cierran antes de las 14:00) y que
 * antes no se mostraba en ningún lado del panel.
 *
 * Al hacer clic en un renglón se abre el detalle completo del pedido: la
 * dirección entera, el horario, el camión y la hora. En la tabla la dirección
 * va recortada porque son 80 renglones; el detalle es para cuando hace falta
 * leerla toda, por ejemplo al contestarle a un cliente.
 */
export default function TablaPedidos({
  pedidos,
  filtro,
  onFiltro,
  busqueda,
  onBusqueda,
  colorDe,
  onEnfocar,
  camiones = [],
  camionFiltro,
  onCamionFiltro,
  camionesGPS = [],
}) {
  const [detalle, setDetalle] = useState(null);
  const [abrirCamiones, setAbrirCamiones] = useState(false);

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center gap-3 border-b border-gray-200 mb-2 flex-wrap">
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

        <div className="ml-auto flex items-center gap-2 pb-1.5">
          {/* Filtrar por camión: revisar la carga de UNA unidad sin leer los 80
              renglones buscando su placa a ojo. Va como menú propio y no como
              lista del sistema, para que traiga el color de cada camión y se
              vea igual en cualquier computadora. */}
          <div className="relative">
            <button
              onClick={() => setAbrirCamiones((v) => !v)}
              className="flex items-center gap-2 bg-gray-50 border border-gray-200 hover:bg-gray-100 rounded-lg pl-2.5 pr-2 py-1.5 text-xs font-semibold text-gray-600 transition"
            >
              {camionFiltro !== 'todos' && camionFiltro !== 'sin_camion' && (
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorDe(camionFiltro) }} />
              )}
              {camionFiltro === 'todos' ? 'Todos los camiones'
                : camionFiltro === 'sin_camion' ? 'Sin camión'
                : camionFiltro}
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>

            {abrirCamiones && (
              <>
                {/* Capa para cerrar al hacer clic afuera. */}
                <div className="fixed inset-0 z-10" onClick={() => setAbrirCamiones(false)} />
                <div className="absolute right-0 mt-1 z-20 w-52 bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-72 overflow-y-auto">
                  {[
                    { valor: 'todos', texto: 'Todos los camiones', n: pedidos.length },
                    { valor: 'sin_camion', texto: 'Sin camión', n: null },
                    ...camiones.map((c) => ({ valor: c.id, texto: c.id, color: c.color, n: null })),
                  ].map((op) => (
                    <button
                      key={op.valor}
                      onClick={() => { onCamionFiltro(op.valor); setAbrirCamiones(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-left transition ${
                        camionFiltro === op.valor ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {op.color
                        ? <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: op.color }} />
                        : <span className="w-2.5 flex-shrink-0" />}
                      {op.texto}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              value={busqueda}
              onChange={(e) => onBusqueda(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium w-40 focus:outline-none focus:ring-2 focus:ring-orange-200"
              placeholder="Buscar…"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-400 uppercase">
            <tr>
              <th className="px-3 py-2" title="Número de remisión de SAP (DocNum)">ID</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2">Recibe</th>
              <th className="px-3 py-2">Llega</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-center">Ver</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
            {pedidos.map((o) => {
              const entregado = o.estado === 'Entregado';
              return (
                <tr
                  key={o.id}
                  onClick={() => setDetalle(o)}
                  className="hover:bg-orange-50/40 transition cursor-pointer"
                  title="Ver el detalle del pedido"
                >
                  <td className="px-3 py-2 font-mono font-bold text-gray-800">#{o.doc_num}</td>
                  <td className="px-3 py-2 font-semibold">
                    <div className="truncate max-w-[180px]" title={o.card_name}>{o.card_name}</div>
                    <div className="text-[9px] text-gray-400 truncate max-w-[180px]">{o.address}</div>
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
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.eta && o.eta !== 'Pendiente' ? (
                      <span className="font-semibold">
                        {/* Ya entregado: la hora es un hecho, no una promesa. */}
                        {entregado && <span className="text-[9px] font-bold text-emerald-600 uppercase mr-1">Llegó</span>}
                        {o.eta}
                      </span>
                    ) : <span className="text-gray-300 italic text-[10px]">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                      CLASE_ESTADO[o.estado] || 'bg-gray-100 text-gray-500'
                    }`}>
                      {entregado && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
                      {o.estado?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {o.lat && o.lng ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onEnfocar([o.lat, o.lng]); }}
                        title="Centrar el mapa en este cliente"
                        className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-orange-600 transition"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
            {!pedidos.length && (
              <tr><td colSpan="7" className="text-center py-8 text-gray-400 italic">Sin pedidos.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Detalle del pedido ── */}
      {detalle && (
        <div className="fixed inset-0 z-[3000] bg-black/40 flex items-center justify-center p-4" onClick={() => setDetalle(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-bold text-gray-400">#{detalle.doc_num}</span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                    CLASE_ESTADO[detalle.estado] || 'bg-gray-100 text-gray-500'
                  }`}>
                    {detalle.estado?.replace('_', ' ')}
                  </span>
                </div>
                <h3 className="text-base font-bold text-gray-800 mt-1">{detalle.card_name}</h3>
              </div>
              <button onClick={() => setDetalle(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dónde queda, de un vistazo. Antes el detalle solo traía la
                dirección en texto, que no dice nada si no te sabes la calle. */}
            <div className="px-5 pt-4">
              <MiniMapa
                lat={detalle.lat}
                lng={detalle.lng}
                nombre={detalle.card_name}
                color={detalle.truck ? colorDe(detalle.truck) : '#f97316'}
                camion={detalle.truck ? camionesGPS.find((c) => c.placa === detalle.truck) : null}
              />
            </div>

            <div className="px-5 py-4 space-y-3 text-sm">
              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Dirección de entrega</div>
                  <div className="text-gray-700">{detalle.address || 'Sin dirección en SAP'}</div>
                  {detalle.lat && detalle.lng && (
                    <div className="text-[10px] text-gray-400 mt-0.5 font-mono">
                      {detalle.lat.toFixed(5)}, {detalle.lng.toFixed(5)}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Horario del cliente</div>
                  <div className="text-gray-700">{detalle.ventana || 'Sin horario capturado'}</div>
                  {detalle.eta && detalle.eta !== 'Pendiente' && (
                    <div className="text-gray-700 mt-0.5">
                      {detalle.estado === 'Entregado' ? 'Llegó' : 'Llega'} a las <b>{detalle.eta}</b>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Truck className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Camión</div>
                  <div className="text-gray-700">
                    {detalle.truck
                      ? <>{detalle.truck}{detalle.secuencia_ruta ? ` · parada ${detalle.secuencia_ruta}` : ''}</>
                      : 'Todavía no está en ninguna ruta'}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Package className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Pedido</div>
                  <div className="text-gray-700">
                    ${detalle.doc_total?.toLocaleString('es-MX')}
                    {detalle.peso_kg != null
                      ? ` · ${detalle.peso_kg} kg`
                      : <span className="text-gray-400"> · peso no disponible en SAP</span>}
                  </div>
                </div>
              </div>
            </div>

            {detalle.lat && detalle.lng && (
              <div className="px-5 pb-5">
                <button
                  onClick={() => { onEnfocar([detalle.lat, detalle.lng]); setDetalle(null); }}
                  className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs py-2.5 rounded-lg transition"
                >
                  <MapPin className="w-3.5 h-3.5" /> Ver en el mapa
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
