/**
 * El color de cada camión, que es cómo se distingue una ruta de otra.
 *
 * Las dos funciones de este archivo existen por bugs REALES y medidos, no por
 * gusto. Estas pruebas fijan justamente esas dos mediciones para que nadie las
 * deshaga sin enterarse.
 */
import { describe, expect, it } from 'vitest';

import { colorLibre, textoSobre } from './color';

// Los 11 colores de la flota, tal como los manda `fleet.py`. Se copian aquí a
// propósito —es una fixture, no una fuente de verdad— porque lo que se prueba
// es que el algoritmo aguante ESTOS valores, que son los que hay en la calle.
const FLOTA = [
  '#EA580C', '#0891B2', '#059669', '#D97706', '#7C3AED', '#DC2626',
  '#2563EB', '#0D9488', '#DB2777', '#65A30D', '#4F46E5',
];

describe('textoSobre', () => {
  // El bug: el número de parada iba SIEMPRE en blanco, y medido contra los 11
  // colores de la flota, cinco quedaban por debajo del mínimo legible (4.5:1).
  // El peor era el naranja de Laben, que es el más usado.
  it.each([
    ['#D97706', 'PP4872A'],
    ['#EA580C', 'RA7475A — el naranja de Laben'],
    ['#0891B2', 'RJ57620'],
    ['#0D9488', 'RD9618A'],
    ['#059669', 'RJ97892'],
  ])('sobre %s (%s) devuelve el texto oscuro, no blanco', (color) => {
    expect(textoSobre(color)).toBe('#111827');
  });

  it('sobre un color oscuro sí devuelve blanco', () => {
    expect(textoSobre('#4F46E5')).toBe('#ffffff');
    expect(textoSobre('#DC2626')).toBe('#ffffff');
  });

  it('con basura no truena: devuelve blanco', () => {
    // Se llama con `camion.color`, que puede venir undefined mientras carga la
    // flota. Si esto lanzara, se caería el mapa entero.
    expect(textoSobre(undefined)).toBe('#ffffff');
    expect(textoSobre('rojo')).toBe('#ffffff');
    expect(textoSobre('#FFF')).toBe('#ffffff');
  });
});

describe('colorLibre', () => {
  /**
   * EL BUG QUE ESTA PRUEBA EXISTE PARA CAZAR.
   *
   * Era `PALETA[trucks.length % PALETA.length]` contra una copia de la paleta
   * que vivía en el frontend. Esa copia se quedó en 8 colores mientras
   * `fleet.py` creció a 11, así que con la flota completa `11 % 8 = 3` le daba
   * al primer camión agregado a mano el MISMO color que al RJ97892: dos
   * camiones del mismo color, encimados en el mismo mapa, que es lo único que
   * ese color tiene que evitar.
   */
  it('con TODA la flota en uso no repite ninguno de sus colores', () => {
    const nuevo = colorLibre(FLOTA, FLOTA);
    expect(FLOTA.map((c) => c.toLowerCase())).not.toContain(nuevo.toLowerCase());
  });

  it('agregar varios camiones a mano no repite color entre ellos', () => {
    const enUso = [...FLOTA];
    for (let i = 0; i < 5; i++) enUso.push(colorLibre(enUso, FLOTA));
    const normalizados = enUso.map((c) => c.toLowerCase());
    expect(new Set(normalizados).size).toBe(enUso.length);
  });

  it('si queda un color libre en la paleta, usa ese antes de inventar', () => {
    const enUso = FLOTA.slice(0, 10);          // falta el último
    expect(colorLibre(enUso, FLOTA)).toBe(FLOTA[10]);
  });

  it('ignora huecos en la lista de colores en uso', () => {
    // `trucks.map(t => t.color)` trae undefined mientras la flota carga.
    expect(colorLibre([undefined, null, '#EA580C'], FLOTA)).toBe('#0891B2');
  });

  it('compara sin importar mayúsculas', () => {
    // El backend manda '#EA580C' y algún componente lo pudo pasar en minúscula.
    expect(colorLibre(['#ea580c'], FLOTA)).toBe('#0891B2');
  });
});
