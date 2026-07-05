import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './views/Login';
import DispatcherPanel from './views/Dispatcher/DispatcherPanel';
import SalesPanel from './views/Sales/SalesPanel';
import DriverApp from './views/Driver/DriverApp';

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dispatcher" element={<DispatcherPanel />} />
        <Route path="/ventas" element={<SalesPanel />} />
        <Route path="/chofer" element={<DriverApp />} />
        {/* Default redirect to login */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
