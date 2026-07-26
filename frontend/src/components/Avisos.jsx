import React, { useCallback, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { ContextoAvisos } from './useAviso';

/**
 * Avisos del sistema, en lugar de los cuadros de diálogo del navegador.
 *
 * `alert()` bloquea la pestaña entera hasta que alguien le da Aceptar, se ve
 * distinto en cada navegador y no cabe un mensaje largo. Aquí el aviso aparece
 * en una esquina, se va solo y no detiene lo que se esté haciendo — que importa
 * en un panel que se refresca cada 45 segundos.
 */

const ESTILOS = {
  exito: { icono: CheckCircle2, caja: 'bg-white border-emerald-200', color: 'text-emerald-600' },
  error: { icono: AlertCircle, caja: 'bg-white border-red-200', color: 'text-red-600' },
  info: { icono: Info, caja: 'bg-white border-gray-200', color: 'text-gray-500' },
};

export function ProveedorDeAvisos({ children }) {
  const [avisos, setAvisos] = useState([]);

  const quitar = useCallback((id) => {
    setAvisos((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const avisar = useCallback((texto, tipo = 'info', segundos = 6) => {
    const id = Date.now() + Math.random();
    setAvisos((prev) => [...prev, { id, texto, tipo }]);
    // Los errores duran más: suelen traer una explicación que hay que leer.
    setTimeout(() => quitar(id), (tipo === 'error' ? segundos + 4 : segundos) * 1000);
  }, [quitar]);

  return (
    <ContextoAvisos.Provider value={avisar}>
      {children}

      <div className="fixed bottom-4 right-4 z-[4000] flex flex-col gap-2 max-w-sm print:hidden">
        {avisos.map((a) => {
          const estilo = ESTILOS[a.tipo] || ESTILOS.info;
          const Icono = estilo.icono;
          return (
            <div
              key={a.id}
              className={`${estilo.caja} border rounded-xl shadow-lg px-4 py-3 flex items-start gap-2.5 animate-[fadeIn_.15s_ease-out]`}
            >
              <Icono className={`w-4 h-4 flex-shrink-0 mt-0.5 ${estilo.color}`} />
              <p className="text-[12px] text-gray-700 leading-snug flex-1">{a.texto}</p>
              <button
                onClick={() => quitar(a.id)}
                className="text-gray-300 hover:text-gray-600 transition flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ContextoAvisos.Provider>
  );
}
