import { useEffect, useRef, useState } from 'react';

import { CEDIS } from '../../../config/fleet';

// La ruta que dibuja el mapa evita autopistas de cuota, mismo criterio que el
// optimizador del backend, para no cruzar casetas ni visual ni realmente.
const OSRM_EXCLUDE = 'motorway';

// Servidor OSRM propio (Docker), igual que OSRM_BASE en el backend.
//
// OJO: que el contenedor esté corriendo NO basta — el backend solo lo usa si
// OSRM_BASE está puesto en su .env; si no, sigue pegándole al público y a su
// límite de 100 paradas. Si los dos no apuntan al mismo servidor, el mapa
// enseña un camino que no es el que se calculó (por eso /api/config devuelve
// contra cuál planeó el backend).
const OSRM_BASE = import.meta.env.VITE_OSRM_BASE || 'http://localhost:5001';

/**
 * El trazo de cada ruta por calles reales, para dibujarlo en el mapa.
 *
 * Es lo ACCESORIO del mapa: sin esto las rutas se ven como líneas rectas entre
 * paradas, feas pero correctas. Por eso puede fallar en silencio.
 *
 * ── CACHÉ POR FIRMA ──
 * Cada camión guarda la geometría junto con la "firma" de sus paradas. Si en el
 * refresco de 45 s las paradas no cambiaron, no se vuelve a pedir nada. Sin
 * esto se harían 11 peticiones a OSRM cada 45 segundos para dibujar exactamente
 * lo mismo.
 *
 * ── CANCELACIÓN Y TOKEN DE CORRIDA ──
 * Era el único efecto de red del panel sin ninguna de las dos, aunque hace
 * hasta 11 peticiones de un jalón y depende de `orders`, que es un arreglo
 * nuevo en cada refresco. Apagar un camión disparaba la corrida A; un segundo
 * después entraba el refresco con la B. Si A contestaba DESPUÉS que B, su
 * resultado pisaba el bueno y el mapa dibujaba **el camino del plan anterior
 * sobre las paradas del plan nuevo**. Y sin cleanup seguía escribiendo estado
 * después de desmontar.
 *
 * @param camionesActivos  los camiones prendidos.
 * @param paradasDe        (placa) => sus paradas en orden.
 * @param habilitado       si no hay plan, no hay nada que trazar.
 */
export function useRutasOsrm(camionesActivos, paradasDe, habilitado) {
  const [rutasOsrm, setRutasOsrm] = useState({});
  const cache = useRef({});
  const corrida = useRef(0);

  // `orders` cambia de identidad en cada refresco aunque su contenido sea el
  // mismo, así que el efecto no puede depender de él: se depende de una FIRMA
  // de las paradas, que solo cambia cuando cambia el plan de verdad.
  const firma = JSON.stringify(
    camionesActivos.map((t) => [t.id, paradasDe(t.id).filter((o) => o.lat && o.lng).map((o) => [o.lat, o.lng])]),
  );

  useEffect(() => {
    if (!habilitado) return;

    const controller = new AbortController();
    const mia = ++corrida.current;
    const vigente = () => mia === corrida.current && !controller.signal.aborted;

    const traerTrazos = async () => {
      const puntosPorCamion = JSON.parse(firma);

      const resultados = await Promise.all(puntosPorCamion.map(async ([id, pts]) => {
        if (!pts.length) return [id, null, null];

        const huella = JSON.stringify(pts);
        if (cache.current[id]?.huella === huella) return [id, cache.current[id].geometria, huella];

        const coords = [CEDIS, ...pts, CEDIS].map((p) => `${p[1]},${p[0]}`).join(';');
        const base = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
        // Se intenta primero evitando autopistas; si el servidor no lo soporta
        // (el público no), se reintenta sin excluir — mejor calles reales que
        // nada.
        for (const url of [`${base}&exclude=${OSRM_EXCLUDE}`, base]) {
          try {
            const data = await (await fetch(url, { signal: controller.signal })).json();
            if (data.routes?.[0]) {
              const geometria = data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
              return [id, geometria, huella];
            }
          } catch (e) {
            if (e.name === 'AbortError') throw e;   // ya no interesa, no seguir
          }
        }
        return [id, null, null];
      }));

      if (!vigente()) return;

      const nuevas = {};
      for (const [id, geometria, huella] of resultados) {
        if (geometria) {
          nuevas[id] = geometria;
          cache.current[id] = { huella, geometria };
        }
      }
      setRutasOsrm(nuevas);
    };

    traerTrazos().catch((e) => { if (e.name !== 'AbortError') console.error('Trazo OSRM:', e); });
    return () => controller.abort();
  }, [firma, habilitado]);

  return rutasOsrm;
}
