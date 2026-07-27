import React from 'react';
import { PencilLine, PackageOpen, PackageCheck, Truck, Flag } from 'lucide-react';

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

// El icono dice lo que ese paso significa para quien opera:
//   Borrador  -> el lápiz: esta ruta TODAVÍA SE PUEDE CAMBIAR. Es lo único que
//                importa saber de un borrador; una carpeta o un icono de plan
//                no decían nada útil.
//   Cargando  -> caja abriéndose, el almacén está subiendo mercancía.
//   Listo     -> caja cerrada y palomeada, ya cargado esperando salir.
//   En ruta   -> el camión, ya está en la calle y no se le puede tocar nada.
//   Terminó   -> bandera de meta.
const PASOS = [
  { estado: 'Borrador',   etiqueta: 'Borrador',  icono: PencilLine,   acabado: 'Todavía se puede cambiar' },
  { estado: 'Cargando',   etiqueta: 'Cargando',  icono: PackageOpen,  acabado: 'Subiendo mercancía' },
  { estado: 'Listo',      etiqueta: 'Listo',     icono: PackageCheck, acabado: 'Cargado y esperando' },
  { estado: 'En_Ruta',    etiqueta: 'En ruta',   icono: Truck,        acabado: 'En la calle' },
  { estado: 'Finalizada', etiqueta: 'Terminó',   icono: Flag,         acabado: 'Terminada' },
];

// Qué se puede hacer desde cada estado. Coincide con TRANSICIONES_VALIDAS del
// backend (api.py): no se pueden saltar pasos.
//
// TODAS las acciones van en el naranja de Laben. Es el color de la marca y el
// de la acción principal en todo el sistema: cambiarlo por paso hacía que el
// botón se sintiera de otra aplicación.
const SIGUIENTE = {
  Borrador:  { estado: 'Cargando',   texto: 'Empezar a cargar',  ayuda: 'El almacén empieza a subir la mercancía' },
  Cargando:  { estado: 'Listo',      texto: 'Marcar como listo', ayuda: 'Ya está cargado y esperando salir' },
  Listo:     { estado: 'En_Ruta',    texto: 'Dar salida',        ayuda: 'Las ETAs se recalculan desde la hora real de salida' },
  En_Ruta:   { estado: 'Finalizada', texto: 'Cerrar la ruta',    ayuda: 'El camión regresó y terminó sus entregas' },
  Finalizada: null,
};

export default function EstadoDespacho({ ruta, onCambiarEstado, cambiando }) {
  const indiceActual = PASOS.findIndex((p) => p.estado === ruta.estado);
  const siguiente = SIGUIENTE[ruta.estado];

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
              <span className={`text-[8px] font-bold uppercase tracking-wide ${
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
            <p className="text-[9px] text-gray-400 text-center leading-snug">{siguiente.ayuda}</p>
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
