/**
 * El avance de despacho: Borrador → Cargando → Listo → En ruta → Finalizada.
 *
 * Este componente tenía su PROPIA copia de la máquina de estados, con un
 * comentario que decía "coincide con TRANSICIONES_VALIDAS del backend".
 * Coincidía HOY. En cuanto se desfasara, el botón mandaría una transición que
 * el backend rechaza —y la rechaza con HTTP 200 y `status: 'error'`, así que
 * en pantalla se ve como un botón que simplemente no hace nada.
 *
 * Ahora las transiciones llegan de /api/config y estas pruebas fijan que el
 * componente las OBEDECE en vez de tener las suyas.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EstadoDespacho from './EstadoDespacho';
import { CONFIG_POR_DEFECTO } from '../../../config/useConfig';

const TRANSICIONES = CONFIG_POR_DEFECTO.transiciones;

function pintar(estado, props = {}) {
  const onCambiarEstado = vi.fn();
  render(
    <EstadoDespacho
      ruta={{ id: 1, estado, hora_salida: null }}
      onCambiarEstado={onCambiarEstado}
      cambiando={false}
      transiciones={TRANSICIONES}
      {...props}
    />,
  );
  return { onCambiarEstado };
}

describe('la acción que sigue sale del backend', () => {
  it.each([
    ['Borrador', 'Cargando', 'Empezar a cargar'],
    ['Cargando', 'Listo', 'Marcar como listo'],
    ['Listo', 'En_Ruta', 'Dar salida'],
    ['En_Ruta', 'Finalizada', 'Cerrar la ruta'],
  ])('desde %s el botón manda a %s', (desde, hacia, texto) => {
    const { onCambiarEstado } = pintar(desde);
    fireEvent.click(screen.getByRole('button', { name: texto }));
    expect(onCambiarEstado).toHaveBeenCalledWith(hacia);
  });

  it('en Finalizada no hay más pasos', () => {
    pintar('Finalizada');
    expect(screen.getByText(/Ruta terminada/i)).toBeTruthy();
  });

  it('NO se puede saltar pasos: desde Borrador nunca ofrece "Dar salida"', () => {
    // Saltarse el despacho dejaría un camión "En ruta" sin haber cargado, y la
    // hora de salida se usa para recalcular todas las ETAs.
    pintar('Borrador');
    expect(screen.queryByRole('button', { name: 'Dar salida' })).toBeNull();
  });
});

describe('si el backend cambia, el componente se adapta', () => {
  it('un estado nuevo saca su botón aunque no tenga texto propio', () => {
    // La prueba de que ya no hay una copia local: con las transiciones viejas
    // clavadas, esto no mostraría ningún botón.
    const { onCambiarEstado } = pintar('Borrador', {
      transiciones: { Borrador: ['Revision'] },
    });
    const boton = screen.getByRole('button', { name: /Revision/i });
    fireEvent.click(boton);
    expect(onCambiarEstado).toHaveBeenCalledWith('Revision');
  });

  it('si el backend cierra un estado, desaparece el botón', () => {
    pintar('Borrador', { transiciones: { Borrador: [] } });
    expect(screen.getByText(/Ruta terminada/i)).toBeTruthy();
  });

  it('sin transiciones no truena: no ofrece nada', () => {
    // Pasa si /api/config falla y el padre no pasó nada.
    pintar('Borrador', { transiciones: undefined });
    expect(screen.getByText(/Ruta terminada/i)).toBeTruthy();
  });
});

describe('la hora de salida real', () => {
  it('se muestra cuando el camión ya salió', () => {
    render(
      <EstadoDespacho
        ruta={{ id: 1, estado: 'En_Ruta', hora_salida: '07:42' }}
        onCambiarEstado={vi.fn()}
        cambiando={false}
        transiciones={TRANSICIONES}
      />,
    );
    expect(screen.getByText(/Salió a las 07:42/)).toBeTruthy();
  });
});
