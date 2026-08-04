/**
 * Lo que ya se reportó, de solo lectura.
 *
 * Este componente existe por un bug que borraba entregas: la tarjeta de "Ya
 * reportadas" abría la hoja EDITABLE, en blanco, con el botón verde "Entregué
 * todo" abajo. El chofer que entró a revisar qué había hecho salía habiendo
 * convertido un "entregué 1 de 3" en "entregado completo", sin enterarse.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ResumenReportado from './ResumenReportado';

const PARADA = {
  id: 7, doc_num: 250007, card_name: 'ABARROTES DON BETO',
  estado: 'Entregado_Incompleto', secuencia_ruta: 3, entregado_en: '09:41',
  recibio: 'Doña Mari', motivo: 'cliente_rechazo', observaciones: 'No cabía en la cámara',
  lineas: [
    { id: 1, item_code: 'QM-01', descripcion: 'QUESO MOZZARELLA', unidad: 'Pieza', cantidad: 3, cantidad_entregada: 1 },
    { id: 2, item_code: 'MT-01', descripcion: 'MANTEQUILLA', unidad: 'Caja', cantidad: 1, cantidad_entregada: 1 },
  ],
};

function pintar(props = {}) {
  const onCerrar = vi.fn();
  const onCorregir = vi.fn();
  render(
    <ResumenReportado
      parada={PARADA}
      onCerrar={onCerrar}
      onCorregir={onCorregir}
      motivos={[{ id: 'cliente_rechazo', texto: 'El cliente aceptó menos' }]}
      {...props}
    />,
  );
  return { onCerrar, onCorregir };
}

describe('enseña lo que DE VERDAD se reportó', () => {
  it('la cantidad entregada, no la del pedido', () => {
    // El chofer dejó 1 de 3 quesos. La hoja vieja le enseñaba 3 de 3, que es
    // justo lo que lo hacía creer que no había nada que corregir.
    pintar();
    const renglon = screen.getByText('QUESO MOZZARELLA').closest('div.rounded-xl');
    expect(renglon.textContent).toContain('1 / 3');
  });

  it('el motivo, la nota y quién recibió', () => {
    pintar();
    expect(screen.getByText('El cliente aceptó menos')).toBeTruthy();
    expect(screen.getByText('No cabía en la cámara')).toBeTruthy();
    expect(screen.getByText('Doña Mari')).toBeTruthy();
  });

  it('sin dato del backend NO asume que se entregó todo', () => {
    // Una parada vieja puede no traer `cantidad_entregada`. Rellenar el hueco
    // con la cantidad del pedido sería inventarse el dato que sostiene la
    // factura.
    pintar({ parada: { ...PARADA, lineas: [{ ...PARADA.lineas[0], cantidad_entregada: null }] } });
    expect(screen.getByText('sin dato')).toBeTruthy();
  });
});

describe('no se puede sobrescribir de un toque', () => {
  it('no hay ningún botón que confirme una entrega', () => {
    pintar();
    expect(screen.queryByRole('button', { name: /Entregué todo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Confirmar entrega/i })).toBeNull();
  });

  it('corregir pide una confirmación aparte antes de abrir la hoja', () => {
    const { onCorregir } = pintar();
    fireEvent.click(screen.getByRole('button', { name: /Reporté mal/i }));
    expect(onCorregir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Sí, volver a capturarla/i }));
    expect(onCorregir).toHaveBeenCalledTimes(1);
  });

  it('avisa que la hoja va a abrir en blanco, no con lo reportado', () => {
    // Es la verdad y hay que decirla: la hoja de entrega no precarga lo
    // reportado. Callarlo sería repetir el bug con otro disfraz.
    pintar();
    fireEvent.click(screen.getByRole('button', { name: /Reporté mal/i }));
    expect(screen.getByText(/desde cero/i)).toBeTruthy();
  });

  it('con el camión sin salir del CEDIS, corregir ni se ofrece', () => {
    pintar({ onCorregir: undefined });
    expect(screen.queryByRole('button', { name: /Reporté mal/i })).toBeNull();
  });
});
