import React, { useEffect, useState } from 'react';
import { X, Check, Minus, Plus, AlertTriangle, Camera, Trash2, PenLine } from 'lucide-react';
import PanelFirma from './PanelFirma';

/**
 * La hoja donde el chofer confirma qué dejó en una parada.
 *
 * Está pensada para usarse de pie, con una mano, en la calle: botones grandes,
 * el camino normal en UN toque y nada de escribir salvo que haga falta.
 *
 * Dos caminos:
 *   - "Entregué todo": un toque y listo. Es el 90% de las paradas.
 *   - "Entregué incompleto": ahí sí se ajusta renglón por renglón, porque el
 *     dato que ventas y facturación necesitan es cuánto de qué, no un
 *     porcentaje.
 */

// Cómo se le dice a cada motivo EN EL CELULAR. Los textos son más cortos que
// los del backend a propósito: aquí se leen de pie, en la calle, en una
// pantalla angosta.
//
// La LISTA de motivos ya no se escribe aquí: llega de /api/config, del mismo
// catálogo de `models.MOTIVOS`. Estaba duplicada, y el desfase era silencioso
// en las dos direcciones: si alguien agregaba un motivo en el modelo, el chofer
// nunca lo veía; y si un id se desfasaba, Django lo guardaba igual —no valida
// `choices` en `save()`— dejando basura en el catálogo con el que se pretende
// contar después ("¿cuántas veces al mes nos rechazan producto?").
const TEXTO_CORTO = {
  cliente_rechazo: 'El cliente aceptó menos',
  producto_danado: 'Producto dañado',
  falto_en_camion: 'No venía en el camión',
  cerrado: 'Estaba cerrado',
  sin_quien_reciba: 'No había quién recibiera',
  sin_espacio: 'No tenían dónde meterlo',
  otro: 'Otro motivo',
};

