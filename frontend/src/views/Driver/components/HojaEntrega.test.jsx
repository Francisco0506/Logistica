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

describe('los renglones vendidos por kilo, que traen decimales', () => {
  // Un renglón real del 6-ago-2026: 18.1 KILOGRAMO de queso quesadilla.
  const PARADA_KG = {
    ...PARADA,
    lineas: [{ id: 1, descripcion: 'QUESO QUESADILLA 30 / 50 GR PV', unidad: 'Kilogramo', cantidad: 18.1 }],
  };

  const abrirParcial = () => {
    pintar({ parada: PARADA_KG });
    fireEvent.click(screen.getByRole('button', { name: /Hubo un problema/i }));
    return {
      menos: screen.getByRole('button', { name: /Quitar uno/i }),
      mas: screen.getByRole('button', { name: /Agregar uno/i }),
      recuadro: screen.getByRole('textbox', { name: /Cantidad entregada/i }),
    };
  };

  it('no le enseña al chofer la basura decimal del punto flotante', () => {
    // 18.1 - 1 - 1 ... en punto flotante da 4.100000000000001, y eso es lo que
    // le aparecía en la pantalla al chofer, de pie en la puerta del cliente.
    const { menos, recuadro } = abrirParcial();
    for (let i = 0; i < 14; i++) fireEvent.click(menos);

    expect(recuadro.value).toBe('4.1');
  });

  it('el chofer puede TECLEAR la cantidad, no picar 18 veces el menos', () => {
    // Un renglón por kilo trae 18.1: bajarlo a 12 a punta de botón son 6 toques
    // con una mano, de pie en la banqueta; dejarlo en 0 son 18.
    const { recuadro } = abrirParcial();
    fireEvent.change(recuadro, { target: { value: '12' } });

    expect(recuadro.value).toBe('12');
    // Y el pedido queda marcado como incompleto, que es lo que ventas necesita.
    expect(screen.getByText(/entregado incompleto/i)).toBeTruthy();
  });

  it('no deja teclear MÁS de lo que traía el camión', () => {
    // Reportar que se dejaron 25 kg de un renglón de 18.1 es inventar mercancía
    // que nunca subió al camión.
    const { recuadro } = abrirParcial();
    fireEvent.change(recuadro, { target: { value: '25' } });
    fireEvent.blur(recuadro);

    expect(recuadro.value).toBe('18.1');
  });

  it('deja escribir un decimal a medias sin borrárselo', () => {
    // Tecleando "0.5", al llegar al punto el valor es "0." — si eso se
    // normalizara a número en cada tecla, el punto desaparecería y sería
    // imposible escribir decimales.
    const { recuadro } = abrirParcial();
    fireEvent.change(recuadro, { target: { value: '0.' } });
    expect(recuadro.value).toBe('0.');

    fireEvent.change(recuadro, { target: { value: '0.5' } });
    expect(recuadro.value).toBe('0.5');
  });

  it('subir de vuelta hasta el tope sigue contando como entrega COMPLETA', () => {
    // Guarda, no regresión: hoy `Math.min` topa el valor en `linea.cantidad` y
    // por eso una ida y vuelta nunca queda por debajo del total (comprobado
    // sobre ~5,900 cantidades con decimales). Si alguien cambia ese tope, esto
    // truena antes de que una entrega completa se le reporte a ventas como
    // faltante.
    const { menos, mas } = abrirParcial();
    fireEvent.click(menos);
    fireEvent.click(mas);

    expect(screen.getByText(/entregado completo/i)).toBeTruthy();
  });
});
