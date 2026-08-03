import { useCallback, useEffect, useState } from 'react';

import { getFlota } from '../../../services/api';
import { colorLibre } from '../../../lib/color';

// Los estados en que un camión ya NO se puede apagar. Es a propósito una lista
// distinta de `ESTADOS_RUTA_DESPACHADA` del backend: allá incluye 'Finalizada'
// —una ruta terminada tampoco se replanea— pero aquí un camión que ya cerró su
// día SÍ se puede apagar, porque ya no hay nada que perder de vista.
//
// Por eso el nombre dice qué IMPIDE y no repite el del backend: dos listas con
// el mismo nombre y distinto contenido es una trampa.
const ESTADOS_NO_SE_PUEDE_APAGAR = ['Cargando', 'Listo', 'En_Ruta'];

// Un camión como lo manda el backend -> como lo usa el panel. `driver` arranca
// vacío a propósito: quién maneja cada unidad no es un dato que el sistema
// tenga, y antes se mostraba un "Chofer 1" inventado.
const aCamionDelPanel = (c) => ({
  id: c.placa,
  samsara: c.samsara,
  modelo: c.modelo,
  capacidadKg: c.capacidad_kg,
  maxParadas: c.max_paradas,
  color: c.color,
  active: c.activo_default,
  driver: '',
});

/**
 * La flota del panel: qué camiones hay, cuáles están prendidos y quién maneja.
 *
 * La lista sale del backend (`fleet.py`, fuente única) y **se pide una sola vez
 * al abrir**. NO se recarga en el refresco de 45 s a propósito: eso borraría
 * los choferes capturados a mano y volvería a prender los camiones que el
 * despachador apagó.
 *
 * @param rutaDe  (placa) => la ruta de ese camión hoy, o undefined. Se inyecta
 *   en vez de importarse porque las rutas son datos del día y esto es la flota:
 *   el hook necesita consultarlas para la regla de "no apagar un camión
 *   despachado", pero no tiene por qué saber de dónde salen.
 * @param avisar  para los avisos que no bloquean.
 */
export function useFlota(rutaDe, avisar) {
  const [trucks, setTrucks] = useState([]);
  const [ordenFlota, setOrdenFlota] = useState([]);
  // La paleta, tal como la manda el backend. Ya no hay copia en el frontend.
  const [ordenColores, setOrdenColores] = useState([]);
  const [flotaCargada, setFlotaCargada] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getFlota({ signal: controller.signal })
      .then((flota) => {
        setTrucks(flota.map(aCamionDelPanel));
        setOrdenFlota(flota.map((c) => c.placa));
        setOrdenColores(flota.map((c) => c.color));
        setFlotaCargada(true);
      })
      .catch((e) => { if (e.name !== 'AbortError') console.error('No se pudo cargar la flota:', e); });
    return () => controller.abort();
  }, []);

  /**
   * Prender o apagar un camión.
   *
   * NO se puede apagar uno que ya está despachado. Apagarlo quitaría sus
   * entregas de la vista mientras el chofer las sigue haciendo: el despachador
   * dejaría de ver pedidos que están ocurriendo en la calle.
   */
  const toggleTruck = useCallback((id) => {
    const camion = trucks.find((t) => t.id === id);
    const ruta = rutaDe(id);
    if (camion?.active && ruta && ESTADOS_NO_SE_PUEDE_APAGAR.includes(ruta.estado)) {
      avisar(
        `El ${id} ya está despachado (${ruta.estado.replace('_', ' ').toLowerCase()}). ` +
        'No se puede apagar sin perder de vista sus entregas; primero cierra su ruta.',
        'error',
      );
      return;
    }
    setTrucks((prev) => prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t)));
  }, [trucks, rutaDe, avisar]);

  const changeDriver = useCallback((id, d) => {
    setTrucks((prev) => prev.map((t) => (t.id === id ? { ...t, driver: d } : t)));
  }, []);

  /**
   * Dar de alta un camión que no está en `fleet.py`.
   *
   * Devuelve `true` si se agregó. `false` si la placa ya existía — y esa
   * validación no es cosmética: sin ella quedaban dos entradas con el mismo
   * `id`, y a partir de ahí todo mentía. Dos tarjetas con la misma llave de
   * React mostrando las mismas paradas, prender o apagar una movía las DOS
   * (`toggleTruck` filtra por id), el conteo decía "12 camiones" con 11, y el
   * manifiesto salía impreso dos veces.
   */
  const agregarCamion = useCallback((placaCruda, choferCrudo = '') => {
    // Se normaliza porque las placas se teclean a mano: "ra7475a" y "RA7475A "
    // son la misma unidad.
    const normaliza = (v) => (v ?? '').trim().toUpperCase();
    const placa = normaliza(placaCruda);
    if (!placa) return false;

    const yaEsta = trucks.find((t) => normaliza(t.id) === placa);
    if (yaEsta) {
      avisar(`La placa ${placa} ya existe en la flota${yaEsta.active ? '' : ' (está apagada)'}.`, 'error');
      return false;
    }

    // Un color que NO esté ya en uso, escogido contra la paleta que mandó el
    // backend. Antes era `PALETA[trucks.length % 8]` contra una copia local de
    // 8 colores mientras la flota creció a 11: `11 % 8 = 3` le daba al camión
    // nuevo el MISMO color que al RJ97892, encimados en el mismo mapa.
    const color = colorLibre(trucks.map((t) => t.color), ordenColores);
    setTrucks((prev) => [...prev, { id: placa, driver: choferCrudo.trim(), color, active: true }]);
    return true;
  }, [trucks, ordenColores, avisar]);

  const camionesActivos = trucks.filter((t) => t.active);
  const colorOf = useCallback(
    (placa) => trucks.find((t) => t.id === placa)?.color || '#94a3b8',
    [trucks],
  );

  return {
    trucks, camionesActivos, ordenFlota, ordenColores, flotaCargada,
    toggleTruck, changeDriver, agregarCamion, colorOf,
  };
}
