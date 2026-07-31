import { PencilLine, PackageOpen, PackageCheck, Truck, Flag } from 'lucide-react';

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
