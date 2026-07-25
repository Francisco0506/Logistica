import React from 'react';
import { Download, AlertCircle } from 'lucide-react';

/**
 * Manifiesto de carga por camión, en orden LIFO: lo primero que se sube al
 * camión es lo último que se entrega.
 *
 * Muestra cuánto peso lleva contra la capacidad de ESA unidad. Ojo con cómo se
 * presenta el peso: SAP todavía no manda el peso real de cada pedido, y en ese
 * caso aquí se dice que no se sabe, NUNCA se sustituye por el estimado de
 * 150 kg que usa el optimizador — un peso inventado que se ve como medido es
 * justo lo que haría sobrecargar un camión con confianza.
 */
export default function Manifiesto({ camionesActivos, paradasDe }) {
  return (
    // Sin scroll propio: fluye con la página.
    <div className="px-4 pb-4">
      <p className="text-[11px] text-gray-400 mb-3 font-medium">
        Orden de carga <b>LIFO</b> — lo primero que se carga en almacén es lo último que se entrega en ruta.
      </p>

      {/* En pantallas anchas los camiones van de dos en dos: uno debajo de otro
          obligaba a recorrer mucho para comparar dos manifiestos. */}
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
        {camionesActivos.map((camion) => {
          const pedidos = paradasDe(camion.id);
          const ordenDeCarga = [...pedidos].reverse();

          const conPeso = pedidos.filter((o) => o.peso_kg != null);
          const pesoConocido = conPeso.reduce((s, o) => s + o.peso_kg, 0);
          const faltanPesos = pedidos.length - conPeso.length;
          const porcentaje = camion.capacidadKg
            ? Math.min(100, Math.round((pesoConocido / camion.capacidadKg) * 100))
            : 0;
          const sobrepeso = camion.capacidadKg && pesoConocido > camion.capacidadKg;

          return (
            <div key={camion.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100" style={{ borderLeft: `4px solid ${camion.color}` }}>
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold text-gray-800 text-sm">{camion.id}</div>
                  <div className="text-[10px] text-gray-400 font-medium">
                    {camion.modelo}{camion.driver ? ` · ${camion.driver}` : ' · Sin chofer'}
                  </div>
                </div>
                <span className="text-[9px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                  {pedidos.length} pedidos
                </span>
              </div>

              {/* Carga contra la capacidad real de esta unidad */}
              {pedidos.length > 0 && (
                <div className="px-4 pt-3 pb-1">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Carga</span>
                    <span className={`text-[11px] font-bold ${sobrepeso ? 'text-red-600' : 'text-gray-700'}`}>
                      {conPeso.length > 0
                        ? `${pesoConocido.toLocaleString('es-MX', { maximumFractionDigits: 0 })} de ${camion.capacidadKg.toLocaleString()} kg`
                        : `Sin peso · capacidad ${camion.capacidadKg.toLocaleString()} kg`}
                    </span>
                  </div>

                  {conPeso.length > 0 && (
                    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          sobrepeso ? 'bg-red-500' : porcentaje > 85 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${porcentaje}%` }}
                      />
                    </div>
                  )}

                  {faltanPesos > 0 && (
                    <p className="text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1.5 flex items-start gap-1">
                      <AlertCircle className="w-3 h-3 flex-shrink-0 mt-px" />
                      <span>
                        {faltanPesos === pedidos.length
                          ? 'SAP no manda el peso de estos pedidos, así que no se sabe cuánto lleva el camión.'
                          : `Faltan los pesos de ${faltanPesos} de ${pedidos.length} pedidos: el total real es mayor.`}
                      </span>
                    </p>
                  )}
                </div>
              )}

              <div className="px-3 py-2 space-y-1.5 max-h-[160px] overflow-y-auto">
                {ordenDeCarga.length > 0 ? ordenDeCarga.map((o, i) => (
                  <div key={o.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 text-xs">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: camion.color }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-700 text-[11px] truncate">{o.card_name}</div>
                      {o.ventana && (
                        <div className="text-[9px] text-gray-400">Recibe {o.ventana}</div>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                      {o.peso_kg != null ? `${o.peso_kg} kg` : '—'}
                    </span>
                    <span className="font-bold text-gray-800 text-[11px] flex-shrink-0">
                      ${o.doc_total?.toLocaleString()}
                    </span>
                  </div>
                )) : (
                  <p className="text-[10px] text-gray-400 italic text-center py-4">Sin pedidos asignados.</p>
                )}
              </div>

              <div className="px-3 pb-3 pt-1">
                <button
                  disabled
                  title="Todavía no genera el archivo — ver docs/pendientes.md"
                  className="w-full flex items-center justify-center gap-1.5 bg-gray-50 text-gray-300 font-bold py-2 rounded-lg text-[11px] border border-gray-200 cursor-not-allowed"
                >
                  <Download className="h-3 w-3" /> Descargar guía (pendiente)
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
