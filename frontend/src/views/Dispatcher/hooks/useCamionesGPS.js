import { useEffect, useState } from 'react';

import { getCamionesGPS } from '../../../services/api';

// Más seguido que el resto del panel: es lo ÚNICO que se mueve solo en el mapa.
// Antes viajaba junto con los pedidos cada 45 s y los camiones parecían
// congelados.
const GPS_INTERVAL_MS = 15_000;

/**
 * Dónde están los camiones ahora mismo, según el GPS de Samsara.
 *
 * Va en su propio ciclo y con su propio manejo de errores, aparte del resto del
 * panel. No es un detalle de organización: **si Samsara falla, el panel tiene
 * que seguir sirviendo**. El plan del día vive en Postgres y no depende del
 * GPS para nada.
 *
 * Es el primer hook que se extrae de `Dispatcher/index.jsx` (952 líneas, 40
 * `useState`) y se escogió por eso: cero dependencias de otro estado, su propio
 * efecto, y solo lo consumen el mapa y la tabla de pedidos.
 */
export function useCamionesGPS() {
  const [camionesGPS, setCamionesGPS] = useState([]);

  useEffect(() => {
    const controller = new AbortController();
    const traerGPS = () => {
      getCamionesGPS({ signal: controller.signal })
        .then(setCamionesGPS)
        // Se anota y ya. Un GPS que no responde no se le grita al despachador
        // cada 15 segundos: no hay nada que pueda hacer al respecto.
        .catch((e) => { if (e.name !== 'AbortError') console.error('Camiones GPS error:', e); });
    };
    traerGPS();
    const interval = setInterval(traerGPS, GPS_INTERVAL_MS);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);

  return camionesGPS;
}
