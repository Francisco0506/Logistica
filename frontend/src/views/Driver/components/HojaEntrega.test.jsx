/**
 * La hoja con la que el chofer reporta una entrega.
 *
 * Es la única pieza que le dice al sistema qué pasó DE VERDAD. Si aquí se
 * guarda algo que no corresponde, ventas le da información falsa al cliente y
 * facturación cobra lo que no se entregó — y nadie tiene cómo notarlo, porque
 * el sistema se ve igual de tranquilo.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import HojaEntrega from './HojaEntrega';

const PARADA = {
  id: 7, doc_num: 250007, card_name: 'ABARROTES DON BETO',
  address: 'Av. Constitución 100', estado: 'En_Camino', secuencia_ruta: 3,
  lineas: [
    { id: 1, descripcion: 'QUESO MOZZARELLA', unidad: 'Pieza', cantidad: 3 },
    { id: 2, descripcion: 'MANTEQUILLA', unidad: 'Caja', cantidad: 1 },
  ],
};

function pintar(props = {}) {
  const onConfirmar = vi.fn();
  const onCerrar = vi.fn();
  render(
    <HojaEntrega
      parada={PARADA}
      onCerrar={onCerrar}
      onConfirmar={onConfirmar}
      guardando={false}
      puedeEntregar
      {...props}
    />,
  );
  return { onConfirmar, onCerrar };
}

describe('el camino normal: "entregué todo" en un solo toque', () => {
  it('es el 90% de las paradas, así que va sin pasos intermedios', () => {
    const { onConfirmar } = pintar();
    fireEvent.click(screen.getByRole('button', { name: /Entregué todo/i }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });
});

describe('el candado del CEDIS', () => {
  it('con el camión sin salir, el botón de confirmar NI SE DIBUJA', () => {
    // Reportar una entrega antes de que la mercancía suba al camión convierte
    // el dato en algo que no ocurrió — justo lo que esta app viene a evitar.
    // Quitar el botón es mejor que apagarlo: no hay nada que apretar por error.
    pintar({ puedeEntregar: false });
    expect(screen.queryByRole('button', { name: /Entregué todo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Hubo un problema/i })).toBeNull();
  });

  it('lo explica con palabras y dice qué hacer', () => {
    pintar({ puedeEntregar: false });
    expect(screen.getByText(/no ha salido/i)).toBeTruthy();
    expect(screen.getByText(/pide que te den Salida/i)).toBeTruthy();
  });
});

describe('los motivos vienen del backend, no de una copia', () => {
  it('usa el catálogo que le pasan', () => {
    // La lista estaba duplicada, y el desfase era silencioso en las dos
    // direcciones: un motivo nuevo en el modelo nunca le llegaba al chofer, y
    // un id desfasado Django lo guardaba igual (no valida `choices` en save()).
    pintar({
      motivos: [
        { id: 'cerrado', texto: 'El cliente estaba cerrado' },
        { id: 'inundacion', texto: 'La calle estaba inundada' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: /Hubo un problema/i }));
    expect(screen.getByText(/La calle estaba inundada/)).toBeTruthy();
  });

  it('un motivo conocido conserva su texto corto de celular', () => {
    // El backend dice "El cliente estaba cerrado"; en una pantalla angosta y de
    // pie, "Estaba cerrado" se lee mejor.
    pintar({ motivos: [{ id: 'cerrado', texto: 'El cliente estaba cerrado' }] });
    fireEvent.click(screen.getByRole('button', { name: /Hubo un problema/i }));
    expect(screen.getByText('Estaba cerrado')).toBeTruthy();
  });
});
