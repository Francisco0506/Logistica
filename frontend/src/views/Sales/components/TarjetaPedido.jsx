import React, { useState } from 'react';
import { Truck, Clock, MapPin, CheckCircle2, AlertCircle, Package, ChevronDown } from 'lucide-react';
import MiniMapa from '../../../components/MiniMapa';

/**
 * Un pedido como lo ve la vendedora, en un renglón compacto.
 *
 * Antes era una tarjeta alta con mucho aire: cabían cuatro en pantalla y para
 * ver los 80 había que recorrer mucho. Ahora cabe el triple sin perder nada,
 * porque lo que se necesita de un vistazo son cuatro datos —quién, en qué
 * camión, a qué hora llega y si eso cae dentro de su horario— y todo lo demás
 * se abre al hacer clic.
 *
 * La hora va como RANGO ("09:04 – 09:19") y no como hora exacta: una hora al
 * minuto suena a promesa que no se puede cumplir.
 */

const ESTILOS = {
  Entregado: { icono: CheckCircle2, pill: 'bg-emerald-50 text-emerald-700', barra: 'bg-emerald-500', texto: 'Entregado' },
  En_Camino: { icono: Truck,        pill: 'bg-blue-50 text-blue-700',       barra: 'bg-blue-500',    texto: 'En camino' },
  Asignado:  { icono: Package,      pill: 'bg-orange-50 text-orange-700',   barra: 'bg-orange-400',  texto: 'Programado' },
  Pendiente: { icono: AlertCircle,  pill: 'bg-gray-100 text-gray-600',      barra: 'bg-gray-300',    texto: 'Sin programar' },
};

export default function TarjetaPedido({ pedido, camion, color }) {
  const estilo = ESTILOS[pedido.estado] || ESTILOS.Pendiente;
  const Icono = estilo.icono;
  const [abierto, setAbierto] = useState(false);
  const entregado = pedido.estado === 'Entregado';

  return (
    <div className={`rounded-lg border transition ${
      abierto ? 'border-orange-300 shadow-sm' : 'border-gray-200 hover:border-gray-300'
    } bg-white overflow-hidden`}>

      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-stretch text-left"
      >
        {/* Franja de color: el estado se lee de reojo sin buscar la etiqueta */}
        <div
          className={`w-1 flex-shrink-0 ${color ? '' : estilo.barra}`}
          style={color ? { backgroundColor: color } : undefined}
        />

        <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono font-bold text-gray-400">#{pedido.doc_num}</span>
              <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${estilo.pill}`}>
                <Icono className="w-2.5 h-2.5" /> {estilo.texto}
              </span>
              {pedido.camion && (
                <span className="text-[9px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                  {pedido.camion}
                </span>
              )}
            </div>
            <div className={`text-[13px] font-bold truncate mt-0.5 ${entregado ? 'text-gray-500' : 'text-gray-800'}`}>
              {pedido.card_name}
            </div>
            <div className="text-[10px] text-gray-400 truncate">
              {pedido.address || 'Sin dirección'}
              {pedido.ventana && <> · recibe {pedido.ventana}</>}
            </div>
          </div>

          {/* La hora, que es el dato que se pregunta por teléfono */}
          <div className="text-right flex-shrink-0">
            {pedido.eta_desde ? (
              <>
                <div className={`text-[13px] font-extrabold tabular-nums leading-tight ${
                  entregado ? 'text-emerald-600' : 'text-gray-800'
                }`}>
                  {entregado && <span className="text-[9px] uppercase mr-1">Llegó</span>}
                  {pedido.eta_desde}<span className="text-gray-300 font-bold"> – </span>{pedido.eta_hasta}
                </div>
                <div className="text-[10px] text-gray-400">${pedido.doc_total?.toLocaleString('es-MX')}</div>
              </>
            ) : (
              <>
                <div className="text-[11px] font-bold text-gray-300 italic leading-tight">Sin hora</div>
                <div className="text-[10px] text-gray-400">${pedido.doc_total?.toLocaleString('es-MX')}</div>
              </>
            )}
          </div>

          <ChevronDown className={`w-4 h-4 text-gray-300 flex-shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {abierto && (
        <div className="border-t border-gray-100 bg-gray-50/60 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2 text-[11px]">
            <div>
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Qué está pasando</div>
              <p className="text-gray-700 leading-snug mt-0.5">{pedido.situacion}</p>
            </div>

            {/* Cuántas paradas van antes que ésta y cuántas ya se hicieron. Es
                la pregunta de verdad cuando el cliente llama: no "¿a qué hora?"
                sino "¿ya mero?". Se contesta con un hecho —el camión ya hizo 3
                de las 8 que van antes— y no con una hora estimada. */}
            {pedido.paradas_antes != null && !entregado && (
              <div className="bg-white border border-gray-200 rounded-lg px-2.5 py-2">
                {pedido.paradas_antes === 0 ? (
                  <p className="text-[11px] font-bold text-orange-600">
                    Es la PRIMERA parada del {pedido.camion}.
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] text-gray-700">
                      Van <b>{pedido.paradas_antes} paradas</b> antes que ésta.
                      {pedido.entregadas_antes > 0
                        ? <> El camión ya hizo <b className="text-emerald-600">{pedido.entregadas_antes}</b>, faltan <b>{pedido.paradas_antes - pedido.entregadas_antes}</b>.</>
                        : ' Todavía no empieza a entregarlas.'}
                    </p>
                    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden mt-1.5">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${(pedido.entregadas_antes / pedido.paradas_antes) * 100}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="flex items-start gap-1.5 text-gray-600">
              <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-px" />
              <span>{pedido.address || 'Sin dirección en SAP'}</span>
            </div>
            {pedido.ventana && (
              <div className="flex items-start gap-1.5 text-gray-600">
                <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-px" />
                <span>El cliente recibe {pedido.ventana}</span>
              </div>
            )}
            {camion && (
              <div className="flex items-start gap-1.5 text-gray-600">
                <span className="w-2 h-2 rounded-full bg-green-600 flex-shrink-0 mt-1" />
                <span>
                  El camión {camion.placa} {camion.velocidad_kmh > 2 ? 'va circulando' : 'está detenido'}
                  {camion.direccion ? ` por ${camion.direccion}` : ''}.
                </span>
              </div>
            )}
          </div>

          <MiniMapa
            lat={pedido.lat}
            lng={pedido.lng}
            nombre={pedido.card_name}
            camion={camion}
            color={color || undefined}
            alto="h-40"
          />
        </div>
      )}
    </div>
  );
}
