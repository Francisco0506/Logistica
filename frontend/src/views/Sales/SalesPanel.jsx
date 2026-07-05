import React, { useState } from 'react';
import { Search, Package, Clock, Truck, CheckCircle2 } from 'lucide-react';

export default function SalesPanel() {
  const [searchTerm, setSearchTerm] = useState('');

  // Mock data based on the SDD statuses
  const pedidos = [
    { id: '40921', cliente: 'Restaurante El Rey', estado: 'Pendiente', time: '09:00 AM' },
    { id: '40922', cliente: 'Hotel Central', estado: 'Asignado', time: '10:30 AM' },
    { id: '40923', cliente: 'Cafetería La Esquina', estado: 'En_Camino', time: '11:45 AM' },
    { id: '40924', cliente: 'Banquetes VIP', estado: 'Entregado', time: '08:15 AM' },
  ];

  const getStatusIcon = (estado) => {
    switch (estado) {
      case 'Pendiente': return <Package className="w-5 h-5 text-gray-400" />;
      case 'Asignado': return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'En_Camino': return <Truck className="w-5 h-5 text-blue-500" />;
      case 'Entregado': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      default: return <Package className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusText = (estado) => {
    switch (estado) {
      case 'Pendiente': return 'Listo en almacén';
      case 'Asignado': return 'En preparación (Ruta)';
      case 'En_Camino': return 'En camino';
      case 'Entregado': return 'Entregado';
      default: return estado;
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F3ED] text-gray-900 p-4 md:p-8 font-sans">
      <header className="mb-8 max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900">Seguimiento de Pedidos</h1>
        <p className="text-gray-600 mt-1">Panel para Inside Sales y Vendedores</p>
      </header>

      <main className="max-w-5xl mx-auto">
        {/* Buscador */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 flex items-center focus-within:ring-2 focus-within:ring-blue-500 transition-all">
          <Search className="text-gray-400 w-5 h-5 mr-3" />
          <input 
            type="text" 
            placeholder="Buscar por remisión o cliente..." 
            className="w-full text-lg outline-none text-gray-700 bg-transparent"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Lista de Pedidos */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-100">
            {pedidos.map((pedido) => (
              <div key={pedido.id} className="p-4 md:p-6 hover:bg-gray-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-sm font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded-md">#{pedido.id}</span>
                    <span className="text-sm text-gray-500">{pedido.time}</span>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900">{pedido.cliente}</h3>
                </div>
                
                <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-lg border border-gray-100">
                  {getStatusIcon(pedido.estado)}
                  <span className="font-medium text-gray-700">{getStatusText(pedido.estado)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
