import { useCallback, useEffect, useRef, useState } from 'react';

import { getAlertas, getRemisiones, getRutas, syncSAP } from '../../../services/api';

// Cada cuánto se refresca la vista para traer lo más nuevo (pedidos nuevos de
// SAP, cambios de estado de otros usuarios) sin recargar la página a mano.
const REFRESH_INTERVAL_MS = 45_000;

/**
 * Los datos del día: pedidos, rutas y alertas. El corazón del panel.
 *
 * ── EL CANDADO DE CORRIDAS, que es lo delicado de este archivo ──
 *
 * Cada llamada se queda con su número y solo escribe en pantalla si al volver
 * SIGUE siendo la más reciente. Hay tres cosas que llaman a la vez —el refresco
 * de 45 s, el botón Actualizar, y el refetch después de cada acción— y sin
 * candado se mezclaban:
 *
 *   · El despachador da "Salida" y enseguida cambia el día de reparto. El
 *     refetch de la salida sigue vivo con la fecha VIEJA y sus respuestas pisan
 *     los pedidos del día nuevo: el panel termina mostrando un día bajo un
 *     encabezado que dice otro.
 *   · Optimizar tarda ~30 s; a media corrida entra el tick de 45 s y escribe
 *     los pedidos sin ruta. Durante un ciclo se ven camiones con 0 paradas.
 *
 * El AbortController NO alcanza: solo cancela lo del efecto, no lo que
 * dispararon los botones.
 *
 * ── SAP NO PUEDE TUMBAR EL PANEL ──
 *
 * El sync va en su propio `try` y su fallo no detiene lo demás. Estaba
 * encadenado —`await syncSAP(...)` y hasta después los pedidos— así que si SAP
 * se colgaba, el despachador se quedaba sin panel: sin pedidos, sin rutas y sin
 * alertas. Datos que YA ESTÁN en Postgres y no dependen de SAP para nada.
 */
export function useDatosDelDia(fecha) {
  const [orders, setOrders] = useState([]);
  const [rutas, setRutas] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [routesGenerated, setRoutesGenerated] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Conectando…');
  const [syncStatusTipo, setSyncStatusTipo] = useState('info');
  const [actualizando, setActualizando] = useState(false);

  const corridaActual = useRef(0);

  // La fecha se lee de un ref y no de la clausura: `refrescar` se le pasa a
  // otros hooks (optimizar, despachar) y si capturara la fecha del render en
  // que se creó, un refetch disparado después de cambiar de día traería el día
  // viejo. Es la misma clase de bug que el candado de corridas resuelve, por el
  // otro lado.
  const fechaRef = useRef(fecha);
  fechaRef.current = fecha;

  const fetchData = useCallback(async (signal) => {
    const dia = fechaRef.current;
    const corrida = ++corridaActual.current;
    const vigente = () => corridaActual.current === corrida;

    try {
      const syncData = await syncSAP(dia, { signal });
      if (!vigente()) return;
      setSyncStatus(syncData.message);
      setSyncStatusTipo(
        syncData.status === 'success' ? 'ok' : syncData.status === 'warning' ? 'warning' : 'error',
      );
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('Sync SAP:', e);
      if (vigente()) {
        // Se dice lo que pasa Y lo que se está viendo, sin adornos: un letrero
        // que solo diga "error" deja al despachador sin saber si los pedidos de
        // la pantalla sirven o no.
        setSyncStatus('SAP no respondió. Estás viendo lo último que se trajo.');
        setSyncStatusTipo('error');
      }
    }

    try {
      // `truck` ya viene como placa real del backend.
      const remData = await getRemisiones(dia, { signal });
      if (!vigente()) return;
      setOrders(remData.map((o) => ({ ...o, truck: o.truck || null })));

      const rutData = await getRutas(dia, { signal });
      if (!vigente()) return;
      setRutas(rutData);
      // Con `else`: antes solo se prendía. Al cambiar del reparto de hoy (con
      // rutas) al de mañana (sin rutas), la bandera se quedaba en true y el
      // panel seguía pintando la leyenda "Rutas en el mapa" y camiones de 0
      // paradas de un plan que no existe.
      setRoutesGenerated(rutData.length > 0);

      const alertasData = await getAlertas(dia, { signal });
      if (!vigente()) return;
      setAlertas(alertasData);
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('Backend error:', e);
      // Este sí es grave: no respondió Postgres, no una fuente externa.
      setSyncStatus('Sin conexión con el backend');
      setSyncStatusTipo('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    const interval = setInterval(() => fetchData(controller.signal), REFRESH_INTERVAL_MS);
    return () => { controller.abort(); clearInterval(interval); };
  }, [fecha, fetchData]);

  /** Botón de Actualizar: trae lo que almacén capturó, sin esperar los 45 s. */
  const actualizarAhora = useCallback(async () => {
    setActualizando(true);
    try {
      await fetchData();
    } finally {
      setActualizando(false);
    }
  }, [fetchData]);

  return {
    orders, rutas, alertas,
    routesGenerated, setRoutesGenerated,
    syncStatus, setSyncStatus, syncStatusTipo, setSyncStatusTipo,
    actualizando, actualizarAhora,
    refrescar: fetchData,
  };
}
