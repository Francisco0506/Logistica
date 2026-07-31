import React from 'react';
import { X, Printer } from 'lucide-react';
import LabenLogo from '../../../components/LabenLogo';

/**
 * Vista previa de la guía de carga, tal como saldría impresa.
 *
 * Es la hoja que se lleva el almacén para cargar y el chofer para entregar, así
 * que va en blanco y negro, con letra grande y sin adornos: se lee en un
 * almacén, de pie, con la hoja en la mano.
 *
 * El orden es LIFO (lo primero que se sube es lo último que se entrega), que es
 * el orden en que el de almacén tiene que meter la mercancía. La columna de
 * "entrega" trae el número de parada real, para que el chofer sepa cuál es cuál.
 */
export default function PreviewManifiesto({ camion, paradas, fecha, onCerrar }) {
  if (!camion) return null;

  const ordenDeCarga = [...paradas].reverse();
  const conPeso = paradas.filter((o) => o.peso_kg != null);
  const pesoTotal = conPeso.reduce((s, o) => s + o.peso_kg, 0);
  const faltanPesos = paradas.length - conPeso.length;

  return (
    // `marco-impresion` en los dos contenedores: al imprimir dejan de flotar y
    // de recortar, o la hoja saldría cortada en la primera página (ver index.css).
    <div className="marco-impresion fixed inset-0 z-[3000] bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="marco-impresion bg-white rounded-xl shadow-2xl w-full max-w-3xl my-6">

        {/* Barra de acciones — no se imprime */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-200 print:hidden">
          <h3 className="text-sm font-bold text-gray-800">
            Vista previa de la guía · {camion.id}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs px-3 py-2 rounded-lg transition"
            >
              <Printer className="w-3.5 h-3.5" /> Imprimir
            </button>
            <button
              onClick={onCerrar}
              className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── La hoja ── (`hoja-imprimible`: al imprimir solo sale esto, ver index.css) */}
        <div className="hoja-imprimible p-8 text-black">
          <div className="flex items-start justify-between border-b-2 border-black pb-3 mb-5">
            <div className="flex items-start gap-4">
              <LabenLogo variant="horizontal" />
              <div>
                <h1 className="text-xl font-extrabold tracking-tight">GUÍA DE CARGA</h1>
                <p className="text-xs text-gray-600 mt-0.5">CEDIS Santa Catarina</p>
              </div>
            </div>
            <div className="text-right text-xs">
              <div className="font-bold text-base">{camion.id}</div>
              <div className="text-gray-600">{camion.modelo}{camion.samsara ? ` · Samsara ${camion.samsara}` : ''}</div>
              <div className="text-gray-600">{fecha}</div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-5 text-xs">
            {[
              ['Paradas', paradas.length],
              ['Capacidad', camion.capacidadKg ? `${camion.capacidadKg.toLocaleString()} kg` : '—'],
              ['Peso cargado', conPeso.length ? `${pesoTotal.toLocaleString('es-MX', { maximumFractionDigits: 0 })} kg` : 'Sin dato'],
              ['Chofer', camion.driver || '________________'],
            ].map(([etiqueta, valor]) => (
              <div key={etiqueta}>
                <div className="text-[9px] font-bold uppercase text-gray-500 tracking-wide">{etiqueta}</div>
                <div className="font-bold text-sm">{valor}</div>
              </div>
            ))}
          </div>

          {faltanPesos > 0 && (
            <p className="text-[10px] border border-black px-2 py-1 mb-4">
              {faltanPesos === paradas.length
                ? 'SAP no manda el peso de estos pedidos: el peso cargado no se conoce.'
                : `Faltan los pesos de ${faltanPesos} de ${paradas.length} pedidos: el total real es mayor.`}
            </p>
          )}

          <p className="text-[10px] font-bold uppercase tracking-wide mb-2">
            Orden de carga — lo primero que se sube es lo último que se entrega
          </p>

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-y-2 border-black">
                <th className="text-left py-1.5 pr-2 w-10">Sube</th>
                <th className="text-left py-1.5 pr-2 w-14">Entrega</th>
                <th className="text-left py-1.5 pr-2">Cliente</th>
                <th className="text-left py-1.5 pr-2 w-24">Recibe</th>
                <th className="text-left py-1.5 pr-2 w-16">Llega</th>
                <th className="text-right py-1.5 w-16">Kg</th>
              </tr>
            </thead>
            <tbody>
              {ordenDeCarga.map((o, i) => (
                <tr key={o.id} className="border-b border-gray-300 align-top">
                  <td className="py-2 pr-2 font-bold">{i + 1}</td>
                  <td className="py-2 pr-2 font-bold">{paradas.length - i}</td>
                  <td className="py-2 pr-2">
                    <div className="font-semibold">{o.card_name}</div>
                    <div className="text-[10px] text-gray-600">#{o.doc_num}{o.address ? ` · ${o.address}` : ''}</div>
                  </td>
                  <td className="py-2 pr-2 text-[10px]">{o.ventana || '—'}</td>
                  <td className="py-2 pr-2">{o.eta_desde ? `${o.eta_desde}-${o.eta_hasta}` : '—'}</td>
                  <td className="py-2 text-right">{o.peso_kg != null ? o.peso_kg : '—'}</td>
                </tr>
              ))}
              {!ordenDeCarga.length && (
                <tr><td colSpan="6" className="py-6 text-center text-gray-500">Este camión no tiene pedidos asignados.</td></tr>
              )}
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-10 mt-10 text-xs">
            <div>
              <div className="border-t border-black pt-1">Cargó (almacén)</div>
            </div>
            <div>
              <div className="border-t border-black pt-1">Recibió (chofer)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
