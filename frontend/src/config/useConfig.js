import { useEffect, useState } from 'react';

import { getConfig } from '../services/api';

/**
 * Las reglas del negocio, pedidas al backend en vez de transcritas aquí.
 *
 * NUNCA BLOQUEA EL RENDER, y es la decisión importante de este archivo. Si
 * `/api/config` no contesta —el backend reiniciándose, la red de la oficina— la
 * pantalla se dibuja con los DEFAULTS de abajo, que son exactamente los valores
 * que estaban clavados en el código antes de que este hook existiera. O sea:
 * en el peor caso el sistema se comporta como se comportaba, no se queda en
 * blanco.
 *
 * Es la misma regla que se aplicó al panel con SAP: una fuente que no responde
 * no puede tumbar lo que ya funciona.
 */

// Copia deliberada de lo que el backend manda. No es una segunda fuente de
// verdad: es el paracaídas. Si estos valores se desfasan, lo peor que pasa es
// que durante una caída de red el panel se vea como se veía en julio.
export const CONFIG_POR_DEFECTO = {
  estados_entrega_final: ['Entregado', 'Entregado_Parcial', 'No_Entregado'],
  estados_ruta_despachada: ['Cargando', 'Listo', 'En_Ruta', 'Finalizada'],
  transiciones: {
    Borrador: ['Cargando'],
    Cargando: ['Listo'],
    Listo: ['En_Ruta'],
    En_Ruta: ['Finalizada'],
    Finalizada: [],
  },
  motivos_no_entrega: [],
  motivos_sin_entrega: [],
  escalones_turno_horas: [6, 6.5, 7, 7.5, 8],
  turno_default_horas: 6,
  tiempo_descarga_minutos: 12,
  margen_eta_minutos: 15,
  peso_estimado_kg: 150,
  cedis: null,
  camion_desconocido: { capacidad_kg: 3000, max_paradas: 25 },
  osrm_base: '',
};

export function useConfig() {
  const [config, setConfig] = useState(CONFIG_POR_DEFECTO);
  const [cargada, setCargada] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getConfig({ signal: controller.signal })
      .then((datos) => { setConfig({ ...CONFIG_POR_DEFECTO, ...datos }); setCargada(true); })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        // No se avisa al usuario: no hay nada que pueda hacer y el sistema
        // sigue funcionando con los defaults. Queda en la consola para quien
        // depure.
        console.error('No se pudo leer /api/config, se usan los valores por defecto:', e);
      });
    return () => controller.abort();
  }, []);

  return { config, cargada };
}
