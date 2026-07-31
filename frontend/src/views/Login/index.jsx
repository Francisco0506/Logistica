import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Shield, Layout, Lock, User } from 'lucide-react';
import LabenLogo from '../../components/LabenLogo';

export default function Login() {
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState('dispatcher');
  const [username, setUsername] = useState('norberto');
  const [password, setPassword] = useState('12345');

  const handleLogin = (e) => {
    e.preventDefault();
    if (selectedRole === 'dispatcher') {
      navigate('/dispatcher');
    } else if (selectedRole === 'sales') {
      navigate('/ventas');
    } else if (selectedRole === 'driver') {
      navigate('/chofer');
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 relative overflow-hidden p-6">
      
      {/* Se quitaron dos círculos difuminados de fondo: eran el único adorno
          de ese tipo en toda la app y hacían que el login pareciera de otro
          sistema. El resto de las pantallas son fondo plano. */}

      <div className="w-full max-w-lg bg-white rounded-2xl border border-gray-200 shadow-lg p-8 md:p-10 space-y-8">
        
        {/* Logo oficial Laben Food Service */}
        <div className="flex flex-col items-center text-center space-y-3">
          <LabenLogo variant="vertical" />
          <p className="text-[10px] text-gray-400 font-bold tracking-widest uppercase">Ruteo Inteligente</p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleLogin} className="space-y-6">
          
          {/* Tarjetas de Selección de Rol */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Selecciona tu Rol</label>
            <div className="grid grid-cols-3 gap-3">
              
              <button
                type="button"
                onClick={() => { setSelectedRole('dispatcher'); setUsername('norberto'); }}
                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                  selectedRole === 'dispatcher'
                    ? 'border-orange-600 bg-orange-50/50 text-orange-700'
                    : 'border-gray-100 bg-gray-50/50 hover:bg-gray-50 text-gray-500 hover:text-gray-800'
                }`}
              >
                <Shield className="h-6 w-6 mb-2" />
                <span className="text-xs font-extrabold tracking-tight">Dispatcher</span>
              </button>

              <button
                type="button"
                onClick={() => { setSelectedRole('sales'); setUsername('ventas_user'); }}
                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                  selectedRole === 'sales'
                    ? 'border-orange-600 bg-orange-50/50 text-orange-700'
                    : 'border-gray-100 bg-gray-50/50 hover:bg-gray-50 text-gray-500 hover:text-gray-800'
                }`}
              >
                <Layout className="h-6 w-6 mb-2" />
                <span className="text-xs font-extrabold tracking-tight">Ventas</span>
              </button>

              <button
                type="button"
                onClick={() => { setSelectedRole('driver'); setUsername('chofer_beto'); }}
                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                  selectedRole === 'driver'
                    ? 'border-orange-600 bg-orange-50/50 text-orange-700'
                    : 'border-gray-100 bg-gray-50/50 hover:bg-gray-50 text-gray-500 hover:text-gray-800'
                }`}
              >
                <Truck className="h-6 w-6 mb-2" />
                <span className="text-xs font-extrabold tracking-tight">Chofer</span>
              </button>

            </div>
          </div>

          {/* Inputs */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Usuario</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                  <User className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-gray-800 font-medium text-sm transition-all"
                  placeholder="ej. norberto"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Contraseña</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-gray-800 font-medium text-sm transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>
          </div>

          {/* Botón de Entrada */}
          <button
            type="submit"
            className="w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-extrabold py-3.5 px-6 rounded-xl shadow-sm transition text-[15px] tracking-wide"
          >
            Ingresar al Sistema
          </button>
        </form>
      </div>
    </div>
  );
}
