import React, { useState } from 'react';
import { X, AlertTriangle, Pencil, Clock, User } from 'lucide-react';
import { ESTILO_ENTREGA } from '../../../config/estadosRuta';

/**
 * Lo que YA se reportó en una parada, de solo lectura.
 *
 * Esta pantalla nació de un bug caro. Las tarjetas de "Ya reportadas" seguían
 * siendo tocables y abrían la MISMA hoja de entrega, en modo editable y en
 * blanco: no precargaba `cantidad_entregada` (que el backend sí manda), ni el
 * motivo, ni la nota, ni quién recibió.
 *
 * El escenario real: el chofer dejó 1 de 3 quesos a las 9 de la mañana. A
 * mediodía abre "Ya reportadas" nada más para revisar qué hizo. La hoja le
 * enseñaba 3 de 3 —mentira— y abajo el botón verde grande de "Entregué todo".
 * Un toque con el pulgar, de pie junto al camión, y lo reportado se borraba: el
 * pedido quedaba como entregado completo, ventas le decía al cliente que ya
 * tenía sus 3 quesos y facturación le cobraba los 3.
 *
 * Por eso revisar y corregir se separaron. Revisar es lo que el chofer hace
 * diez veces al día y ahora no puede romper nada. Corregir sigue existiendo
 * —a veces sí se reportó mal— pero pasa por una confirmación que dice con
 * todas sus letras que va a volver a capturar desde cero.
 */
export default function ResumenReportado({ parada, onCerrar, onCorregir, motivos = [] }) {
  const [confirmando, setConfirmando] = useState(false);
  const estado = ESTILO_ENTREGA[parada.estado];
  const Icono = estado?.icono;
  const textoMotivo = motivos.find((m) => m.id === parada.motivo)?.texto || parada.motivo;

  return (
    <div className="fixed inset-0 z-[3000] bg-black/40 sm:flex sm:items-center sm:justify-center sm:p-6">
      <div className="bg-white h-full w-full flex flex-col sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl sm:shadow-2xl sm:overflow-hidden">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 flex-shrink-0">
          <button onClick={onCerrar} aria-label="Cerrar" className="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-gray-400">Parada {parada.secuencia_ruta} · #{parada.doc_num}</div>
            <h2 className="text-base font-extrabold text-gray-900 truncate">{parada.card_name}</h2>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Lo primero que se ve es CÓMO quedó, no los productos: el chofer que
              abre esto ya sabe a quién le entregó, lo que viene a checar es si
              quedó registrado lo que él cree. */}
          <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
            {estado && (
              <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold uppercase px-2.5 py-1 rounded-full border ${estado.clase}`}>
                <Icono className="w-3.5 h-3.5" /> {estado.corto}
              </span>
            )}
            {parada.entregado_en && (
              <span className="inline-flex items-center gap-1 text-[12px] font-bold text-gray-500">
                <Clock className="w-3.5 h-3.5" /> {parada.entregado_en}
              </span>
            )}
            {parada.recibio && (
              <span className="inline-flex items-center gap-1 text-[12px] font-bold text-gray-500">
                <User className="w-3.5 h-3.5" /> {parada.recibio}
              </span>
            )}
          </div>

          {/* ── Renglón por renglón: lo DEJADO contra lo que traía ──
              Es el dato del que cuelga la factura, así que se enseña el número
              que de verdad se guardó y no el del pedido. Si el backend todavía
              no tiene `cantidad_entregada` (paradas viejas, o una que no se
              entregó) se dice "sin dato" en vez de asumir que fue todo. */}
          <div className="px-4 pb-3">
            <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Lo que se reportó</h3>
            <div className="space-y-2">
              {parada.lineas.map((l) => {
                const sinDato = l.cantidad_entregada === null || l.cantidad_entregada === undefined;
                const dejado = sinDato ? null : l.cantidad_entregada;
                const corto = !sinDato && dejado < l.cantidad;
                return (
                  <div key={l.id} className={`rounded-xl border p-3 flex items-start justify-between gap-3 ${corto ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200'}`}>
                    <div className="min-w-0">
                      <div className="text-[14px] font-bold text-gray-800 leading-snug">{l.descripcion}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{l.item_code}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-lg font-extrabold tabular-nums leading-none ${corto ? 'text-amber-700' : 'text-gray-800'}`}>
                        {sinDato ? '—' : dejado}
                        <span className="text-sm text-gray-400 font-bold"> / {l.cantidad}</span>
                      </div>
                      <div className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">
                        {sinDato ? 'sin dato' : l.unidad}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {(textoMotivo || parada.observaciones) && (
            <div className="px-4 pb-3 space-y-2">
              {textoMotivo && (
                <div className="rounded-xl border border-gray-200 px-3 py-2.5">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Motivo</div>
                  <div className="text-[14px] font-bold text-gray-800 mt-0.5">{textoMotivo}</div>
                </div>
              )}
              {parada.observaciones && (
                <div className="rounded-xl border border-gray-200 px-3 py-2.5">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Nota para ventas</div>
                  <div className="text-[14px] text-gray-700 mt-0.5 leading-snug">{parada.observaciones}</div>
                </div>
              )}
            </div>
          )}

          {/* La evidencia que SÍ subió. Verla es la única forma que tiene el
              chofer de saber que la foto llegó al servidor y no se quedó en el
              celular. */}
          {(parada.foto || parada.firma) && (
            <div className="px-4 pb-4">
              <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Evidencia que ya subió</h3>
              <div className="space-y-2">
                {parada.foto && (
                  <img src={parada.foto} alt="Foto de la entrega" className="w-full h-44 object-cover rounded-xl border border-gray-200" />
                )}
                {parada.firma && (
                  <img src={parada.firma} alt="Firma de quien recibió" className="w-full h-28 object-contain rounded-xl border border-gray-200 bg-white" />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 p-4 space-y-2 flex-shrink-0 bg-white">
          {/* Corregir solo si el camión sigue en ruta, por la misma razón de
              siempre: con la ruta cerrada el dato ya se fue a facturación. */}
          {!onCorregir ? (
            <button
              onClick={onCerrar}
              className="w-full bg-gray-100 active:bg-gray-200 text-gray-700 font-extrabold text-[16px] py-4 rounded-xl"
            >
              Listo
            </button>
          ) : !confirmando ? (
            <>
              <button
                onClick={onCerrar}
                className="w-full bg-gray-100 active:bg-gray-200 text-gray-700 font-extrabold text-[16px] py-4 rounded-xl"
              >
                Listo
              </button>
              {/* Chico y gris, abajo del principal: el 99% de las veces el
                  chofer entró aquí a mirar, no a rehacer nada. */}
              <button
                onClick={() => setConfirmando(true)}
                className="w-full flex items-center justify-center gap-2 text-[13px] font-bold text-gray-400 active:text-gray-600 py-2"
              >
                <Pencil className="w-3.5 h-3.5" /> Reporté mal esta entrega
              </button>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-[12px] text-amber-900 leading-snug">
                  Vas a <b>capturar esta entrega otra vez desde cero</b>. Lo que
                  reportaste antes se reemplaza por lo que dejes ahora, y la
                  hoja va a abrir con las cantidades del pedido completo, no con
                  las que reportaste.
                </p>
              </div>
              <button
                onClick={onCorregir}
                className="w-full bg-orange-500 active:bg-orange-700 text-white font-extrabold text-[16px] py-4 rounded-xl"
              >
                Sí, volver a capturarla
              </button>
              <button
                onClick={() => setConfirmando(false)}
                className="w-full text-[13px] font-bold text-gray-400 active:text-gray-600 py-2"
              >
                Mejor no
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
