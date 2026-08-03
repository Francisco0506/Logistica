/**
 * Fechas, en hora LOCAL.
 *
 * Existe porque la misma función estaba copiada —con el mismo comentario— en
 * las tres pantallas: `Dispatcher/index.jsx`, `Driver/index.jsx` y
 * `Sales/index.jsx`. Un comentario repetido tres veces es una función que
 * falta.
 */

/**
 * El día de HOY como "YYYY-MM-DD", en la hora de quien está usando el sistema.
 *
 * A propósito NO se usa `toISOString()`: convierte a UTC, así que en México
 * —seis horas atrás— a partir de las 6 de la tarde ya devuelve el día
 * SIGUIENTE. El despachador que abre el panel a las 7 pm para adelantar trabajo
 * lo vería pidiendo pedidos de un día que todavía no existe, y el chofer que
 * reporta una entrega de las 8 pm la guardaría contra mañana.
 *
 * La captura de entregas va de 6 am a 7 pm y los camiones salen entre 7 y 10 de
 * la mañana, así que la franja peligrosa cae justo dentro del horario de uso.
 */
export function hoyLocal(fecha = new Date()) {
  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${año}-${mes}-${dia}`;
}
