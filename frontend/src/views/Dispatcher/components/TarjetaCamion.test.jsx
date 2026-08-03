/**
 * La tarjeta del camión en el panel del despachador.
 *
 * Existe por un bug con CUATRO síntomas a la vez, todos causados por medir el
 * avance con `estado === 'Entregado'` cuando el modelo tiene TRES estados
 * finales. Un camión que cerró su día con dos clientes cerrados:
 *
 *   · se quedaba en "8/10" para siempre,
 *   · "Sigue:" apuntaba a un cliente que el chofer YA reportó,
 *   · el peso a bordo nunca bajaba de esas paradas —el panel creía que el
 *     camión traía encima mercancía que ya regresó al CEDIS—,
 *   · y las entregas fallidas no aparecían por ningún lado, aunque el dato
 *     estuviera en la base.
 *
 * Cada prueba de aquí cubre uno de los cuatro.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TarjetaCamion from './TarjetaCamion';

const CAMION = {
  id: 'RA7475A', color: '#EA580C', active: true,
  modelo: 'ELF 600', capacidadKg: 6000, maxParadas: 29, driver: '',
};

const parada = (id, estado, extra = {}) => ({
  id, doc_num: 250000 + id, card_name: `CLIENTE ${id}`,
  estado, peso_kg: 100, secuencia_ruta: id,
  lat: 25.6, lng: -100.3, ...extra,
});

function pintar(paradas, props = {}) {
  return render(
    <TarjetaCamion
      camion={CAMION}
      ruta={{ id: 1, estado: 'En_Ruta', hora_salida: null }}
      paradas={paradas}
      abierto={false}
      cambiandoEstado={false}
      onAbrir={vi.fn()}
      onToggleActivo={vi.fn()}
      onCambiarChofer={vi.fn()}
      onCambiarEstado={vi.fn()}
      onEnfocar={vi.fn()}
      {...props}
    />,
  );
}

describe('avance de la ruta', () => {
  it('una parada NO ENTREGADA cuenta como visitada: 3/3, no 2/3', () => {
    // El camión pasó por las tres puertas. Que en una no se pudiera dejar la
    // mercancía no significa que le falte ir: no va a volver.
    pintar([
      parada(1, 'Entregado'),
      parada(2, 'Entregado'),
      parada(3, 'No_Entregado'),
    ]);
    expect(screen.getByText('3/3')).toBeTruthy();
  });

  it('una entrega INCOMPLETA también cuenta como visitada', () => {
    pintar([parada(1, 'Entregado'), parada(2, 'Entregado_Parcial')]);
    expect(screen.getByText('2/2')).toBeTruthy();
  });

  it('las que salieron mal se cuentan APARTE, no se esconden', () => {
    // Sin este número el despachador no tenía por dónde enterarse de que hubo
    // un problema, aunque el dato ya estuviera en la base.
    pintar([
      parada(1, 'Entregado'),
      parada(2, 'No_Entregado'),
      parada(3, 'Entregado_Parcial'),
    ]);
    expect(screen.getByText(/2 con problema/i)).toBeTruthy();
  });

  it('las pendientes de verdad sí quedan fuera del avance', () => {
    pintar([parada(1, 'Entregado'), parada(2, 'No_Entregado'), parada(3, 'En_Camino')]);
    expect(screen.getByText('2/3')).toBeTruthy();
  });
});

describe('"Sigue:" — la próxima parada', () => {
  it('NO apunta a un cliente que el chofer ya reportó como no entregado', () => {
    // Este era el síntoma más visible: el panel mandaba al despachador a
    // preguntar por un cliente al que el camión ya no va a volver.
    pintar([
      parada(1, 'Entregado'),
      parada(2, 'No_Entregado'),
      parada(3, 'En_Camino'),
    ]);
    const sigue = screen.getByText(/Sigue:/i).parentElement;
    expect(within(sigue).queryByText(/CLIENTE 2/)).toBeNull();
    expect(within(sigue).getByText(/CLIENTE 3/)).toBeTruthy();
  });

  it('cuando ya se visitaron todas no hay siguiente, y NO dice "todo entregado"', () => {
    // Con una parada fallida el camión terminó, pero no entregó todo. Decir
    // "Todo entregado" ahí sería la misma mentira, solo que en otro renglón.
    pintar([parada(1, 'Entregado'), parada(2, 'No_Entregado')]);
    expect(screen.queryByText(/Sigue:/i)).toBeNull();
    expect(screen.getByText(/1 de 2 entregadas/i)).toBeTruthy();
  });

  it('si TODAS se entregaron bien, entonces sí dice "todo entregado"', () => {
    pintar([parada(1, 'Entregado'), parada(2, 'Entregado')]);
    expect(screen.getByText(/Todo entregado/i)).toBeTruthy();
  });
});

describe('peso a bordo', () => {
  it('baja también con las paradas que salieron mal', () => {
    // El camión ya no trae esa mercancía encima: o se dejó, o regresó al
    // CEDIS. En ningún caso sigue "a bordo" en la calle.
    pintar([
      parada(1, 'Entregado', { peso_kg: 1000 }),
      parada(2, 'No_Entregado', { peso_kg: 1000 }),
      parada(3, 'En_Camino', { peso_kg: 500 }),
    ]);
    // Solo quedan los 500 kg de la parada que falta.
    expect(screen.getByText(/500 kg/)).toBeTruthy();
  });
});

describe('el turno con el que se corrió el plan', () => {
  // Con el 6 clavado, optimizar con turno de 8 h pintaba TODAS las tarjetas de
  // ámbar avisando de un problema inexistente — y una advertencia siempre
  // prendida es una que nadie vuelve a mirar.
  const rutaLarga = [
    parada(1, 'En_Camino', { eta: '09:00' }),
    parada(2, 'En_Camino', { eta: '16:00' }),   // 7 h de ruta
  ];

  it('con turno de 6 h, una ruta de 7 h se marca en ámbar', () => {
    const { container } = pintar(rutaLarga, { horasTurno: 6 });
    expect(container.querySelector('.text-amber-600')).toBeTruthy();
  });

  it('con turno de 8 h, esa MISMA ruta ya no se marca', () => {
    const { container } = pintar(rutaLarga, { horasTurno: 8 });
    expect(container.querySelector('.text-amber-600')).toBeNull();
  });
});
