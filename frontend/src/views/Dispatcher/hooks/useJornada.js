import { useCallback, useEffect, useRef, useState } from 'react';

import { getJornada } from '../../../services/api';
import { hoyLocal } from '../../../lib/fecha';

/**
 * QUÉ DÍA está viendo el panel.
 *
 * Hay DOS fechas distintas y confundirlas es el error más caro de esta pantalla:
 *
 *   fecha_carga    el día en que se CAPTURÓ el documento en SAP. Es con la que
 *                  están guardados los pedidos, y con la que se le pregunta al
 *                  backend.
 *   fecha_reparto  el día en que SALE el camión. Es la que se le enseña al
 *                  despachador, porque es como piensa cualquiera.
 *
 * Normalmente reparto = carga + 1 (lo capturado un día sale al siguiente), pero
 * no siempre: el sábado sale el lunes, porque el domingo no se reparte. Por eso
 * la traducción la hace el BACKEND (`delivery/calendario.py`) y no se calcula
 * aquí: tener dos calendarios fue exactamente el bug que hizo que el panel
 * prometiera un reparto en domingo.
 *
 * Antes el selector mostraba la fecha del DOCUMENTO: al ponerle "30" para ver el
 * reparto de mañana, el panel salía vacío porque esos pedidos están guardados
 * bajo el "29".
 */
export function useJornada(avisar) {
  // Arranca en hoy solo para no tener el selector vacío el primer segundo; el
  // backend dice enseguida cuál es el día bueno.
  const [fecha, setFecha] = useState(hoyLocal());
  const [jornada, setJornada] = useState(null);

  // Token de corrida. `cambiarDiaDeReparto` era el ÚNICO fetch disparado por un
  // control del panel sin esta protección: dos cambios de fecha seguidos podían
  // asentarse en orden invertido y dejar los pedidos de un día bajo el
  // encabezado de otro. Es el mismo problema que `corridaActual` resuelve para
  // los datos, y aquí faltaba.
  const corrida = useRef(0);

  // Se pregunta una sola vez, al entrar. Si el despachador cambia la fecha a
  // mano después, no se le vuelve a mover bajo los pies.
  useEffect(() => {
    const controller = new AbortController();
    const mia = ++corrida.current;
    getJornada({ signal: controller.signal })
      .then((j) => {
        if (mia !== corrida.current) return;
        setJornada(j);
        setFecha(j.fecha_carga);
      })
      .catch((e) => { if (e.name !== 'AbortError') console.error('No se pudo saber qué día cargar:', e); });
    return () => controller.abort();
  }, []);

  /**
   * El despachador escogió otro día de REPARTO en el selector.
   *
   * Se le pregunta al backend de qué día son los documentos que salen ese día.
   */
  const cambiarDiaDeReparto = useCallback(async (fechaReparto) => {
    const mia = ++corrida.current;
    try {
      const j = await getJornada({ reparto: fechaReparto });
      if (mia !== corrida.current) return;   // ya se escogió otro día después
      setJornada(j);
      setFecha(j.fecha_carga);
    } catch {
      if (mia === corrida.current) avisar('No se pudo cambiar de día.', 'error');
    }
  }, [avisar]);

  return { fecha, setFecha, jornada, cambiarDiaDeReparto };
}
