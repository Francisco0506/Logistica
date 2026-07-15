/**
 * Servicio centralizado de API para el backend Django de Laben.
 * Usa rutas relativas que el proxy de Vite redirige a http://127.0.0.1:8000.
 */

const BASE = '/api/dispatcher';

/**
 * Sincroniza pedidos desde SAP B1 (o carga mock data).
 * @param {string} fecha — Formato YYYY-MM-DD
 */
export async function syncSAP(fecha, { signal } = {}) {
  const res = await fetch(`${BASE}/sync?fecha=${fecha}`, {
    method: 'POST',
    signal,
  });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  return res.json();
}

/**
 * Obtiene las remisiones (pedidos) del día.
 * @param {string} fecha — Formato YYYY-MM-DD
 */
export async function getRemisiones(fecha, { signal } = {}) {
  const res = await fetch(`${BASE}/remisiones?fecha=${fecha}`, { signal });
  if (!res.ok) throw new Error(`Remisiones failed: ${res.status}`);
  return res.json();
}

/**
 * Obtiene las rutas activas del día.
 * @param {string} fecha — Formato YYYY-MM-DD
 */
export async function getRutas(fecha, { signal } = {}) {
  const res = await fetch(`${BASE}/rutas?fecha=${fecha}`, { signal });
  if (!res.ok) throw new Error(`Rutas failed: ${res.status}`);
  return res.json();
}

/**
 * Lanza el optimizador de rutas (OR-Tools).
 * @param {string} fecha
 * @param {number} numCamiones
 */
export async function generarRutas(fecha, numCamiones, { signal } = {}) {
  const res = await fetch(`${BASE}/rutas/generar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, numero_camiones: numCamiones }),
    signal,
  });
  if (!res.ok) throw new Error(`Generar rutas failed: ${res.status}`);
  return res.json();
}

/**
 * Obtiene las alertas reales del día (pedidos sin georreferencia o sin asignar
 * a ninguna ruta). Calculado en vivo desde la BD, no es una lista fija.
 * @param {string} fecha — Formato YYYY-MM-DD
 */
export async function getAlertas(fecha, { signal } = {}) {
  const res = await fetch(`${BASE}/alertas?fecha=${fecha}`, { signal });
  if (!res.ok) throw new Error(`Alertas failed: ${res.status}`);
  return res.json();
}

/**
 * Actualiza el estado de despacho de una ruta en específico.
 * @param {number} rutaId
 * @param {string} estado (Borrador, Cargando, Listo, En_Ruta, Finalizada)
 */
export async function updateRutaEstado(rutaId, estado, { signal } = {}) {
  const res = await fetch(`${BASE}/rutas/${rutaId}/estado`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado }),
    signal,
  });
  if (!res.ok) throw new Error(`Update estado failed: ${res.status}`);
  return res.json();
}

/**
 * Para un pedido que quedó sin asignar, calcula en qué camión conviene meterlo
 * (menor tiempo agregado) y si cabe limpio en turno/peso/ventana de horario.
 * @param {number} remisionId
 */
export async function getSugerencias(remisionId, { signal } = {}) {
  const res = await fetch(`${BASE}/remisiones/${remisionId}/sugerencias`, { signal });
  if (!res.ok) throw new Error(`Sugerencias failed: ${res.status}`);
  return res.json();
}

/**
 * Asigna manualmente un pedido a una ruta. Si no cabe limpio, regresa
 * status='requiere_confirmacion'; hay que volver a llamar con forzar=true
 * para confirmar que se quiere meter de todos modos.
 * @param {number} remisionId
 * @param {{rutaId: number, posicion?: number, forzar?: boolean}} opts
 */
export async function asignarManual(remisionId, { rutaId, posicion, forzar = false }, { signal } = {}) {
  const res = await fetch(`${BASE}/remisiones/${remisionId}/asignar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ruta_id: rutaId, posicion, forzar }),
    signal,
  });
  if (!res.ok) throw new Error(`Asignar manual failed: ${res.status}`);
  return res.json();
}
