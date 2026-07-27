/**
 * Servicio centralizado de API para el backend Django de Laben.
 * Usa rutas relativas que el proxy de Vite redirige a http://127.0.0.1:8000.
 */

const BASE = '/api/dispatcher';
const BASE_VENTAS = '/api/ventas';

/**
 * Vendedores que tienen pedidos ese día, para el selector del panel de ventas.
 * @param {string} fecha — Formato YYYY-MM-DD
 */
export async function getVendedores(fecha, { signal } = {}) {
  const res = await fetch(`${BASE_VENTAS}/vendedores?fecha=${fecha}`, { signal });
  if (!res.ok) throw new Error(`Vendedores failed: ${res.status}`);
  return res.json();
}

/**
 * Los pedidos de UNA vendedora, con la hora a la que llega cada uno y qué está
 * pasando con él.
 *
 * El vendedor va como parámetro porque el login todavía no valida nada. Cuando
 * haya usuarios de verdad esto tiene que salir de la sesión, no de la URL.
 * @param {string} fecha — Formato YYYY-MM-DD
 * @param {string} slpCode — Código de vendedor de SAP
 */
export async function getPedidosVendedor(fecha, slpCode, { signal } = {}) {
  const res = await fetch(`${BASE_VENTAS}/pedidos?fecha=${fecha}&slp_code=${encodeURIComponent(slpCode)}`, { signal });
  if (!res.ok) throw new Error(`Pedidos vendedor failed: ${res.status}`);
  return res.json();
}

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
 * La ruta del día de UN camión, para la app del chofer: sus paradas en orden,
 * con los productos de cada pedido y los datos de contacto del cliente.
 *
 * Va por camión y no por chofer porque el sistema todavía no sabe quién maneja
 * qué (ver docs/pendientes.md §1). Cuando haya usuarios, la placa saldrá de la
 * sesión del chofer.
 */
export async function getRutaChofer(fecha, camion, { signal } = {}) {
  const res = await fetch(`/api/chofer/ruta?fecha=${fecha}&camion=${encodeURIComponent(camion)}`, { signal });
  if (res.status === 404) return null;   // ese camión no tiene ruta hoy
  if (!res.ok) throw new Error(`Ruta chofer failed: ${res.status}`);
  return res.json();
}

/**
 * El chofer confirma qué dejó en una parada.
 *
 * Si no se manda detalle de líneas, el backend entiende que se entregó todo
 * completo — que es el caso normal y no debe costar trabajo. Para una entrega
 * incompleta van las cantidades por renglón, el motivo y la nota.
 *
 * El ESTADO no se manda: el backend lo deduce de las cantidades, para que no
 * pueda quedar un pedido "completo" con renglones a medias.
 */
export async function confirmarEntrega(remisionId, { lineas = [], motivo, observaciones, recibio } = {}, { signal } = {}) {
  const res = await fetch(`/api/chofer/paradas/${remisionId}/entregar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineas, motivo, observaciones, recibio }),
    signal,
  });
  if (!res.ok) throw new Error(`Confirmar entrega failed: ${res.status}`);
  return res.json();
}

/**
 * Sube la foto de evidencia de una entrega.
 *
 * Va aparte de la confirmación a propósito: en la calle la señal falla seguido,
 * y una foto que no sube no debe tirar el reporte de la entrega, que es el dato
 * que de verdad importa.
 */
export async function subirFotoEntrega(remisionId, archivo, { signal } = {}) {
  const datos = new FormData();
  datos.append('foto', archivo);
  const res = await fetch(`/api/chofer/paradas/${remisionId}/foto`, {
    method: 'POST', body: datos, signal,
  });
  if (!res.ok) throw new Error(`Subir foto failed: ${res.status}`);
  return res.json();
}

/**
 * "¿Qué hago para que quepan todos?" — corre el optimizador varias veces
 * cambiando UNA cosa cada vez (salir antes, más turno, otro camión) y regresa
 * cuántos pedidos entrarían en cada caso, ordenado por el que más ayuda.
 *
 * Ninguna de esas corridas toca el plan real: se simulan y se deshacen. Tarda
 * ~30 s porque son varias corridas del optimizador.
 */
export async function evaluarEscenarios(fecha, placas, horasTurno = 6, { signal } = {}) {
  const res = await fetch(`${BASE}/rutas/escenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, camiones: placas, horas_turno: horasTurno }),
    signal,
  });
  if (!res.ok) throw new Error(`Escenarios failed: ${res.status}`);
  return res.json();
}

/**
 * La flota de reparto: placa, número de Samsara, modelo, capacidad, tope de
 * paradas y color. Fuente única — el backend manda estos datos y el frontend
 * ya no guarda su propia copia (ver backend/delivery/fleet.py).
 */
export async function getFlota({ signal } = {}) {
  const res = await fetch(`${BASE}/flota`, { signal });
  if (!res.ok) throw new Error(`Flota failed: ${res.status}`);
  return res.json();
}

/**
 * Lanza el optimizador de rutas (OR-Tools).
 * @param {string} fecha
 * @param {string[]} placas — las placas de los camiones ACTIVOS en el panel.
 *   Se mandan las placas y no un conteo: el backend saca de cada placa su
 *   capacidad y su tope de paradas, así que apagar un camión y prender otro ya
 *   no deja el plan corriendo con la capacidad del que se apagó.
 * @param {number} horasTurno — turno del chofer en horas (default 6). Se puede
 *   ampliar (7, 8) cuando los pedidos del día no caben con el turno normal.
 * La hora de salida no se manda: el backend usa la salida real medida con GPS,
 * y las ETAs se recalculan con la hora verdadera al despachar el camión.
 */
export async function generarRutas(fecha, placas, horasTurno = 6, { signal } = {}) {
  const res = await fetch(`${BASE}/rutas/generar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, camiones: placas, horas_turno: horasTurno }),
    signal,
  });
  if (!res.ok) throw new Error(`Generar rutas failed: ${res.status}`);
  return res.json();
}

/**
 * Carga N pedidos de prueba con destinos reales ya importados del Excel de
 * SAP, sin depender de la conexión a SAP. SOLO para pruebas: borra las rutas
 * que hubiera ese día, incluidas las ya despachadas.
 * @param {string} fecha — Formato YYYY-MM-DD
 * @param {number} n — Cuántos pedidos de prueba crear
 */
export async function cargarPruebaPedidos(fecha, n, { signal } = {}) {
  const res = await fetch(`${BASE}/pedidos/cargar-prueba`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, n }),
    signal,
  });
  if (!res.ok) throw new Error(`Cargar prueba failed: ${res.status}`);
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
 * Ubicación en vivo (GPS real vía Samsara) de los camiones ISUZU de reparto.
 * Si Samsara no está configurado o no responde, el backend regresa [] en vez
 * de fallar, así que el dispatcher sigue funcionando sin el layer en vivo.
 */
export async function getCamionesGPS({ signal } = {}) {
  const res = await fetch(`${BASE}/camiones/gps`, { signal });
  if (!res.ok) throw new Error(`Camiones GPS failed: ${res.status}`);
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
