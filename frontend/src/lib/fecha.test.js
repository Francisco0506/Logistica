import { afterEach, describe, expect, it, vi } from 'vitest';

import { hoyLocal } from './fecha';

describe('hoyLocal', () => {
  afterEach(() => vi.useRealTimers());

  /**
   * EL BUG QUE ESTA PRUEBA EXISTE PARA CAZAR.
   *
   * `toISOString()` convierte a UTC. México va seis horas atrás, así que a
   * partir de las 6 de la tarde devuelve el día SIGUIENTE. Y la franja
   * peligrosa cae dentro del horario de uso: almacén captura entregas hasta
   * las 7 pm, y el despachador abre el panel por la tarde justamente para
   * adelantar el día siguiente.
   */
  it('a las 11 de la noche del 31 sigue siendo el 31, no el 1', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 31, 23, 0, 0));   // 31-jul-2026, 23:00 local
    expect(hoyLocal()).toBe('2026-07-31');
  });

  it('a las 7 de la tarde tampoco se adelanta', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 2, 19, 0, 0));
    expect(hoyLocal()).toBe('2026-08-02');
  });

  it('rellena mes y día con cero a la izquierda', () => {
    // Sin el padStart sale "2026-8-2", que el backend rechaza al parsear.
    expect(hoyLocal(new Date(2026, 7, 2, 10, 0, 0))).toBe('2026-08-02');
  });

  it('el último día del año no se brinca al siguiente', () => {
    expect(hoyLocal(new Date(2026, 11, 31, 22, 30, 0))).toBe('2026-12-31');
  });
});
