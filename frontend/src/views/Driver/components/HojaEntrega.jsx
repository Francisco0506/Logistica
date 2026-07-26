import React, { useState } from 'react';
import { X, Check, Minus, Plus, AlertTriangle } from 'lucide-react';

/**
 * La hoja donde el chofer confirma qué dejó en una parada.
 *
 * Está pensada para usarse de pie, con una mano, en la calle: botones grandes,
 * el camino normal en UN toque y nada de escribir salvo que haga falta.
 *
 * Dos caminos:
 *   - "Entregué todo": un toque y listo. Es el 90% de las paradas.
 *   - "Entregué incompleto": ahí sí se ajusta renglón por renglón, porque el
 *     dato que ventas y facturación necesitan es cuánto de qué, no un
 *     porcentaje.
 */

const MOTIVOS = [
  ['cliente_rechazo', 'El cliente aceptó menos'],
  ['producto_danado', 'Producto dañado'],
  ['falto_en_camion', 'No venía en el camión'],
  ['cerrado', 'Estaba cerrado'],
  ['sin_quien_reciba', 'No había quién recibiera'],
  ['sin_espacio', 'No tenían dónde meterlo'],
  ['otro', 'Otro motivo'],
];

export default function HojaEntrega({ parada, onCerrar, onConfirmar, guardando }) {
  const [modo, setModo] = useState(null);   // null | 'parcial'
  const [cantidades, setCantidades] = useState(
    () => Object.fromEntries(parada.lineas.map((l) => [l.id, l.cantidad]))
  );
  const [motivo, setMotivo] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [recibio, setRecibio] = useState('');

  const ajustar = (linea, delta) => {
    setCantidades((prev) => {
      const actual = prev[linea.id] ?? linea.cantidad;
      // Entre 0 y lo que trae: no se puede dejar de más.
      const siguiente = Math.max(0, Math.min(linea.cantidad, +(actual + delta).toFixed(2)));
      return { ...prev, [linea.id]: siguiente };
    });
  };

  const faltantes = parada.lineas.filter((l) => (cantidades[l.id] ?? l.cantidad) < l.cantidad);
  const nadaEntregado = parada.lineas.every((l) => (cantidades[l.id] ?? l.cantidad) === 0);

  const enviarCompleto = () => onConfirmar({ recibio: recibio.trim() || undefined });

  const enviarParcial = () => {
    onConfirmar({
      lineas: parada.lineas.map((l) => ({
        linea_id: l.id,
        cantidad_entregada: cantidades[l.id] ?? l.cantidad,
      })),
      motivo: motivo || 'otro',
      observaciones: observaciones.trim() || undefined,
      recibio: recibio.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-[3000] bg-white flex flex-col">
      {/* Cabecera fija */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <button onClick={onCerrar} className="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100">
          <X className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-gray-400">Parada {parada.secuencia_ruta} · #{parada.doc_num}</div>
          <h2 className="text-base font-extrabold text-gray-900 truncate">{parada.card_name}</h2>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* ── Lo que trae el camión ── */}
        <div className="px-4 py-3">
          <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
            {modo === 'parcial' ? 'Ajusta lo que dejaste' : 'Lo que trae este pedido'}
          </h3>

          <div className="space-y-2">
            {parada.lineas.map((l) => {
              const dejado = cantidades[l.id] ?? l.cantidad;
              const corto = dejado < l.cantidad;
              return (
                <div
                  key={l.id}
                  className={`rounded-xl border p-3 ${corto ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[14px] font-bold text-gray-800 leading-snug">{l.descripcion}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{l.item_code}</div>
                    </div>
                    {modo !== 'parcial' && (
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-extrabold text-gray-800 tabular-nums leading-none">
                          {l.cantidad % 1 === 0 ? l.cantidad : l.cantidad.toFixed(2)}
                        </div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase">{l.unidad}</div>
                      </div>
                    )}
                  </div>

                  {/* Ajuste de cantidad, con botones grandes para el pulgar */}
                  {modo === 'parcial' && (
                    <div className="flex items-center gap-3 mt-3">
                      <button
                        onClick={() => ajustar(l, -0.5)}
                        className="w-12 h-12 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 flex items-center justify-center flex-shrink-0"
                      >
                        <Minus className="w-5 h-5 text-gray-700" />
                      </button>

                      <div className="flex-1 text-center">
                        <div className={`text-2xl font-extrabold tabular-nums leading-none ${corto ? 'text-amber-700' : 'text-gray-800'}`}>
                          {dejado % 1 === 0 ? dejado : dejado.toFixed(2)}
                          <span className="text-sm text-gray-400 font-bold"> / {l.cantidad % 1 === 0 ? l.cantidad : l.cantidad.toFixed(2)}</span>
                        </div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">{l.unidad}</div>
                      </div>

                      <button
                        onClick={() => ajustar(l, 0.5)}
                        className="w-12 h-12 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 flex items-center justify-center flex-shrink-0"
                      >
                        <Plus className="w-5 h-5 text-gray-700" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Motivo y nota, solo cuando la entrega salió incompleta ── */}
        {modo === 'parcial' && (
          <div className="px-4 pb-3 space-y-3">
            <div>
              <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                ¿Por qué no se entregó todo?
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {MOTIVOS.map(([id, texto]) => (
                  <button
                    key={id}
                    onClick={() => setMotivo(id)}
                    className={`px-3 py-3 rounded-xl text-[12px] font-bold text-left transition ${
                      motivo === id
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {texto}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wide block mb-1.5">
                ¿Algo más que deba saber ventas?
              </label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={3}
                placeholder="Ej. el cliente no tenía cámara para la salsa"
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[14px] focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
            </div>
          </div>
        )}

        {/* Quién recibió: siempre, y opcional */}
        <div className="px-4 pb-4">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wide block mb-1.5">
            ¿Quién recibió? <span className="font-semibold normal-case text-gray-300">(opcional)</span>
          </label>
          <input
            value={recibio}
            onChange={(e) => setRecibio(e.target.value)}
            placeholder="Nombre de quien firmó"
            className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[15px] focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </div>
      </div>

      {/* ── Acciones, pegadas abajo donde alcanza el pulgar ── */}
      <div className="border-t border-gray-200 p-4 space-y-2 flex-shrink-0 bg-white">
        {modo !== 'parcial' ? (
          <>
            <button
              onClick={enviarCompleto}
              disabled={guardando}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-[16px] py-4 rounded-xl transition"
            >
              <Check className="w-5 h-5" strokeWidth={3} />
              {guardando ? 'Guardando…' : 'Entregué todo'}
            </button>
            <button
              onClick={() => setModo('parcial')}
              disabled={guardando}
              className="w-full flex items-center justify-center gap-2 border-2 border-gray-200 hover:bg-gray-50 text-gray-600 font-bold text-[14px] py-3.5 rounded-xl transition"
            >
              <AlertTriangle className="w-4 h-4" />
              Hubo un problema
            </button>
          </>
        ) : (
          <>
            {/* El resumen antes de confirmar: que el chofer vea qué va a quedar
                registrado, porque de esto depende lo que se le factura al
                cliente. */}
            <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              {nadaEntregado
                ? <b className="text-red-600">No se va a registrar ninguna entrega.</b>
                : faltantes.length === 0
                  ? <>Quedaría como <b className="text-emerald-600">entregado completo</b>.</>
                  : <>Quedaría como <b className="text-amber-700">entregado incompleto</b>: {faltantes.length} producto(s) con faltante.</>}
            </div>

            <button
              onClick={enviarParcial}
              disabled={guardando || (!motivo && faltantes.length > 0)}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-40 text-white font-extrabold text-[16px] py-4 rounded-xl transition"
            >
              <Check className="w-5 h-5" strokeWidth={3} />
              {guardando ? 'Guardando…' : 'Confirmar entrega'}
            </button>
            {!motivo && faltantes.length > 0 && (
              <p className="text-[11px] text-gray-400 text-center">Escoge un motivo para poder confirmar.</p>
            )}
            <button
              onClick={() => setModo(null)}
              className="w-full text-[13px] font-bold text-gray-400 hover:text-gray-600 py-2"
            >
              Volver
            </button>
          </>
        )}
      </div>
    </div>
  );
}
