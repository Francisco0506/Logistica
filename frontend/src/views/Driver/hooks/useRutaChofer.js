import { useEffect, useRef, useState } from 'react';

import {
  getRutas, getRutaChofer, getCamionesGPS, getFlota, getJornada,
} from '../../../services/api';
import { hoyLocal } from '../../../lib/fecha';

// Se refresca para que el chofer vea si el despachador le movió algo.
const REFRESH_MS = 60_000;

/**
 * Todo lo que la app del chofer necesita TRAER del backend: la lista de
 * camiones que salen hoy (para escoger), la flota (colores), su posición GPS
 * y, ya escogido el camión, su ruta del día — con el refresco periódico y el
 * candado de corridas para que una respuesta vieja no pise a una nueva.
 */
export function useRutaChofer(camion) {
  // La fecha con la que están guardadas las rutas es la de CAPTURA
  // (`fecha_carga`), no la de hoy: lo capturado ayer sale hoy. `Ruta.fecha` en
  // el backend se filtra por esa fecha de captura, igual que en el panel del
  // despachador — que la pide con `getJornada()` en vez de usar el día de
  // reloj.
  //
  // Antes esta pantalla armaba la fecha con `hoyLocal()` a secas. Entre semana
  // funciona casi siempre por casualidad: de madrugada o muy noche coincide
  // con la fecha de captura. Pero cualquier día normal a media mañana —que es
  // cuando el chofer de verdad abre la app— `hoyLocal()` es la fecha de
  // REPARTO, no la de captura, así que `getRutas`/`getRutaChofer` preguntaban
  // por rutas guardadas bajo un día que no es, y la pantalla decía "todavía no
  // hay camiones para hoy" con el CEDIS ya despachando desde hace rato.
  const [fechaCarga, setFechaCarga] = useState(null);
  const [rutasDelDia, setRutasDelDia] = useState([]);
  // Distinguir "todavía no llega la respuesta" de "no hay rutas". Sin esto, con
  // la señal de la calle el chofer veía "Sin rutas todavía · Pregunta en el
  // CEDIS" durante segundos aunque sus rutas SÍ existieran — y ese chofer marca
  // al CEDIS por nada.
  const [buscandoRutas, setBuscandoRutas] = useState(true);
  const [flota, setFlota] = useState([]);
  const [ruta, setRuta] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [gps, setGps] = useState([]);

  // Se pregunta POR EL REPARTO DE HOY, no "qué toca preparar ahora".
  //
  // `getJornada()` sin parámetro contesta lo que le sirve al DESPACHADOR, y a
  // las 11 de la mañana (HORA_CORTE_JORNADA) cambia solo: pasa a preparar el
  // reparto de MAÑANA, porque lo de hoy ya está en la calle. Para el
  // despachador es correcto; para el chofer es exactamente lo contrario de lo
  // que necesita — él está en la calle repartiendo lo de HOY, y a las 11:00 la
  // pantalla se le brincaba al día siguiente y le decía "todavía no hay
  // camiones para hoy" con su propia ruta a medio hacer.
  //
  // Preguntando por `reparto = hoy` se obtiene la fecha de captura de lo que
  // se está entregando hoy (el 04 para el reparto del 05), que es con la que
  // están guardadas sus rutas, y ya no depende de la hora.
  useEffect(() => {
    const c = new AbortController();
    getJornada({ reparto: hoyLocal(), signal: c.signal })
      .then((j) => setFechaCarga(j.fecha_carga))
      .catch(() => {});
    return () => c.abort();
  }, []);

  // Token de corrida para las respuestas de /chofer/ruta. Mismo patrón que
  // `corrida` en Dispatcher/hooks/useJornada.js, y aquí hacía más falta que allá.
  //
  // Hay TRES fuentes que escriben `ruta`: el intervalo de 60 s, el refetch
  // después de confirmar una entrega y el de después de reintentar la
  // evidencia. En la calle las respuestas no llegan en el orden en que
  // salieron: el GET del intervalo salía ANTES del POST de la entrega y llegaba
  // DESPUÉS, así que pisaba el estado bueno con uno viejo. La parada que el
  // chofer acababa de reportar reaparecía en "La que sigue" —con su botón verde
  // y todo— y la reportaba dos veces. Con el contador, una respuesta que ya no
  // es la última se tira sin tocar la pantalla.
  const corrida = useRef(0);

  // Los camiones que SALEN hoy. Antes se listaba la flota completa, incluidos
  // los que están apagados y los que no tienen ruta: el chofer podía escoger un
  // camión que no va a ninguna parte.
  useEffect(() => {
    // Sin fecha de captura todavía no hay nada que preguntar — y no se debe
    // preguntar con una fecha a medias, porque una respuesta vacía apagaría
    // `buscandoRutas` antes de tiempo y la pantalla diría "no hay camiones"
    // por un instante aunque sí los haya.
    if (!fechaCarga) return undefined;
    const c = new AbortController();
    // Se vuelve a preguntar cada 30 s. Antes se pedía UNA sola vez al abrir la
    // app: si el despachador generaba las rutas a las 6:40 y el chofer había
    // abierto a las 6:35, la pantalla se quedaba vacía PARA SIEMPRE hasta que
    // se le ocurriera recargar el navegador — y un chofer no tiene por qué
    // saber recargar un navegador.
    const traer = () => getRutas(fechaCarga, { signal: c.signal })
      .then(setRutasDelDia)
      .catch(() => {})
      .finally(() => setBuscandoRutas(false));
    traer();
    const i = setInterval(traer, 30_000);
    return () => { c.abort(); clearInterval(i); };
  }, [fechaCarga]);

  // El color del camión, que lo identifica en TODAS las demás pantallas. Esta
  // era la única donde no aparecía.
  useEffect(() => {
    const c = new AbortController();
    getFlota({ signal: c.signal }).then(setFlota).catch(() => {});
    return () => c.abort();
  }, []);
  const colorDe = (placa) => flota.find((f) => f.placa === placa)?.color || '#94a3b8';

  // Su propia posición, para verse en el mapa. Aparte de la ruta: si Samsara
  // falla, la lista de paradas sigue funcionando.
  useEffect(() => {
    const c = new AbortController();
    const traer = () => getCamionesGPS({ signal: c.signal }).then(setGps).catch(() => {});
    traer();
    const i = setInterval(traer, 20_000);
    return () => { c.abort(); clearInterval(i); };
  }, []);

  useEffect(() => {
    if (!camion || !fechaCarga) { setRuta(null); return undefined; }
    const c = new AbortController();
    const traer = () => {
      const mia = ++corrida.current;
      getRutaChofer(fechaCarga, camion, { signal: c.signal })
        .then((r) => { if (mia === corrida.current) setRuta(r); })
        .catch((e) => { if (e.name !== 'AbortError') console.error('Ruta chofer:', e); })
        .finally(() => { if (mia === corrida.current) setCargando(false); });
    };
    setCargando(true);
    traer();
    const i = setInterval(traer, REFRESH_MS);
    return () => { c.abort(); clearInterval(i); };
  }, [camion, fechaCarga]);

  /**
   * Pedir la ruta y escribirla SOLO si sigue siendo la respuesta más nueva.
   *
   * Tira el error hacia arriba a propósito: quien la llama ya sabe qué decirle
   * al chofer si no se pudo refrescar.
   */
  const refrescarRuta = async () => {
    const mia = ++corrida.current;
    const r = await getRutaChofer(fechaCarga, camion);
    if (mia === corrida.current) setRuta(r);
  };

  // Para el botón "Volver a buscar": mismo `getRutas`, misma fecha de
  // captura, sin que quien llama tenga que saber cuál es.
  const reintentarBusqueda = () => {
    if (!fechaCarga) return;
    setBuscandoRutas(true);
    getRutas(fechaCarga)
      .then(setRutasDelDia)
      .catch(() => {})
      .finally(() => setBuscandoRutas(false));
  };

  return {
    rutasDelDia, buscandoRutas,
    flota, colorDe, gps, ruta, cargando, refrescarRuta, reintentarBusqueda,
  };
}
