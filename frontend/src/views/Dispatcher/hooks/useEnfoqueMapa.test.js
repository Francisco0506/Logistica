import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useEnfoqueMapa } from './useEnfoqueMapa';

const CEDIS = [25.693, -100.481];
const CLIENTE = [25.67, -100.31];

describe('useEnfoqueMapa', () => {
  it('arranca en el punto que se le da', () => {
    const { result } = renderHook(() => useEnfoqueMapa(CEDIS));
    expect(result.current.coords).toEqual(CEDIS);
  });

  it('enfocar mueve las coordenadas y sube el token', () => {
    const { result } = renderHook(() => useEnfoqueMapa(CEDIS));
    const antes = result.current.token;
    act(() => result.current.enfocar(CLIENTE));
    expect(result.current.coords).toEqual(CLIENTE);
    expect(result.current.token).toBe(antes + 1);
  });

  /**
   * EL BUG QUE ESTA PRUEBA EXISTE PARA CAZAR.
   *
   * Sin el token, el mapa compara coordenadas: si son las mismas no hace nada.
   * Apretar el botón del CEDIS dos veces —o clic en la misma parada después de
   * haber arrastrado el mapa— no producía ningún efecto, y eso se lee como un
   * botón descompuesto.
   */
  it('enfocar DOS VECES el mismo punto sigue subiendo el token', () => {
    const { result } = renderHook(() => useEnfoqueMapa(CEDIS));
    act(() => result.current.enfocar(CLIENTE));
    const primero = result.current.token;
    act(() => result.current.enfocar(CLIENTE));
    expect(result.current.coords).toEqual(CLIENTE);
    expect(result.current.token).toBe(primero + 1);
  });

  it('una parada SIN coordenadas se ignora, no manda el mapa a (0,0)', () => {
    // Hay pedidos sin georreferencia en SAP; sin este guardia, hacer clic en
    // uno mandaba el mapa al golfo de Guinea.
    const { result } = renderHook(() => useEnfoqueMapa(CEDIS));
    const antes = result.current.token;
    act(() => result.current.enfocar([null, null]));
    act(() => result.current.enfocar(undefined));
    act(() => result.current.enfocar([0, 0]));
    expect(result.current.coords).toEqual(CEDIS);
    expect(result.current.token).toBe(antes);
  });
});
