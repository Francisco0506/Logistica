import React from 'react';
import { Package, Loader, Check, Play, Flag } from 'lucide-react';

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

const PASOS = [
  { estado: 'Borrador',   etiqueta: 'Borrador',  icono: Package, acabado: 'Planeada' },
  { estado: 'Cargando',   etiqueta: 'Cargando',  icono: Loader,  acabado: 'Cargando' },
  { estado: 'Listo',      etiqueta: 'Listo',     icono: Check,   acabado: 'Listo' },
  { estado: 'En_Ruta',    etiqueta: 'En ruta',   icono: Play,    acabado: 'En la calle' },
  { estado: 'Finalizada', etiqueta: 'Terminó',   icono: Flag,    acabado: 'Terminada' },
];

// Qué se puede hacer desde cada estado. Coincide con TRANSICIONES_VALIDAS del
// backend (api.py): no se pueden saltar pasos.
const SIGUIENTE = {
  Borrador:  { estado: 'Cargando',   texto: 'Empezar a cargar',   ayuda: 'El almacén empieza a subir la mercancía' },
  Cargando:  { estado: 'Listo',      texto: 'Marcar como listo',  ayuda: 'Ya está cargado y esperando salir' },
  Listo:     { estado: 'En_Ruta',    texto: 'Dar salida',         ayuda: 'Las ETAs se recalculan desde la hora real de salida' },
  En_Ruta:   { estado: 'Finalizada', texto: 'Cerrar la ruta',     ayuda: 'El camión regresó y terminó sus entregas' },
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
                className={`w-3.5 h-3.5 ${
                  actual ? 'text-orange-600' : hecho ? 'text-emerald-600' : 'text-gray-300'
                } ${actual && paso.estado === 'Cargando' ? 'animate-spin' : ''}`}
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
        {ruta.hora_salida && (
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
            <Play className="w-3 h-3" /> Salió a las {ruta.hora_salida}
          </div>
        )}

        {siguiente ? (
          <>
            <button
              onClick={() => onCambiarEstado(siguiente.estado)}
              disabled={cambiando}
              className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white font-bold text-[11px] py-2 rounded-md transition"
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
