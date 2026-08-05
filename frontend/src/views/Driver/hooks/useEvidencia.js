import { useEffect, useState } from 'react';

import { subirFotoEntrega, subirFirmaEntrega } from '../../../services/api';

/**
 * La evidencia (foto y firma) que no alcanzó a subir, por parada, y sus
 * reintentos.
 *
 * Vive en memoria a propósito y no en localStorage: un File/Blob no se puede
 * serializar, y guardar la foto en el navegador para "después" daría una
 * promesa que no se puede cumplir si el chofer cierra la pestaña. Lo honesto
 * es ofrecer el reintento mientras la app siga abierta, que es el caso real
 * (el chofer llega a la siguiente bodega y ahí sí hay señal).
 *
 * `onPendiente` se llama cada vez que queda evidencia sin subir, para que
 * quien use el hook pueda, por ejemplo, abrir la sección donde se ve.
 */
export function useEvidencia(avisar, refrescarRuta, onPendiente) {
  const [evidenciaPendiente, setEvidenciaPendiente] = useState({});
  const [subiendoEvidencia, setSubiendoEvidencia] = useState(null);

  // Cuántas paradas tienen foto o firma que no alcanzó a subir.
  const conEvidenciaPendiente = Object.keys(evidenciaPendiente).length;

  // Si hay evidencia sin subir, se ABRE sola la sección de "Ya reportadas".
  //
  // El reintento existía y funcionaba, pero vivía dentro de un bloque que
  // arranca colapsado. Lo único que le avisaba al chofer era un toast rojo que
  // se va en segundos: después de eso, la pantalla se veía idéntica a un día
  // sin problemas. Y la evidencia vive solo en memoria —un File no se puede
  // guardar en localStorage— así que si el navegador descarta la pestaña, cosa
  // que pasa justo al abrir la cámara, la foto se pierde en silencio y no hay
  // de dónde volver a sacarla: es lo único del sistema que no se le puede pedir
  // a SAP ni a nadie.
  //
  // Solo abre; no vuelve a cerrar. Si el chofer la cierra a propósito para ver
  // el mapa, la pantalla no se le pelea.
  useEffect(() => {
    if (conEvidenciaPendiente > 0) onPendiente();
  }, [conEvidenciaPendiente]);

  /**
   * Volver a intentar subir la evidencia de una parada ya confirmada.
   *
   * Solo reintenta lo que falta: si la foto sí subió y la firma no, no se
   * vuelve a mandar la foto.
   */
  const reintentarEvidencia = async (remisionId) => {
    const pend = evidenciaPendiente[remisionId];
    if (!pend) return;
    setSubiendoEvidencia(remisionId);
    const sigueFallando = {};
    if (pend.foto) {
      try { await subirFotoEntrega(remisionId, pend.foto); }
      catch { sigueFallando.foto = pend.foto; }
    }
    if (pend.firma) {
      try { await subirFirmaEntrega(remisionId, pend.firma); }
      catch { sigueFallando.firma = pend.firma; }
    }
    setSubiendoEvidencia(null);

    setEvidenciaPendiente((prev) => {
      const copia = { ...prev };
      if (sigueFallando.foto || sigueFallando.firma) copia[remisionId] = sigueFallando;
      else delete copia[remisionId];
      return copia;
    });

    if (sigueFallando.foto || sigueFallando.firma) {
      avisar('Sigue sin subir. Inténtalo donde agarre mejor la señal.', 'error');
    } else {
      avisar('Listo, ya subió.', 'exito');
      try { await refrescarRuta(); } catch { /* el intervalo la trae */ }
    }
  };

  return {
    evidenciaPendiente, setEvidenciaPendiente,
    subiendoEvidencia, conEvidenciaPendiente,
    reintentarEvidencia,
  };
}
