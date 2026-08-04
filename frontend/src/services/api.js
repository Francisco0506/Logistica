/**
 * Servicio centralizado de API para el backend Django de Laben.
 * Usa rutas relativas que el proxy de Vite redirige a http://127.0.0.1:8000.
 */

const BASE = '/api/dispatcher';
const BASE_VENTAS = '/api/ventas';

/**
 * Cuánto se espera una llamada DEL CHOFER antes de darla por perdida.
 *
 * 30 s es de sobra para una foto por 4G malo, y bastante menos que "para
 * siempre", que es lo que tardaba antes.
 */
const LIMITE_CHOFER_MS = 30_000;

/**
 * Una señal que se cancela sola a los N segundos, sin perder la del que llamó.
 *
 * El chofer trabaja en la calle: portal cautivo del wifi del cliente, antena
 * saturada en el andén, TCP que se muere sin que nadie cierre el socket. En
 * todos esos casos `fetch` NO rechaza NI resuelve: se queda colgado para
 * siempre. Y como los botones de la hoja de entrega se apagan mientras hay una
 * llamada en vuelo, un solo fetch zombi dejaba al chofer sin poder reportar
 * NADA el resto del día — "Entregué todo" y "Confirmar" salían deshabilitados
 * en todas las paradas siguientes, y la única salida era recargar el navegador,
 * que un chofer no tiene por qué saber hacer.
 *
 * Se combina a mano con la señal que ya venía (la del `AbortController` del
 * componente, que cancela al desmontar) porque `AbortSignal.any` todavía no
 * está en todos los celulares que trae la flota.
 */
function conLimite(signal, ms = LIMITE_CHOFER_MS) {
  const propio = new AbortController();
  const reloj = setTimeout(
    () => propio.abort(new DOMException('Se acabó el tiempo de espera', 'TimeoutError')),
    ms,
  );
  let contagiar = null;
  if (signal) {
    if (signal.aborted) propio.abort(signal.reason);
    else {
      contagiar = () => propio.abort(signal.reason);
      signal.addEventListener('abort', contagiar, { once: true });
    }
  }
  // `listo()` también suelta el listener: la señal del componente vive todo el
  // turno y estas llamadas van en intervalos, así que sin quitarlo se le
  // acumularían cientos de suscriptores a lo largo del día.
  return {
    señal: propio.signal,
    listo: () => {
      clearTimeout(reloj);
      if (contagiar) signal.removeEventListener('abort', contagiar);
    },
  };
}

/**
 * Las reglas y el vocabulario del backend: estados, transiciones, motivos,
 * escalones de turno, tiempo de descarga, CEDIS.
 *
 * Todo esto estaba TRANSCRITO a mano en el frontend, y ya causó tres bugs
 * reales por desfase (la paleta duplicada, la lista de camiones de Samsara, y
 * los estados finales copiados en cinco archivos). Ver backend/delivery/api/config.py.
 */
export async function getConfig({ signal } = {}) {
  const res = await fetch('/api/config', { signal });
  if (!res.ok) throw new Error(`Config failed: ${res.status}`);
  return res.json();
}

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
 * Qué día tiene que abrir el panel. NO es hoy: la entrega capturada un día sale
 * al siguiente, así que en la mañana lo que va a salir se capturó ayer. Ver
 * docs/flujo-documentos-sap.md.
 * @returns {Promise<{fecha_carga: string, fecha_reparto: string, entregas: number, explicacion: string}>}
 */
export async function getJornada({ reparto, signal } = {}) {
  const url = reparto ? `${BASE}/jornada?reparto=${reparto}` : `${BASE}/jornada`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Jornada failed: ${res.status}`);
  return res.json();
}

/**
 * Trae de SAP B1 las órdenes de entrega de ese día y las guarda en la base.
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
  // Con límite: esta va en un intervalo de 60 s y una colgada dejaba
  // `cargando` prendido y la pantalla en "Cargando tus entregas…" para siempre.
  const { señal, listo } = conLimite(signal);
  try {
    const res = await fetch(`/api/chofer/ruta?fecha=${fecha}&camion=${encodeURIComponent(camion)}`, { signal: señal });
    if (res.status === 404) return null;   // ese camión no tiene ruta hoy
    if (!res.ok) throw new Error(`Ruta chofer failed: ${res.status}`);
    return res.json();
  } finally {
    listo();
  }
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
  const { señal, listo } = conLimite(signal);
  try {
    const res = await fetch(`/api/chofer/paradas/${remisionId}/entregar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineas, motivo, observaciones, recibio }),
      signal: señal,
    });
    if (!res.ok) throw new Error(`Confirmar entrega failed: ${res.status}`);
    return res.json();
  } finally {
    listo();
  }
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
  const { señal, listo } = conLimite(signal);
  try {
    const res = await fetch(`/api/chofer/paradas/${remisionId}/foto`, {
      method: 'POST', body: datos, signal: señal,
    });
    if (!res.ok) throw new Error(`Subir foto failed: ${res.status}`);
    return res.json();
  } finally {
    listo();
  }
}

/**
 * La firma de quien recibe, tal como la trazó en la pantalla del celular.
 *
 * `imagen` es el Blob PNG que devuelve el recuadro de firma (PanelFirma).
 * Va aparte de la confirmación por lo mismo que la foto: si la señal falla al
 * subirla, la entrega ya quedó registrada de todos modos.
 */
export async function subirFirmaEntrega(remisionId, imagen, { signal } = {}) {
  const datos = new FormData();
  // El nombre del archivo importa: Django decide la extensión con él, y sin
  // ella la firma se guarda sin `.png` y el navegador no sabe cómo mostrarla.
  datos.append('firma', imagen, `firma-${remisionId}.png`);
  const { señal, listo } = conLimite(signal);
  try {
    const res = await fetch(`/api/chofer/paradas/${remisionId}/firma`, {
      method: 'POST', body: datos, signal: señal,
    });
    if (!res.ok) throw new Error(`Subir firma failed: ${res.status}`);
    return res.json();
  } finally {
    listo();
  }
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
