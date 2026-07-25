import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './views/Login';
import DispatcherPanel from './views/Dispatcher';
import SalesPanel from './views/Sales';
import DriverApp from './views/Driver';

/**
 * Cada pantalla vive en su propia carpeta bajo `views/`, y la carpeta ES la
 * pantalla: el archivo principal se llama `index.jsx` y sus piezas van en un
 * `components/` adentro. Así se importa la carpeta ('./views/Dispatcher') sin
 * repetir el nombre, y la pantalla no queda como un archivo suelto al lado de
 * su propia carpeta de componentes.
 *
 *   views/Dispatcher/index.jsx        <- la pantalla
 *   views/Dispatcher/components/      <- sus piezas, solo suyas
 *   components/                       <- lo compartido entre pantallas
 */
export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dispatcher" element={<DispatcherPanel />} />
        <Route path="/ventas" element={<SalesPanel />} />
        <Route path="/chofer" element={<DriverApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
