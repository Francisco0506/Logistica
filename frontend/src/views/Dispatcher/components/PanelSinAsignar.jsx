import React from 'react';
import { Truck, AlertCircle, ChevronDown, ChevronUp, Clock, Loader, RefreshCw, ShieldCheck } from 'lucide-react';

/**
 * Los pedidos que no quedaron en ninguna ruta, con la sugerencia de a qué
 * camión conviene mandarlos.
 *
 * El backend evalúa TODAS las posiciones de cada ruta y prefiere una donde el
 * camión llegue dentro de la ventana de recibo del cliente; si no existe, dice
 * de qué lado se pasa y por cuánto (llegar antes de que abran se arregla
 * esperando, llegar después de que cierren no se arregla).
 */
export default function PanelSinAsignar({
  alertas,
  alertaAbierta,
  sugerencias,
  cargandoSugerencias,
  asignando,
  onAbrirAlerta,
  onAsignar,
  onActivarCamion,
  onReoptimizar,
  onAmpliarTurno,
  horasTurno,
  optimizando,
  etiquetaCamion,
}) {
  const haySinAsignar = alertas.some((a) => a.motivo.startsWith('Pendiente'));
  // Siguiente escalón de turno disponible, o null si ya va en el más largo.
  const TURNOS = [6, 6.5, 7, 7.5, 8];
  const siguienteTurno = TURNOS.find((h) => h > horasTurno) ?? null;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-red-50/20">
      {alertas.length === 0 && (
        <p className="text-xs text-gray-400 italic">Sin alertas pendientes.</p>
      )}

      {haySinAsignar && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-3 py-2.5 border-b border-gray-100">
            <p className="text-[12px] font-bold text-gray-800">
              {alertas.length} pedido{alertas.length === 1 ? '' : 's'} sin lugar en ninguna ruta
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">Estas son las salidas, de la más rápida a la más lenta:</p>
          </div>

          <div className="p-3 space-y-2">
            {/* Mismo estilo que el resto del panel: naranja de Laben para la
                acción principal, neutras para las demás, con el icono en línea
                y no apiladas. */}
            <button
              onClick={onReoptimizar}
              disabled={optimizando}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-xs py-2.5 rounded-lg shadow-sm transition"
            >
              <RefreshCw className={`w-4 h-4 ${optimizando ? 'animate-spin' : ''}`} />
              {optimizando ? 'Optimizando…' : 'Volver a optimizar'}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onActivarCamion}
                className="flex items-center justify-center gap-1.5 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-gray-600 font-semibold text-[11px] py-2 rounded-lg transition"
              >
                <Truck className="w-3.5 h-3.5" /> Activar un camión
              </button>
              {/* Tercera salida: darle más turno a los choferes. Se ofrece el
                  siguiente escalón, no una lista, para que sea un solo clic. */}
              <button
                onClick={onAmpliarTurno}
                disabled={!siguienteTurno}
                title={siguienteTurno
                  ? `Pasar el turno de ${horasTurno} h a ${siguienteTurno} h y volver a optimizar`
                  : 'Ya está en el turno más largo'}
                className="flex items-center justify-center gap-1.5 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-40 text-gray-600 font-semibold text-[11px] py-2 rounded-lg transition"
              >
                <Clock className="w-3.5 h-3.5" />
                {siguienteTurno ? `Turno a ${siguienteTurno} h` : 'Turno al máximo'}
              </button>
            </div>

            {/* Lo que más preocupa al re-optimizar es perder lo que ya se
                despachó. No pasa, y hay que decirlo donde se toma la decisión. */}
            <p className="text-[10px] text-gray-500 flex items-start gap-1.5 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-px" />
              <span>
                Re-optimizar <b>no toca las rutas que ya salieron</b> ni las que están cargando:
                solo reacomoda las que siguen en borrador.
              </span>
            </p>

            <p className="text-[10px] text-gray-500 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-px" />
              <span>O <b>asígnalos a mano</b> abajo: cada pedido dice en qué camión cabe mejor.</span>
            </p>
          </div>

          {/* Medido con datos reales: salir 1 h antes mete ~5 pedidos más;
              ampliar el turno casi no mueve la aguja, porque los clientes
              cierran a hora fija sin importar cuánto trabaje el chofer. */}
          <p className="text-[10px] text-gray-600 leading-snug bg-emerald-50 border-t border-emerald-100 px-3 py-2">
            <b className="text-emerald-700">Lo que más ayudaría:</b> cargar más rápido en el CEDIS.
            Cada hora que los camiones salgan más temprano caben ~5 pedidos más.
            Alargar el turno casi no sirve: el límite no es la jornada del chofer,
            es que 97 de 195 clientes cierran antes de las 14:00.
          </p>
        </div>
      )}

      {alertas.map((a) => {
        const abierta = alertaAbierta === a.id;
        return (
          <div
            key={a.doc_num}
            className={`bg-white border rounded-xl overflow-hidden transition-shadow ${
              abierta ? 'border-orange-300 shadow-md' : 'border-red-100 shadow-sm hover:shadow-md'
            }`}
          >
            <button
              onClick={() => onAbrirAlerta(a)}
              className="w-full text-left cursor-pointer flex items-center justify-between gap-2 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">#{a.doc_num}</span>
                  <span className="text-[11px] text-gray-400">{a.motivo}</span>
                </div>
                <div className="text-[13px] font-semibold text-gray-800 truncate mt-0.5">{a.card_name}</div>
              </div>
              {abierta
                ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                : <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
            </button>

            {abierta && (
              <div className="bg-gray-50 border-t border-gray-100 p-2.5 space-y-1.5">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">¿A qué camión lo mando?</p>

                {cargandoSugerencias && (
                  <p className="text-[11px] text-gray-400 italic flex items-center gap-1.5 py-1">
                    <Loader className="w-3.5 h-3.5 animate-spin" /> Buscándole lugar en cada ruta…
                  </p>
                )}

                {sugerencias?.error && <p className="text-[11px] text-red-500">{sugerencias.error}</p>}

                {sugerencias?.opciones?.map((o) => {
                  const { placa, chofer } = etiquetaCamion(o.camion);
                  return (
                    <div
                      key={o.ruta_id}
                      className={`bg-white border rounded-lg p-2.5 flex items-center justify-between gap-2 ${
                        o.factible ? 'border-green-200' : 'border-red-200'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Truck className={`w-3.5 h-3.5 flex-shrink-0 ${o.factible ? 'text-green-600' : 'text-red-500'}`} />
                          <span className="text-[12px] font-bold text-gray-800">{placa}</span>
                          {chofer && <span className="text-[10px] text-gray-400">· {chofer}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
                          <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" /> Llega {o.eta_estimada}</span>
                          <span>· parada {o.posicion_sugerida} · +{o.minutos_agregados} min</span>
                        </div>
                        {!o.factible && (
                          <div className="text-[10px] text-red-500 mt-1 flex items-start gap-1">
                            <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            <span>{o.motivos_riesgo.join('; ')}</span>
                          </div>
                        )}
                      </div>
                      <button
                        disabled={asignando === o.ruta_id}
                        onClick={() => onAsignar(a.id, o)}
                        className={`text-[11px] font-bold px-3 py-1.5 rounded-lg flex-shrink-0 transition-colors ${
                          o.factible
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : 'bg-white text-red-600 border border-red-300 hover:bg-red-50'
                        } disabled:opacity-50`}
                      >
                        {asignando === o.ruta_id ? '…' : o.factible ? 'Asignar' : 'Forzar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
