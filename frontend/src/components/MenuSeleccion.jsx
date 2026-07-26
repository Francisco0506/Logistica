import React, { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

/**
 * Menú de selección propio, en lugar de un `<select>` del sistema.
 *
 * Un `<select>` nativo se ve distinto en cada navegador y en cada sistema
 * operativo, no admite color ni iconos, y en Windows sale gris con una tipografía
 * que no es la del resto de la aplicación. Aquí las opciones pueden traer el
 * color de su camión y se ven igual en cualquier máquina.
 *
 * Cada opción es `{ valor, texto, color?, detalle? }`.
 */
export default function MenuSeleccion({
  valor,
  opciones,
  onCambio,
  ancho = 'w-52',
  className = '',
}) {
  const [abierto, setAbierto] = useState(false);
  const actual = opciones.find((o) => o.valor === valor) || opciones[0];

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-2 bg-gray-50 border border-gray-200 hover:bg-gray-100 rounded-lg pl-2.5 pr-2 py-1.5 text-[11px] font-bold text-gray-600 transition w-full"
      >
        {actual?.color && (
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: actual.color }} />
        )}
        <span className="truncate">{actual?.texto}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 ml-auto flex-shrink-0" />
      </button>

      {abierto && (
        <>
          {/* Capa para cerrar al hacer clic afuera */}
          <div className="fixed inset-0 z-[1500]" onClick={() => setAbierto(false)} />
          <div className={`absolute right-0 mt-1 z-[1600] ${ancho} bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-72 overflow-y-auto`}>
            {opciones.map((o) => (
              <button
                key={o.valor}
                onClick={() => { onCambio(o.valor); setAbierto(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-left transition ${
                  valor === o.valor ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {o.color
                  ? <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: o.color }} />
                  : <span className="w-2.5 flex-shrink-0" />}
                <span className="truncate flex-1">{o.texto}</span>
                {o.detalle && <span className="text-gray-400 font-normal flex-shrink-0">{o.detalle}</span>}
                {valor === o.valor && <Check className="w-3 h-3 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
