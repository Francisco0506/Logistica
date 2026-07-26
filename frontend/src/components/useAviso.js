import { createContext, useContext } from 'react';

/**
 * Acceso a los avisos del sistema. Va aparte del componente porque mezclar
 * componentes y hooks en el mismo archivo rompe la recarga en caliente de Vite.
 *
 *   const avisar = useAviso();
 *   avisar('El camión ya salió', 'error');
 */
export const ContextoAvisos = createContext(() => {});

export const useAviso = () => useContext(ContextoAvisos);
