import {
  PencilLine, PackageOpen, PackageCheck, Truck, Flag, Check, AlertTriangle, XCircle,
} from 'lucide-react';

/**
 * El vocabulario ÚNICO de los estados de una ruta.
 *
 * Vive aquí y no dentro de un componente porque lo usan varias pantallas. La
 * tarjeta del camión imprimía `ruta.estado.replace('_',' ')` —"Finalizada",
 * "En Ruta"— a tres centímetros del componente de avance, que a los mismos
 * estados les dice "Terminó" y "En ruta". El despachador veía dos palabras
 * distintas para lo mismo, en la misma tarjeta.
 *
 * El icono dice lo que ese paso significa para quien opera:
 *   Borrador  -> el lápiz: esta ruta TODAVÍA SE PUEDE CAMBIAR. Es lo único que
 *                importa saber de un borrador; una carpeta o un icono de plan
 *                no decían nada útil.
 *   Cargando  -> caja abriéndose, el almacén está subiendo mercancía.
 *   Listo     -> caja cerrada y palomeada, ya cargado esperando salir.
 *   En ruta   -> el camión, ya está en la calle y no se le puede tocar nada.
 *   Terminó   -> bandera de meta.
 */
export const PASOS = [
  { estado: 'Borrador',   etiqueta: 'Borrador',  icono: PencilLine,   acabado: 'Todavía se puede cambiar' },
  { estado: 'Cargando',   etiqueta: 'Cargando',  icono: PackageOpen,  acabado: 'Subiendo mercancía' },
  { estado: 'Listo',      etiqueta: 'Listo',     icono: PackageCheck, acabado: 'Cargado y esperando' },
  { estado: 'En_Ruta',    etiqueta: 'En ruta',   icono: Truck,        acabado: 'En la calle' },
  { estado: 'Finalizada', etiqueta: 'Terminó',   icono: Flag,         acabado: 'Terminada' },
];

/** Cómo se le dice a este estado en pantalla. */
export const etiquetaEstado = (estado) =>
  PASOS.find((p) => p.estado === estado)?.etiqueta ?? estado;


// ─────────────────────────────────────────────────────────────────────────────
// LOS ESTADOS DE UNA ENTREGA (la remisión), que NO son los de la ruta.
//
// El modelo tiene TRES estados finales, no uno (`models.py:97-102`): el chofer
// pudo dejar todo, dejar parte, o no dejar nada. La app del chofer los distingue
// con cuidado —el estado se DEDUCE de las cantidades, no lo manda el celular—
// pero el resto del frontend comparaba contra `=== 'Entregado'` a mano, y cada
// pantalla lo hacía a su manera.
//
// Lo que se veía por copiar la lista en cada archivo:
//   · Un pedido que NO se pudo entregar le salía a la vendedora como
//     "SIN PROGRAMAR" —o sea "todavía no entra a ninguna ruta"— mientras el
//     texto de adentro decía "no se pudo entregar a las 11:20".
//   · "Lo próximo en llegar" seguía anunciando la ETA de un cliente donde el
//     camión ya había pasado sin poder entregar.
//   · En el mapa del despachador una parada fallida se veía igual que una
//     pendiente, a color pleno.
//   · En la app del chofer una parada fallida llevaba PALOMITA VERDE y, tres
//     centímetros abajo, la pastilla roja "No entregado".
//
// Es el mismo problema que ESTADOS_RUTA_DESPACHADA resolvió del lado del
// backend, y por la misma razón: agregar un estado y olvidar una copia
// significa que una pantalla miente sin que nadie se entere.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cómo se ve cada estado final de una entrega.
 *
 * `salioMal` es lo que separa "el camión pasó y quedó bien" de "el camión pasó
 * y hay algo que atender". Es la única pregunta que ventas necesita contestar
 * rápido, así que se marca aquí y no en cada pantalla.
 */
export const ESTILO_ENTREGA = {
  Entregado: {
    texto: 'Entregado', corto: 'Entregado', salioMal: false, icono: Check,
    clase: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    color: '#059669',
  },
  Entregado_Parcial: {
    texto: 'Entregado incompleto', corto: 'Incompleto', salioMal: true, icono: AlertTriangle,
    clase: 'bg-amber-50 text-amber-700 border-amber-200',
    color: '#D97706',
  },
  No_Entregado: {
    texto: 'No se pudo entregar', corto: 'No entregado', salioMal: true, icono: XCircle,
    clase: 'bg-red-50 text-red-700 border-red-200',
    color: '#DC2626',
  },
};

/** Los tres estados finales. La ÚNICA lista; no copiarla a otro archivo. */
export const ESTADOS_ENTREGA_FINAL = Object.keys(ESTILO_ENTREGA);

/**
 * El camión YA PASÓ por esta parada, se haya podido entregar o no.
 *
 * Es lo que mide el avance de una ruta. Medirlo con `=== 'Entregado'` dejaba a
 * un camión que cerró su día con dos clientes cerrados en "8/10 para siempre",
 * con "Sigue:" apuntando a un cliente al que ya no va a volver.
 */
export const esVisitada = (estado) => estado in ESTILO_ENTREGA;

/** Pasó el camión y NO quedó bien: hay algo que ventas tiene que atender. */
export const salioMal = (estado) => ESTILO_ENTREGA[estado]?.salioMal === true;

/** Se dejó mercancía, completa o a medias. Para contar entregas de verdad. */
export const huboEntrega = (estado) =>
  estado === 'Entregado' || estado === 'Entregado_Parcial';
