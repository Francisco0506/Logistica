/**
 * CON QUÉ FECHA PIDE SUS RUTAS EL CHOFER.
 *
 * Es la pregunta que ya salió mal DOS VECES, las dos en vivo y las dos
 * dejando al chofer con la pantalla vacía y su ruta a medio hacer:
 *
 *   1. Se pedía con `hoyLocal()` — el día de HOY. Pero las rutas se guardan
 *      bajo la fecha de CAPTURA (lo capturado ayer sale hoy), así que a media
 *      mañana preguntaba por un día que no existe en la base.
 *
 *   2. Se corrigió usando `getJornada()` sin parámetro, que es la que usa el
 *      DESPACHADOR. Esa cambia sola a las 11 de la mañana
 *      (`HORA_CORTE_JORNADA`): pasa a preparar el reparto de MAÑANA, porque lo
 *      de hoy ya está en la calle. Correcto para quien planea; para el chofer
 *      es lo contrario de lo que necesita — a las 11:00 en punto la pantalla
 *      se le brincaba al día siguiente.
 *
 * Lo correcto es preguntar por el REPARTO DE HOY (`?reparto=hoy`), que da la
 * fecha de captura de lo que se está entregando en este momento y no depende
 * de la hora.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRutaChofer } from './useRutaChofer';
import {
  getJornada, getRutas, getRutaChofer, getCamionesGPS, getFlota,
} from '../../../services/api';
import { hoyLocal } from '../../../lib/fecha';

vi.mock('../../../services/api', () => ({
  getJornada: vi.fn(),
  getRutas: vi.fn(),
  getRutaChofer: vi.fn(),
  getCamionesGPS: vi.fn(),
  getFlota: vi.fn(),
}));

// El caso real del 5-ago: lo capturado el 04 es lo que sale el 05.
const FECHA_CAPTURA = '2026-08-04';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getJornada).mockResolvedValue({
    fecha_carga: FECHA_CAPTURA,
    fecha_reparto: hoyLocal(),
  });
  vi.mocked(getRutas).mockResolvedValue([{ camion: 'RA7475A' }]);
  vi.mocked(getRutaChofer).mockResolvedValue({ paradas: [] });
  vi.mocked(getCamionesGPS).mockResolvedValue([]);
  vi.mocked(getFlota).mockResolvedValue([]);
});

describe('con qué fecha pide sus rutas el chofer', () => {
  it('pregunta por el REPARTO DE HOY, no por "qué toca preparar ahora"', async () => {
    renderHook(() => useRutaChofer(''));

    await waitFor(() => expect(getJornada).toHaveBeenCalled());
    // Sin `reparto`, la respuesta cambia sola a las 11 de la mañana y lo manda
    // al día siguiente con su ruta a medio hacer.
    expect(getJornada.mock.calls[0][0]).toMatchObject({ reparto: hoyLocal() });
  });

  it('pide las rutas con la fecha de CAPTURA que le contestó el backend', async () => {
    renderHook(() => useRutaChofer(''));

    await waitFor(() => expect(getRutas).toHaveBeenCalled());
    // No con hoyLocal(): las rutas están guardadas bajo el día en que se
    // capturaron las entregas, no el día en que salen.
    expect(getRutas.mock.calls[0][0]).toBe(FECHA_CAPTURA);
  });

  it('la ruta del camión también va con la fecha de captura', async () => {
    renderHook(() => useRutaChofer('RA7475A'));

    await waitFor(() => expect(getRutaChofer).toHaveBeenCalled());
    const [fecha, camion] = getRutaChofer.mock.calls[0];
    expect(fecha).toBe(FECHA_CAPTURA);
    expect(camion).toBe('RA7475A');
  });

  it('no pregunta nada hasta saber la fecha, para no decir "no hay camiones" de más', async () => {
    // Con la fecha a medias, una respuesta vacía apagaría `buscandoRutas` y la
    // pantalla diría "todavía no hay camiones para hoy" aunque sí los haya.
    let resolver;
    vi.mocked(getJornada).mockReturnValue(new Promise((r) => { resolver = r; }));

    const { result } = renderHook(() => useRutaChofer('RA7475A'));

    expect(getRutas).not.toHaveBeenCalled();
    expect(getRutaChofer).not.toHaveBeenCalled();
    expect(result.current.buscandoRutas).toBe(true);

    resolver({ fecha_carga: FECHA_CAPTURA, fecha_reparto: hoyLocal() });
    await waitFor(() => expect(getRutas).toHaveBeenCalledWith(FECHA_CAPTURA, expect.anything()));
  });
});
