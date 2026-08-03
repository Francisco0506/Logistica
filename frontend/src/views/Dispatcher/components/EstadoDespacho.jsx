import React from 'react';
import { Truck } from 'lucide-react';
import { PASOS } from '../../../config/estadosRuta';

/**
 * El avance de despacho de una ruta.
 *
 * Antes eran tres botones en fila, dos de ellos siempre apagados, con el estado
 * escrito en letra chica arriba. No se entendía en qué paso ibas ni cuál era la
 * acción que seguía: parecía que dos botones estaban descompuestos.
 *
 * Ahora se ve el camino completo (Borrador -> Cargando -> Listo -> En ruta ->
 * Finalizada), en qué paso estás, y UNA sola acción: la que sigue.
 */


// CÓMO SE LLAMA cada acción. Solo el texto: a qué estado lleva cada paso lo
// decide el BACKEND y llega por /api/config.
//
// Antes este archivo tenía su propia copia de la máquina de estados, con un
// comentario que decía "coincide con TRANSICIONES_VALIDAS del backend".
// Coincidía HOY. En cuanto se desfasara, el botón mandaría una transición que
// el backend rechaza —y la rechaza con HTTP 200 y `status: 'error'`, así que se
// vería como un botón que simplemente no hace nada.
//
// TODAS las acciones van en el naranja de Laben. Es el color de la marca y el
// de la acción principal en todo el sistema: cambiarlo por paso hacía que el
// botón se sintiera de otra aplicación.
const TEXTO_ACCION = {
  Cargando:   { texto: 'Empezar a cargar',  ayuda: 'El almacén empieza a subir la mercancía' },
  Listo:      { texto: 'Marcar como listo', ayuda: 'Ya está cargado y esperando salir' },
  En_Ruta:    { texto: 'Dar salida',        ayuda: 'Las ETAs se recalculan desde la hora real de salida' },
  Finalizada: { texto: 'Cerrar la ruta',    ayuda: 'El camión regresó y terminó sus entregas' },
};

export default function EstadoDespacho({ ruta, onCambiarEstado, cambiando, transiciones }) {
  const indiceActual = PASOS.findIndex((p) => p.estado === ruta.estado);

  // El primer estado al que el backend deja pasar desde el actual. Si algún día
  // se agrega un paso allá, el botón sale solo con un texto genérico en vez de
  // no salir.
  const destino = (transiciones?.[ruta.estado] ?? [])[0] ?? null;
  const siguiente = destino
    ? { estado: destino, ...(TEXTO_ACCION[destino] ?? { texto: `Pasar a ${destino}`, ayuda: '' }) }
    : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Línea de avance */}
      <div className="flex items-stretch border-b border-gray-100">
        {PASOS.map((paso, i) => {
          const hecho = i < indiceActual;
          const actual = i === indiceActual;
          const Icono = paso.icono;
          return (
            <div
              key={paso.estado}
              title={paso.acabado}
              className={`flex-1 flex flex-col items-center gap-1 py-2 border-b-2 transition ${
                actual ? 'border-orange-500 bg-orange-50/60'
                : hecho ? 'border-emerald-400 bg-emerald-50/40'
                : 'border-transparent'
              }`}
            >
              <Icono
                className={`w-4 h-4 ${
                  actual ? 'text-orange-600' : hecho ? 'text-emerald-600' : 'text-gray-300'
                } ${actual && paso.estado === 'Cargando' ? 'animate-pulse' : ''}`}
              />
              <span className={`text-[10px] font-bold uppercase tracking-wide ${
                actual ? 'text-orange-700' : hecho ? 'text-emerald-700' : 'text-gray-300'
              }`}>
                {paso.etiqueta}
              </span>
            </div>
          );
        })}
      </div>

      <div className="p-2.5 space-y-2">
        {/* Qué significa el paso en el que va, con palabras. El icono ayuda a
            reconocerlo de reojo, pero no debe quedar a interpretación. */}
        <p className="text-[11px] text-gray-500 text-center">
          <b className="text-gray-700">{PASOS[indiceActual]?.etiqueta}:</b>{' '}
          {PASOS[indiceActual]?.acabado.toLowerCase()}
        </p>

        {ruta.hora_salida && (
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
            <Truck className="w-3 h-3" /> Salió a las {ruta.hora_salida}
          </div>
        )}

        {siguiente ? (
          <>
            <button
              onClick={() => onCambiarEstado(siguiente.estado)}
              disabled={cambiando}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:hover:bg-orange-500 text-white font-bold text-xs py-2.5 rounded-lg shadow-sm transition"
            >
              {cambiando ? 'Guardando…' : siguiente.texto}
            </button>
            {siguiente.ayuda && (
              <p className="text-[10px] text-gray-400 text-center leading-snug">{siguiente.ayuda}</p>
            )}
          </>
        ) : (
          <p className="text-[10px] text-gray-400 text-center italic py-1">
            Ruta terminada. No hay más pasos.
          </p>
        )}
      </div>
    </div>
  );
}
