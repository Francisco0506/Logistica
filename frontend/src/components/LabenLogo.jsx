import React from 'react';
import logo from '../assets/laben-logo.png';

/**
 * Logo oficial de Laben Food Service (imagen real, src/assets/laben-logo.png).
 * Única fuente del logo en la app.
 *
 * variant="vertical"  → grande (pantalla de login)
 * variant="horizontal"→ compacto (headers)
 */
export default function LabenLogo({ variant = 'horizontal', className = '' }) {
  return (
    <img
      src={logo}
      alt="Laben Food Service"
      className={`${variant === 'vertical' ? 'w-44' : 'h-11 w-auto'} ${className}`}
    />
  );
}
