import { useCallback, useState } from 'react';

import { evaluarEscenarios, generarRutas, updateRutaEstado } from '../../../services/api';

/**
 * Armar el plan del día y moverlo por sus estados hasta que sale a la calle.
 *
 * Junta tres cosas que en la pantalla van juntas: correr el optimizador,
 * probar escenarios ("¿qué hago para que quepan todos?") y despachar cada
 * camión.
 *
 * @param fecha            el día que se está planeando.
 * @param camionesActivos  los camiones prendidos.
 * @param rutaDe           (placa) => su ruta hoy.
 * @param refrescar        vuelve a traer los datos del día.
 * @param escalonesTurno   los turnos que ofrece el panel (vienen de /api/config).
 * @param avisar           avisos que no bloquean.
 */
export function useOptimizacion({
  fecha, camionesActivos, rutaDe, refrescar, escalonesTurno, avisar,
}) {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [horasTurno, setHorasTurno] = useState(6);
  const [analisis, setAnalisis] = useState(null);   // resultado de "¿qué hago para que quepan?"
  const [analizando, setAnalizando] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(null);

  const optimizar = useCallback(async (turno) => {
    // Se mandan las PLACAS activas, no un conteo: el backend saca de cada placa
    // su capacidad y su tope de paradas. Antes se mandaba cuántos camiones
    // había y el backend tomaba los primeros N de una lista fija, así que
    // apagar uno y prender otro dejaba el plan corriendo con la capacidad del
    // que se apagó, sin avisar.
    const placas = camionesActivos.map((t) => t.id);
    if (!placas.length) { avisar('Activa al menos un camión antes de optimizar.', 'error'); return; }

    setIsOptimizing(true);
    // OJO: NO se apaga aquí la bandera de "hay rutas".
    //
    // Se apagaba, y solo se volvía a prender dentro del refresco, que corre
    // únicamente en el camino feliz. Si el optimizador tronaba o contestaba un
    // error de negocio —que viene con HTTP 200, en el cuerpo— la bandera se
    // quedaba apagada: el mapa dejaba de dibujar TODAS las polilíneas y los
    // números de parada. El plan anterior seguía intacto en la base, pero el
    // despachador veía el mapa vacío y creía que lo había perdido.
    //
    // Un fallo no puede borrar de la pantalla lo que sí existe.
    try {
      setAnalisis(null);   // el plan cambió: lo que se había probado ya no aplica
      const data = await generarRutas(fecha, placas, turno ?? horasTurno);
      if (data.status === 'success') await refrescar();
      else avisar(data.message, 'error');
    } catch {
      avisar('El optimizador no respondió. Sigues viendo el plan anterior.', 'error');
    } finally {
      setIsOptimizing(false);
    }
  }, [fecha, camionesActivos, horasTurno, refrescar, avisar]);

  /**
   * Sube el turno al siguiente escalón y vuelve a optimizar de una vez.
   *
   * Si el despachador aprieta "Turno a 6.5 h" es porque quiere ver si así
   * caben, no para tener que apretar Optimizar aparte.
   */
  const ampliarTurnoYOptimizar = useCallback(async (horas) => {
    const siguiente = horas ?? escalonesTurno.find((h) => h > horasTurno);
    if (!siguiente) return;
    setHorasTurno(siguiente);
    // Se le pasa explícito: el estado de React todavía no se actualizó en este
    // instante, así que `horasTurno` seguiría siendo el viejo dentro de
    // `optimizar`.
    await optimizar(siguiente);
  }, [escalonesTurno, horasTurno, optimizar]);

  /**
   * Prueba qué pasaría cambiando UNA cosa a la vez.
   *
   * Tarda porque son varias corridas del optimizador; el resultado se queda en
   * pantalla hasta que se vuelva a optimizar, para no rehacerlo en cada
   * refresco de 45 s.
   */
  const analizarEscenarios = useCallback(async () => {
    const placas = camionesActivos.map((t) => t.id);
    if (!placas.length) return;
    setAnalizando(true);
    try {
      const res = await evaluarEscenarios(fecha, placas, horasTurno);
      if (res.status === 'success') setAnalisis(res);
      else avisar(res.message, 'error');
    } catch {
      avisar('No se pudieron probar las opciones.', 'error');
    } finally {
      setAnalizando(false);
    }
  }, [fecha, camionesActivos, horasTurno, avisar]);

  /** Mover un camión al siguiente paso del despacho. */
  const cambiarEstadoRuta = useCallback(async (placa, nuevoEstado) => {
    const ruta = rutaDe(placa);
    if (!ruta) { avisar('Este camión no tiene ruta todavía. Genera rutas primero.', 'error'); return; }
    setCambiandoEstado(placa);
    try {
      const res = await updateRutaEstado(ruta.id, nuevoEstado);
      // El backend valida las transiciones y rechaza los saltos con HTTP 200 y
      // `status: 'error'`. Sin revisarlo, el botón parecería no hacer nada.
      if (res.status === 'error') avisar(res.message, 'error');
      await refrescar();
    } catch (e) {
      avisar('No se pudo cambiar el estado: ' + e.message, 'error');
    } finally {
      setCambiandoEstado(null);
    }
  }, [rutaDe, refrescar, avisar]);

  return {
    isOptimizing, horasTurno, setHorasTurno,
    analisis, analizando, cambiandoEstado,
    optimizar, ampliarTurnoYOptimizar, analizarEscenarios, cambiarEstadoRuta,
  };
}
