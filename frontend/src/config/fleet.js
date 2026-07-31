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

// Aquí VIVÍA una copia de la paleta de colores de los camiones, para los que
// el despachador agrega a mano. Se quitó: era una copia que había que mantener
// igual a fleet.py y no se mantuvo — se quedó en 8 colores mientras el backend
// creció a 11, así que no conocía los de los camiones que no son ISUZU.
//
// Ahora el color de un camión nuevo se escoge con `lib/color.js:colorLibre()`
// a partir de la flota que el backend ya mandó, y se garantiza que no choque
// con ninguno en uso.
