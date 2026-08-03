import { useCallback, useRef, useState } from 'react';

import { asignarManual, getSugerencias } from '../../../services/api';

/**
 * Meter a mano un pedido que el optimizador no acomodó.
 *
 * ── EL CANDADO DE ALERTA EN CURSO ──
 *
 * Sin él, abrir una alerta lenta y enseguida otra dejaba que la respuesta de la
 * PRIMERA llegara al final y pisara las sugerencias de la segunda. La tarjeta
 * mostraba entonces los camiones calculados para OTRO pedido, y al apretar
 * "asignar" el pedido se iba a la ruta equivocada **sin que nada se viera
 * raro**. Es el peor tipo de bug: el que no se nota.
 *
 * ── HTTP 200 NO SIGNIFICA ÉXITO ──
 *
 * django-ninja manda los errores de negocio con código 200 y `status: 'error'`
 * en el cuerpo, así que `fetch` no los ve como fallo. Sin revisar el cuerpo se
 * caía al camino feliz: se cerraba la tarjeta y se refrescaba como si el pedido
 * hubiera quedado asignado. Pasa de verdad cuando otro despachador ya lo asignó
 * desde otra pestaña.
 *
 * @param refrescar  vuelve a traer los datos del día tras una asignación.
 * @param avisar     avisos que no bloquean.
 */
export function useAsignacionManual(refrescar, avisar) {
  const [alertaAbierta, setAlertaAbierta] = useState(null);
  const [sugerencias, setSugerencias] = useState(null);
  const [cargandoSugerencias, setCargandoSugerencias] = useState(false);
  const [asignando, setAsignando] = useState(null);
  const [confirmacion, setConfirmacion] = useState(null);
  const [mandando, setMandando] = useState(null);   // id de la remisión que se fuerza

  const enCurso = useRef(null);

  const cerrar = useCallback(() => {
    enCurso.current = null;
    setAlertaAbierta(null);
    setSugerencias(null);
  }, []);

  /** Abrir (o cerrar) una alerta y pedir a qué camiones cabría ese pedido. */
  const toggleAlerta = useCallback(async (alerta) => {
    if (alertaAbierta === alerta.id) { cerrar(); return; }

    enCurso.current = alerta.id;
    setAlertaAbierta(alerta.id);
    setSugerencias(null);
    setCargandoSugerencias(true);
    try {
      const res = await getSugerencias(alerta.id);
      if (enCurso.current !== alerta.id) return;   // ya se abrió otra
      setSugerencias(res);
    } catch (e) {
      console.error('Error al pedir sugerencias:', e);
      if (enCurso.current === alerta.id) {
        avisar('No se pudieron calcular las opciones para este pedido.', 'error');
      }
    } finally {
      if (enCurso.current === alerta.id) setCargandoSugerencias(false);
    }
  }, [alertaAbierta, cerrar, avisar]);

  /** Asignar el pedido a la ruta escogida. */
  const handleAsignar = useCallback(async (remisionId, opcion, forzar = false) => {
    setAsignando(opcion.ruta_id);
    try {
      const res = await asignarManual(remisionId, {
        rutaId: opcion.ruta_id, posicion: opcion.posicion_sugerida, forzar,
      });
      if (res.status === 'requiere_confirmacion') {
        setConfirmacion({ remisionId, opcion, mensaje: res.message });
        return;
      }
      if (res.status === 'error') {
        avisar(res.message || 'No se pudo asignar el pedido.', 'error');
        return;
      }
      cerrar();
      await refrescar();
    } catch (e) {
      console.error('Error al asignar manualmente:', e);
      avisar('No se pudo asignar el pedido. Intenta de nuevo.', 'error');
    } finally {
      setAsignando(null);
    }
  }, [cerrar, refrescar, avisar]);

  /**
   * Mandarlo al camión que menos se desvía, aunque llegue fuera de la ventana.
   *
   * Es el mismo "Forzar" de siempre, pero sin obligar a abrir la tarjeta, leer
   * las cinco opciones y confirmar: cuando el despachador ya decidió que ese
   * pedido sale hoy, esos pasos solo estorban.
   */
  const mandarDeTodosModos = useCallback(async (alerta) => {
    setMandando(alerta.id);
    try {
      const sug = await getSugerencias(alerta.id);
      const opcion = sug.opciones?.[0];
      if (!opcion) {
        avisar(sug.error || 'No hay ninguna ruta a la que mandarlo. Genera rutas primero.', 'error');
        return;
      }
      const res = await asignarManual(alerta.id, {
        rutaId: opcion.ruta_id, posicion: opcion.posicion_sugerida, forzar: true,
      });
      if (res.status === 'error') avisar(res.message, 'error');
      else avisar(`Pedido #${alerta.doc_num} mandado en el ${opcion.camion}.`, 'exito');
      await refrescar();
    } catch (e) {
      console.error('Error al mandar de todos modos:', e);
      avisar('No se pudo mandar el pedido. Intenta de nuevo.', 'error');
    } finally {
      setMandando(null);
    }
  }, [refrescar, avisar]);

  return {
    alertaAbierta, sugerencias, cargandoSugerencias, asignando, mandando,
    confirmacion, setConfirmacion,
    toggleAlerta, handleAsignar, mandarDeTodosModos,
  };
}
