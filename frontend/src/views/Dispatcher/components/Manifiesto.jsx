import React from 'react';
import { Eye, AlertCircle, Truck, Clock, Package } from 'lucide-react';

/**
 * Manifiesto de carga por camión, en orden LIFO: lo primero que se sube es lo
 * último que se entrega.
 *
 * Cada tarjeta contesta las tres preguntas de quien está por cargar un camión:
 * cuánto va a llevar, cuánto tiempo va a andar fuera, y en qué orden sube la
 * mercancía.
 *
 * Ojo con el peso: SAP todavía no manda el peso real de cada pedido, y en ese
 * caso aquí se dice que no se sabe, NUNCA se sustituye por el estimado de
 * 150 kg del optimizador — un peso inventado que se ve como medido es justo lo
 * que haría sobrecargar un camión con confianza.
 */
export default function Manifiesto({ camionesActivos, paradasDe, onVerPreview }) {
  const camionesConCarga = camionesActivos.filter((c) => paradasDe(c.id).length > 0);

  if (!camionesConCarga.length) {
    return (
      <div className="px-4 py-10 text-center">
        <Package className="w-7 h-7 mx-auto mb-2 text-gray-200" />
        <p className="text-xs text-gray-400">
          Todavía no hay rutas. Optimiza para generar los manifiestos de carga.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4">
      <p className="text-[11px] text-gray-400 mb-3">
        Orden de carga <b className="text-gray-500">LIFO</b> — lo primero que se sube al camión es lo último que se entrega.
      </p>

      {/* Cuadrícula: los manifiestos se comparan de lado a lado en vez de
          obligar a recorrer toda la página para ver el siguiente camión. */}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
        {camionesConCarga.map((camion) => {
          const pedidos = paradasDe(camion.id);
          const ordenDeCarga = [...pedidos].reverse();

          const conPeso = pedidos.filter((o) => o.peso_kg != null);
          const peso = conPeso.reduce((s, o) => s + o.peso_kg, 0);
          const faltanPesos = pedidos.length - conPeso.length;
          const pct = camion.capacidadKg ? Math.min(100, (peso / camion.capacidadKg) * 100) : 0;
          const sobrepeso = camion.capacidadKg && peso > camion.capacidadKg;

          const horas = pedidos.map((o) => o.eta).filter((e) => /^\d{1,2}:\d{2}$/.test(e || '')).sort();
          const span = horas.length ? `${horas[0]} – ${horas.at(-1)}` : null;

          return (
            <article key={camion.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden flex flex-col">
              {/* Cabecera con el color del camión */}
              <header className="px-4 py-3 text-white" style={{ backgroundColor: camion.color }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Truck className="w-4 h-4 flex-shrink-0 opacity-90" />
                    <span className="font-extrabold text-sm tracking-wide">{camion.id}</span>
                  </div>
                  <span className="text-[10px] font-bold bg-white/25 px-2 py-0.5 rounded-full flex-shrink-0">
                    {pedidos.length} pedidos
                  </span>
                </div>
                <div className="text-[10px] opacity-90 mt-0.5 truncate">
                  {camion.modelo} · {camion.driver || 'Sin chofer'}
                </div>
              </header>

              {/* Los dos números que importan antes de cargar */}
              <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
                <div className="px-4 py-2.5">
                  <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Carga</div>
                  <div className={`text-sm font-extrabold ${sobrepeso ? 'text-red-600' : 'text-gray-800'}`}>
                    {conPeso.length
                      ? <>{peso.toLocaleString('es-MX', { maximumFractionDigits: 0 })}<span className="text-[11px] font-bold text-gray-400"> / {camion.capacidadKg.toLocaleString()} kg</span></>
                      : <span className="text-gray-300">Sin dato</span>}
                  </div>
                  {!!conPeso.length && (
                    <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden mt-1.5">
                      <div
                        className={`h-full rounded-full ${sobrepeso ? 'bg-red-500' : pct > 85 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="px-4 py-2.5">
                  <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">En la calle</div>
                  <div className="text-sm font-extrabold text-gray-800 tabular-nums">
                    {span || <span className="text-gray-300">—</span>}
                  </div>
                  <div className="text-[9px] text-gray-400 mt-1 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" /> primera y última entrega
                  </div>
                </div>
              </div>

              {faltanPesos > 0 && (
                <p className="text-[10px] text-amber-700 bg-amber-50 border-b border-amber-100 px-4 py-1.5 flex items-start gap-1.5">
                  <AlertCircle className="w-3 h-3 flex-shrink-0 mt-px" />
                  <span>
                    {faltanPesos === pedidos.length
                      ? 'SAP no manda el peso: no se sabe cuánto lleva.'
                      : `Faltan ${faltanPesos} pesos: el total real es mayor.`}
                  </span>
                </p>
              )}

              {/* Orden de carga */}
              <ol className="flex-1 divide-y divide-gray-50">
                {ordenDeCarga.map((o, i) => (
                  <li key={o.id} className="flex items-center gap-2.5 px-4 py-2">
                    <span className="w-6 text-[11px] font-extrabold text-gray-300 tabular-nums flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0 text-[11px] font-semibold text-gray-700 truncate" title={o.card_name}>
                      {o.card_name}
                    </span>
                    <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
                      {o.peso_kg != null ? `${o.peso_kg} kg` : '—'}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="p-3 border-t border-gray-100">
                <button
                  onClick={() => onVerPreview(camion)}
                  className="w-full flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 rounded-lg text-[11px] transition"
                >
                  <Eye className="h-3.5 w-3.5" /> Ver guía de carga
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
