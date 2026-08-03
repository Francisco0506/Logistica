import { useCallback, useState } from 'react';

import { CEDIS } from '../../../config/fleet';

/**
 * A qué punto se está mirando en el mapa.
 *
 * EL `token` NO SOBRA, y es lo único delicado de este hook. Sube en cada
 * petición de centrado aunque las coordenadas sean las mismas, y de eso depende
 * poder **volver a centrar en el MISMO punto**: apretar el botón del CEDIS dos
 * veces, o clic en la misma parada después de haber arrastrado el mapa.
 *
 * Sin el token, el mapa compara coordenadas, ve que no cambiaron y no hace
 * nada — el usuario aprieta y no pasa absolutamente nada, que se lee como un
 * botón descompuesto.
 */
export function useEnfoqueMapa(inicial = CEDIS) {
  const [coords, setCoords] = useState(inicial);
  const [token, setToken] = useState(0);

  const enfocar = useCallback((pos) => {
    // Una parada sin coordenadas mandaría el mapa al golfo de Guinea (0,0).
    if (!pos?.[0] || !pos?.[1]) return;
    setCoords(pos);
    setToken((n) => n + 1);
  }, []);

  return { coords, token, enfocar };
}