export default function HojaEntrega({
  parada, onCerrar, onConfirmar, guardando, puedeEntregar = true,
  // El catálogo del backend. El default es el de siempre, para que la hoja
  // siga sirviendo aunque /api/config no haya contestado.
  motivos = Object.keys(TEXTO_CORTO).map((id) => ({ id, texto: TEXTO_CORTO[id] })),
}) {
  // Si el backend manda un motivo nuevo que no tiene texto corto aquí, se usa
  // el largo del backend en vez de no mostrarlo.
  const MOTIVOS = motivos.map((m) => [m.id, TEXTO_CORTO[m.id] ?? m.texto]);
  const [modo, setModo] = useState(null);   // null | 'parcial'
  const [cantidades, setCantidades] = useState(
    () => Object.fromEntries(parada.lineas.map((l) => [l.id, l.cantidad]))
  );
  const [motivo, setMotivo] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [recibio, setRecibio] = useState('');
  const [foto, setFoto] = useState(null);          // File que se va a subir
  const [vistaPrevia, setVistaPrevia] = useState(null);
  const [firma, setFirma] = useState(null);        // Blob PNG de la firma
  const [vistaFirma, setVistaFirma] = useState(null);
  const [firmando, setFirmando] = useState(false);

  // Los object URL de la foto y de la firma se sueltan al cerrar la hoja.
  // Antes solo se liberaba la foto, y solo si el chofer apretaba el bote de
  // basura: en un turno de 20 entregas con evidencia, el celular se quedaba
  // con 20 imágenes retenidas en memoria.
  useEffect(() => () => {
    if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
    if (vistaFirma) URL.revokeObjectURL(vistaFirma);
  }, [vistaPrevia, vistaFirma]);

  const ajustar = (linea, delta) => {
    setCantidades((prev) => {
      const actual = prev[linea.id] ?? linea.cantidad;
      // Entre 0 y lo que trae: no se puede dejar de MÁS de lo que venía, y el
      // paso es de una pieza completa — media caja de queso no se entrega.
      const siguiente = Math.max(0, Math.min(linea.cantidad, actual + delta));
      return { ...prev, [linea.id]: siguiente };
    });
  };

  const faltantes = parada.lineas.filter((l) => (cantidades[l.id] ?? l.cantidad) < l.cantidad);
  const nadaEntregado = parada.lineas.every((l) => (cantidades[l.id] ?? l.cantidad) === 0);

  const tomarFoto = (e) => {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setFoto(archivo);
    setVistaPrevia(URL.createObjectURL(archivo));
  };

  const quitarFoto = () => {
    if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
    setFoto(null);
    setVistaPrevia(null);
  };

  const guardarFirma = (blob) => {
    if (vistaFirma) URL.revokeObjectURL(vistaFirma);
    setFirma(blob);
    setVistaFirma(URL.createObjectURL(blob));
    setFirmando(false);
  };

  const quitarFirma = () => {
    if (vistaFirma) URL.revokeObjectURL(vistaFirma);
    setFirma(null);
    setVistaFirma(null);
  };

  const enviarCompleto = () => onConfirmar({ recibio: recibio.trim() || undefined }, foto, firma);

  const enviarParcial = () => {
    onConfirmar({
      lineas: parada.lineas.map((l) => ({
        linea_id: l.id,
        cantidad_entregada: cantidades[l.id] ?? l.cantidad,
      })),
      motivo: motivo || 'otro',
      observaciones: observaciones.trim() || undefined,
      recibio: recibio.trim() || undefined,
    }, foto, firma);
  };

  return (
    // En el celular ocupa toda la pantalla, que es donde de verdad se usa. En
    // computadora va como ventana centrada: a todo lo ancho de un monitor los
    // renglones quedaban separadísimos del número y no se leía qué es qué.
    <div className="fixed inset-0 z-[3000] bg-black/40 sm:flex sm:items-center sm:justify-center sm:p-6">
    <div className="bg-white h-full w-full flex flex-col sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl sm:shadow-2xl sm:overflow-hidden">
      {/* Cabecera fija */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <button onClick={onCerrar} className="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100">
          <X className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-gray-400">Parada {parada.secuencia_ruta} · #{parada.doc_num}</div>
          <h2 className="text-base font-extrabold text-gray-900 truncate">{parada.card_name}</h2>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* ── Lo que trae el camión ── */}
        <div className="px-4 py-3">
          <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
            {modo === 'parcial' ? 'Ajusta lo que dejaste' : 'Lo que trae este pedido'}
          </h3>

          <div className="space-y-2">
            {parada.lineas.map((l) => {
              const dejado = cantidades[l.id] ?? l.cantidad;
              const corto = dejado < l.cantidad;
              return (
                <div
                  key={l.id}
                  className={`rounded-xl border p-3 ${corto ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[14px] font-bold text-gray-800 leading-snug">{l.descripcion}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{l.item_code}</div>
                    </div>
                    {modo !== 'parcial' && (
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-extrabold text-gray-800 tabular-nums leading-none">
                          {l.cantidad}
                        </div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase">{l.unidad}</div>
                      </div>
                    )}
                  </div>

                  {/* Ajuste de cantidad, con botones grandes para el pulgar */}
                  {modo === 'parcial' && (
                    <div className="flex items-center gap-3 mt-3">
                      <button
                        onClick={() => ajustar(l, -1)}
                        disabled={dejado <= 0}
                        className="w-12 h-12 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-30 flex items-center justify-center flex-shrink-0"
                      >
                        <Minus className="w-5 h-5 text-gray-700" />
                      </button>

                      <div className="flex-1 text-center">
                        <div className={`text-2xl font-extrabold tabular-nums leading-none ${corto ? 'text-amber-700' : 'text-gray-800'}`}>
                          {dejado}
                          <span className="text-sm text-gray-400 font-bold"> / {l.cantidad}</span>
                        </div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">{l.unidad}</div>
                      </div>

                      <button
                        onClick={() => ajustar(l, 1)}
                        disabled={dejado >= l.cantidad}
                        className="w-12 h-12 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-30 flex items-center justify-center flex-shrink-0"
                      >
                        <Plus className="w-5 h-5 text-gray-700" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Motivo y nota, solo cuando la entrega salió incompleta ── */}
        {modo === 'parcial' && (
          <div className="px-4 pb-3 space-y-3">
            <div>
              <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                ¿Por qué no se entregó todo?
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {MOTIVOS.map(([id, texto]) => (
                  <button
                    key={id}
                    onClick={() => setMotivo(id)}
                    className={`px-3 py-3 rounded-xl text-[12px] font-bold text-left transition ${
                      motivo === id
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {texto}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wide block mb-1.5">
                ¿Algo más que deba saber ventas?
              </label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={3}
                placeholder="Ej. el cliente no tenía cámara para la salsa"
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[14px] focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
            </div>
          </div>
        )}

        {/* Foto de evidencia. `capture="environment"` abre directo la cámara
            trasera del celular en vez del carrete: en la puerta del cliente lo
            que se quiere es tomar la foto, no buscarla. */}
        <div className="px-4 pb-3">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wide block mb-1.5">
            Foto de evidencia <span className="font-semibold normal-case text-gray-300">(opcional)</span>
          </label>

          {vistaPrevia ? (
            <div className="relative">
              <img src={vistaPrevia} alt="Evidencia de la entrega" className="w-full h-44 object-cover rounded-xl border border-gray-200" />
              <button
                onClick={quitarFoto}
                className="absolute top-2 right-2 bg-white/95 border border-gray-200 rounded-lg p-2 shadow-sm active:bg-gray-100"
              >
                <Trash2 className="w-4 h-4 text-red-500" />
              </button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 w-full py-4 border-2 border-dashed border-gray-200 rounded-xl text-[13px] font-bold text-gray-500 active:bg-gray-50 cursor-pointer">
              <Camera className="w-5 h-5" /> Tomar foto
              <input type="file" accept="image/*" capture="environment" onChange={tomarFoto} className="hidden" />
            </label>
          )}
        </div>

        {/* Quién recibió: siempre, y opcional */}
        <div className="px-4 pb-4">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wide block mb-1.5">
            ¿Quién recibió? <span className="font-semibold normal-case text-gray-300">(opcional)</span>
          </label>
          <input
            value={recibio}
            onChange={(e) => setRecibio(e.target.value)}
            placeholder="Nombre de quien recibe"
            className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[15px] focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </div>

        {/* La FIRMA de esa persona. Va debajo del nombre porque es el mismo
            momento: se teclea quién recibe y se le pasa el teléfono. */}
        <div className="px-4 pb-4">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wide block mb-1.5">
            Firma <span className="font-semibold normal-case text-gray-300">(opcional)</span>
          </label>

          {vistaFirma ? (
            <div className="relative">
              <img
                src={vistaFirma}
                alt="Firma de quien recibió"
                className="w-full h-28 object-contain rounded-xl border border-gray-200 bg-white"
              />
              <button
                onClick={quitarFirma}
                className="absolute top-2 right-2 bg-white/95 border border-gray-200 rounded-lg p-2 shadow-sm active:bg-gray-100"
              >
                <Trash2 className="w-4 h-4 text-red-500" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setFirmando(true)}
              className="flex items-center justify-center gap-2 w-full py-4 border-2 border-dashed border-gray-200 rounded-xl text-[13px] font-bold text-gray-500 active:bg-gray-50"
            >
              <PenLine className="w-5 h-5" /> Pedir firma
            </button>
          )}
        </div>
      </div>

      {firmando && (
        <PanelFirma
          nombre={recibio}
          onCerrar={() => setFirmando(false)}
          onGuardar={guardarFirma}
        />
      )}

      {/* ── Acciones, pegadas abajo donde alcanza el pulgar ── */}
      <div className="border-t border-gray-200 p-4 space-y-2 flex-shrink-0 bg-white">
        {/* Se puede consultar el pedido siempre —sirve para ir preparando la
            carga— pero confirmar solo cuando el camión ya salió. */}
        {!puedeEntregar ? (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-900 leading-snug">
              <b>Todavía no puedes reportar esta entrega.</b> El camión no ha salido
              del CEDIS; pide que te den Salida en el almacén.
            </p>
          </div>
        ) : modo !== 'parcial' ? (
          <>
            <button
              onClick={enviarCompleto}
              disabled={guardando}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-[16px] py-4 rounded-xl transition"
            >
              <Check className="w-5 h-5" strokeWidth={3} />
              {guardando ? 'Guardando…' : 'Entregué todo'}
            </button>
            <button
              onClick={() => setModo('parcial')}
              disabled={guardando}
              className="w-full flex items-center justify-center gap-2 border-2 border-gray-200 hover:bg-gray-50 text-gray-600 font-bold text-[14px] py-3.5 rounded-xl transition"
            >
              <AlertTriangle className="w-4 h-4" />
              Hubo un problema
            </button>
          </>
        ) : (
          <>
            {/* El resumen antes de confirmar: que el chofer vea qué va a quedar
                registrado, porque de esto depende lo que se le factura al
                cliente. */}
            <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              {nadaEntregado
                ? <b className="text-red-600">No se va a registrar ninguna entrega.</b>
                : faltantes.length === 0
                  ? <>Quedaría como <b className="text-emerald-600">entregado completo</b>.</>
                  : <>Quedaría como <b className="text-amber-700">entregado incompleto</b>: {faltantes.length} producto(s) con faltante.</>}
            </div>

            <button
              onClick={enviarParcial}
              disabled={guardando || (!motivo && faltantes.length > 0)}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-40 text-white font-extrabold text-[16px] py-4 rounded-xl transition"
            >
              <Check className="w-5 h-5" strokeWidth={3} />
              {guardando ? 'Guardando…' : 'Confirmar entrega'}
            </button>
            {!motivo && faltantes.length > 0 && (
              <p className="text-[11px] text-gray-400 text-center">Escoge un motivo para poder confirmar.</p>
            )}
            <button
              onClick={() => setModo(null)}
              className="w-full text-[13px] font-bold text-gray-400 hover:text-gray-600 py-2"
            >
              Volver
            </button>
          </>
        )}
      </div>
    </div>
    </div>
  );
}
