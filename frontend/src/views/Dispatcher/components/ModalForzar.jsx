import React from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Confirmación para meter un pedido a una ruta donde no cabe limpio.
 * El backend rechaza la asignación y devuelve el motivo; el despachador tiene
 * que confirmar explícitamente que quiere forzarla de todos modos.
 */
export default function ModalForzar({ confirmacion, placa, onCancelar, onConfirmar }) {
  if (!confirmacion) return null;

  return (
    <div className="fixed inset-0 z-[3000] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
        <div className="bg-red-50 border-b border-red-100 px-5 py-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-red-700">Este pedido no cabe limpio</h3>
            <p className="text-xs text-red-600 mt-0.5">{confirmacion.mensaje}</p>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm text-gray-600">
            ¿Meterlo de todos modos a <span className="font-bold text-gray-800">{placa}</span>?
          </p>
        </div>

        <div className="px-5 pb-5 flex gap-2 justify-end">
          <button
            onClick={onCancelar}
            className="px-4 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100 rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition"
          >
            Forzar de todos modos
          </button>
        </div>
      </div>
    </div>
  );
}
