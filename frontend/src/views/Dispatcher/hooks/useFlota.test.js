/**
 * La flota del panel: qué camiones hay, cuáles se pueden apagar y cómo se
 * agrega uno a mano.
 *
 * Dos reglas de negocio viven aquí y las dos existen por un bug real:
 * no apagar un camión que ya salió, y no dejar dos veces la misma placa.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFlota } from './useFlota';
import { getFlota } from '../../../services/api';

vi.mock('../../../services/api', () => ({ getFlota: vi.fn() }));

const FLOTA = [
  { placa: 'RA7475A', samsara: '027', modelo: 'ELF 600', capacidad_kg: 6000, max_paradas: 29, color: '#EA580C', activo_default: true },
  { placa: 'RJ57620', samsara: '015', modelo: 'ELF 400', capacidad_kg: 3500, max_paradas: 25, color: '#0891B2', activo_default: true },
  { placa: 'PP4872A', samsara: '024', modelo: 'ELF 400', capacidad_kg: 3500, max_paradas: 25, color: '#D97706', activo_default: false },
];

async function montar({ rutaDe = () => undefined, avisar = vi.fn() } = {}) {
  const hook = renderHook(() => useFlota(rutaDe, avisar));
  await waitFor(() => expect(hook.result.current.flotaCargada).toBe(true));
  return { ...hook, avisar };
}

beforeEach(() => {
  vi.mocked(getFlota).mockResolvedValue(FLOTA);
});

describe('carga', () => {
  it('trae la flota del backend y respeta cuáles arrancan prendidos', async () => {
    const { result } = await montar();
    expect(result.current.trucks).toHaveLength(3);
    // El PP4872A viene con activo_default: false — no sale casi nunca.
    expect(result.current.camionesActivos.map((t) => t.id)).toEqual(['RA7475A', 'RJ57620']);
  });

  it('el chofer arranca VACÍO, no inventado', async () => {
    // Antes se mostraba "Chofer 1": quién maneja cada unidad no es un dato que
    // el sistema tenga todavía.
    const { result } = await montar();
    expect(result.current.trucks.every((t) => t.driver === '')).toBe(true);
  });

  it('si la flota no carga, no truena y lo deja saber', async () => {
    vi.mocked(getFlota).mockRejectedValue(new Error('sin red'));
    const { result } = renderHook(() => useFlota(() => undefined, vi.fn()));
    await waitFor(() => expect(result.current.trucks).toEqual([]));
    // `flotaCargada` se queda en false: el panel distingue "cargando" de
    // "no hay camiones", que son cosas distintas para el despachador.
    expect(result.current.flotaCargada).toBe(false);
  });
});

describe('no se puede apagar un camión que YA SALIÓ', () => {
  // Apagarlo quitaría sus entregas de la vista mientras el chofer las sigue
  // haciendo: el despachador dejaría de ver pedidos que están ocurriendo.
  it.each(['Cargando', 'Listo', 'En_Ruta'])('con la ruta en %s, avisa y no lo apaga', async (estado) => {
    const { result, avisar } = await montar({ rutaDe: () => ({ estado }) });
    act(() => result.current.toggleTruck('RA7475A'));
    expect(result.current.trucks.find((t) => t.id === 'RA7475A').active).toBe(true);
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining('ya está despachado'), 'error');
  });

  it('una ruta FINALIZADA sí se puede apagar: ya no hay nada que perder de vista', async () => {
    const { result } = await montar({ rutaDe: () => ({ estado: 'Finalizada' }) });
    act(() => result.current.toggleTruck('RA7475A'));
    expect(result.current.trucks.find((t) => t.id === 'RA7475A').active).toBe(false);
  });

  it('en Borrador se apaga sin problema', async () => {
    const { result } = await montar({ rutaDe: () => ({ estado: 'Borrador' }) });
    act(() => result.current.toggleTruck('RA7475A'));
    expect(result.current.trucks.find((t) => t.id === 'RA7475A').active).toBe(false);
  });

  it('PRENDER uno despachado no se bloquea: el candado es solo para apagar', async () => {
    const { result } = await montar({ rutaDe: () => ({ estado: 'En_Ruta' }) });
    act(() => result.current.toggleTruck('PP4872A'));   // venía apagado
    expect(result.current.trucks.find((t) => t.id === 'PP4872A').active).toBe(true);
  });
});

describe('agregar un camión a mano', () => {
  it('una placa REPETIDA no se agrega y lo dice', async () => {
    // Sin esto quedaban dos entradas con el mismo id: dos tarjetas con la misma
    // llave de React, apagar una movía las DOS, y el conteo mentía.
    const { result, avisar } = await montar();
    let ok;
    act(() => { ok = result.current.agregarCamion('RA7475A'); });
    expect(ok).toBe(false);
    expect(result.current.trucks).toHaveLength(3);
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining('ya existe'), 'error');
  });

  it('la compara sin espacios y sin importar mayúsculas', async () => {
    // Las placas se teclean a mano: "ra7475a " y "RA7475A" son la misma unidad.
    const { result } = await montar();
    let ok;
    act(() => { ok = result.current.agregarCamion('  ra7475a '); });
    expect(ok).toBe(false);
  });

  it('avisa si la placa repetida está APAGADA, que si no parece que no existe', async () => {
    const { result, avisar } = await montar();
    act(() => result.current.agregarCamion('PP4872A'));
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining('está apagada'), 'error');
  });

  it('una placa nueva se agrega, normalizada y prendida', async () => {
    const { result } = await montar();
    let ok;
    act(() => { ok = result.current.agregarCamion(' xy1234a ', ' Beto '); });
    expect(ok).toBe(true);
    const nuevo = result.current.trucks.at(-1);
    expect(nuevo.id).toBe('XY1234A');
    expect(nuevo.driver).toBe('Beto');
    expect(nuevo.active).toBe(true);
  });

  it('el camión nuevo NO recibe un color que ya esté en uso', async () => {
    // El bug: `PALETA[trucks.length % 8]` contra una copia local de 8 colores
    // mientras la flota creció a 11 — el camión nuevo nacía con el color de
    // otro, encimados en el mismo mapa.
    const { result } = await montar();
    act(() => result.current.agregarCamion('XY1234A'));
    const colores = result.current.trucks.map((t) => t.color.toLowerCase());
    expect(new Set(colores).size).toBe(colores.length);
  });

  it('una placa vacía no hace nada', async () => {
    const { result } = await montar();
    let ok;
    act(() => { ok = result.current.agregarCamion('   '); });
    expect(ok).toBe(false);
    expect(result.current.trucks).toHaveLength(3);
  });
});
