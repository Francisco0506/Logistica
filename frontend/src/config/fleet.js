/**
 * Configuración de Laben Food Service que el frontend necesita antes de hablar
 * con el backend.
 *
 * OJO: aquí ya NO vive la flota. Los camiones (placa, número de Samsara,
 * modelo, capacidad, tope de paradas, color, si arranca activo) vienen del
 * backend con `getFlota()` — la fuente única es backend/delivery/fleet.py.
 *
 * Antes había aquí una copia completa de la flota que tenía que coincidir a
 * mano, y en el mismo orden, con una lista de capacidades del backend. Eso
 * causaba que confirmar el dato de un camión obligara a editar dos archivos, y
 * que el panel pudiera mostrar una capacidad distinta de la que el optimizador
 * usaba para planear. También había un mapa T-001 -> placa, que ya no existe:
 * el backend guarda y devuelve la placa real.
 */

// Coordenadas del CEDIS (Santa Catarina). Se quedan del lado del frontend
// porque se ocupan para centrar el mapa ANTES de que responda el backend; el
// cálculo de rutas usa las del backend (fleet.py:CEDIS, el mismo punto).
export const CEDIS = [25.693214524592616, -100.48167993202988];

// Colores para camiones que el despachador agrega a mano y que por lo tanto no
// traen color asignado desde el backend. Es la misma paleta de fleet.py, para
// que un camión agregado no desentone con los ocho de la flota.
export const PALETA_COLORES_CAMION = [
  '#EA580C', '#E11D48', '#7C3AED', '#059669',
  '#2563EB', '#D97706', '#0891B2', '#C026D3',
];
