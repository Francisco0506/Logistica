/**
 * El vocabulario de estados, y su CONTRATO con el backend.
 *
 * Las listas de estados estaban copiadas a mano en cinco archivos del frontend
 * y tres del backend, y el mismo bug se arregló dos veces por separado sin que
 * nadie notara las otras copias. Estas pruebas fijan el contrato: si el backend
 * agrega un estado y el frontend no se entera, aquí truena.
 */
import { describe, expect, it } from 'vitest';

import {
  ESTADOS_ENTREGA_FINAL, ESTILO_ENTREGA, esVisitada, huboEntrega, salioMal,
} from './estadosRuta';
import { CONFIG_POR_DEFECTO } from './useConfig';

// Lo que el backend define en models.py. Fixture a propósito: si alguien
// cambia el modelo, esta prueba obliga a actualizar el frontend también.
const DEL_BACKEND = ['Entregado', 'Entregado_Parcial', 'No_Entregado'];

describe('contrato con el backend', () => {
  it('los tres estados finales son exactamente los del modelo', () => {
    expect([...ESTADOS_ENTREGA_FINAL].sort()).toEqual([...DEL_BACKEND].sort());
  });

  it('los defaults de useConfig coinciden con la lista local', () => {
    // Si estos dos se desfasan, durante una caída de red el panel se comporta
    // distinto a como se comporta normalmente, que es lo peor de los dos mundos.
    expect([...CONFIG_POR_DEFECTO.estados_entrega_final].sort())
      .toEqual([...ESTADOS_ENTREGA_FINAL].sort());
  });

  it('cada estado final tiene su estilo: ninguno cae al genérico', () => {
    // El bug: `No_Entregado` no estaba en la tabla de estilos de ventas y caía
    // al `|| ESTILOS.Pendiente`, o sea que se mostraba como "SIN PROGRAMAR" —
    // que significa lo contrario.
    for (const estado of ESTADOS_ENTREGA_FINAL) {
      expect(ESTILO_ENTREGA[estado], `falta el estilo de ${estado}`).toBeTruthy();
      expect(ESTILO_ENTREGA[estado].corto).toBeTruthy();
      expect(ESTILO_ENTREGA[estado].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('esVisitada — el camión ya pasó por esa puerta', () => {
  it.each(DEL_BACKEND)('%s cuenta como visitada', (estado) => {
    expect(esVisitada(estado)).toBe(true);
  });

  it.each(['Pendiente', 'Asignado', 'En_Camino'])('%s NO cuenta como visitada', (estado) => {
    expect(esVisitada(estado)).toBe(false);
  });

  it('con undefined o null no truena', () => {
    // Llega así mientras carga la ruta; si lanzara, se cae la pantalla entera.
    expect(esVisitada(undefined)).toBe(false);
    expect(esVisitada(null)).toBe(false);
  });
});

describe('salioMal — hay algo que atender', () => {
  it('Entregado NO salió mal', () => {
    expect(salioMal('Entregado')).toBe(false);
  });

  it.each(['Entregado_Parcial', 'No_Entregado'])('%s sí salió mal', (estado) => {
    expect(salioMal(estado)).toBe(true);
  });

  it('un pedido que todavía no se reporta no "salió mal"', () => {
    // Es la distinción que le importa a ventas: "falta que llegue" no es lo
    // mismo que "el camión pasó y no se pudo".
    expect(salioMal('En_Camino')).toBe(false);
    expect(salioMal('Pendiente')).toBe(false);
  });
});

describe('huboEntrega — se bajó mercancía del camión', () => {
  it('completo y parcial sí; no entregado no', () => {
    expect(huboEntrega('Entregado')).toBe(true);
    expect(huboEntrega('Entregado_Parcial')).toBe(true);
    expect(huboEntrega('No_Entregado')).toBe(false);
  });

  it('visitada y huboEntrega NO son lo mismo', () => {
    // Es la confusión que causó todo: una parada visitada donde no se entregó
    // nada. Si estas dos funciones dieran lo mismo, sobraría una.
    expect(esVisitada('No_Entregado')).toBe(true);
    expect(huboEntrega('No_Entregado')).toBe(false);
  });
});
