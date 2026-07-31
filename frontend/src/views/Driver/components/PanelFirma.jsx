import React, { useEffect, useRef, useState } from 'react';
import { Eraser, Check, X } from 'lucide-react';

/**
 * El recuadro donde firma quien recibe, con el dedo, en la puerta del cliente.
 *
 * Es distinto del nombre escrito que ya se capturaba: ese lo teclea el chofer y
 * puede poner lo que sea. Esto lo traza la persona que recibe, delante de él, y
 * es lo que zanja una aclaración de "aquí nadie recibió eso".
 *
 * ── Decisiones que importan ──
 *
 * Se dibuja con Pointer Events y no con touch/mouse por separado: un mismo
 * manejador sirve para el dedo del chofer en el celular y para el mouse cuando
 * alguien lo prueba en la computadora, sin código duplicado ni el retraso de
 * 300 ms que arrastran los eventos táctiles emulados.
 *
 * El canvas se dimensiona en píxeles REALES del dispositivo
 * (devicePixelRatio). Sin eso, en un celular la firma se guarda a un tercio de
 * la resolución de la pantalla y sale como una mancha borrosa — justo el
 * documento que se va a querer enseñar ampliado.
 *
 * Se exporta PNG (no JPG) porque el fondo va transparente: la firma se va a
 * imprimir encima de la guía de entrega, y un rectángulo blanco encima del
 * papel se ve como un parche pegado.
 */

// Ancho del trazo en píxeles CSS. 2.5 se lee bien en pantalla chica sin que la
// firma se convierta en un borrón al reducirla en la guía impresa.
const GROSOR = 2.5;

export default function PanelFirma({ onCerrar, onGuardar, nombre }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const dibujandoRef = useRef(false);
  const [tieneTrazo, setTieneTrazo] = useState(false);

  // Ajustar el canvas al tamaño real que ocupa en pantalla, en píxeles del
  // dispositivo. Corre al montar y en cada giro de pantalla: rotar el celular
  // cambia el ancho del recuadro y, sin volver a medir, el trazo se dibuja
  // desplazado del dedo.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preparar = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const escala = window.devicePixelRatio || 1;
      // Redimensionar el canvas BORRA su contenido, así que se conserva lo
      // trazado y se vuelve a pintar encima. Sin esto, girar el teléfono a
      // media firma la borraba sin avisar.
      const previo = tieneTrazo ? canvas.toDataURL() : null;

      canvas.width = Math.round(width * escala);
      canvas.height = Math.round(height * escala);

      const ctx = canvas.getContext('2d');
      ctx.scale(escala, escala);
      ctx.lineWidth = GROSOR;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
      ctxRef.current = ctx;

      if (previo) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, width, height);
        img.src = previo;
      }
    };

    preparar();
    window.addEventListener('resize', preparar);
    window.addEventListener('orientationchange', preparar);
    return () => {
      window.removeEventListener('resize', preparar);
      window.removeEventListener('orientationchange', preparar);
    };
    // `tieneTrazo` a propósito FUERA de las dependencias: solo se lee para
    // decidir si hay que conservar el dibujo, y meterlo aquí volvería a montar
    // el listener en el primer trazo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const puntoDe = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const empezar = (e) => {
    e.preventDefault();
    const ctx = ctxRef.current;
    if (!ctx) return;
    // Capturar el puntero: si el dedo se sale del recuadro a media firma, los
    // eventos siguen llegando aquí y el trazo no se corta a la mitad.
    canvasRef.current.setPointerCapture(e.pointerId);
    dibujandoRef.current = true;
    const { x, y } = puntoDe(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Un punto: una firma que es solo un toque (una "X", un punto) también
    // tiene que quedar registrada.
    ctx.lineTo(x, y);
    ctx.stroke();
    setTieneTrazo(true);
  };

  const mover = (e) => {
    if (!dibujandoRef.current) return;
    e.preventDefault();
    const { x, y } = puntoDe(e);
    ctxRef.current.lineTo(x, y);
    ctxRef.current.stroke();
  };

  const terminar = (e) => {
    if (!dibujandoRef.current) return;
    dibujandoRef.current = false;
    try {
      canvasRef.current.releasePointerCapture(e.pointerId);
    } catch {
      // El puntero ya se soltó solo (el dedo salió de la pantalla). No importa.
    }
  };

  const limpiar = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    // El contexto viene escalado, así que estas medidas (en píxeles del
    // dispositivo) cubren de sobra todo el lienzo. Barrer de más no cuesta y
    // evita dejar un borde sin limpiar en pantallas con devicePixelRatio alto.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setTieneTrazo(false);
  };

  const guardar = () => {
    if (!tieneTrazo) return;
    // toBlob y no toDataURL: el base64 pesa ~33% más y va a viajar por la red
    // del celular del chofer, que en la calle es lo que es.
    canvasRef.current.toBlob(
      (blob) => {
        if (blob) onGuardar(blob);
      },
      'image/png',
    );
  };

  return (
    <div className="fixed inset-0 z-[4000] bg-black/50 flex items-center justify-center sm:p-6">
      <div className="bg-white w-full h-full sm:h-auto sm:max-w-lg sm:rounded-2xl sm:shadow-2xl flex flex-col">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 flex-shrink-0">
          <button onClick={onCerrar} className="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-gray-400">Firma de quien recibe</div>
            <h2 className="text-base font-extrabold text-gray-900 truncate">
              {nombre?.trim() || 'Pásale el teléfono para que firme'}
            </h2>
          </div>
        </header>

        <div className="flex-1 p-4 flex flex-col min-h-0">
          {/* `touch-none` es obligatorio: sin él, deslizar el dedo dentro del
              recuadro hace scroll de la página en vez de dibujar. */}
          <canvas
            ref={canvasRef}
            onPointerDown={empezar}
            onPointerMove={mover}
            onPointerUp={terminar}
            onPointerCancel={terminar}
            onPointerLeave={terminar}
            className="flex-1 min-h-[220px] w-full touch-none rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 cursor-crosshair"
          />
          <div className="flex items-center justify-between mt-2 px-1">
            <p className="text-[11px] text-gray-400">Firma con el dedo dentro del recuadro</p>
            <button
              onClick={limpiar}
              disabled={!tieneTrazo}
              className="flex items-center gap-1.5 text-[12px] font-bold text-gray-500 disabled:opacity-30 px-2 py-1 rounded-lg active:bg-gray-100"
            >
              <Eraser className="w-4 h-4" /> Borrar
            </button>
          </div>
        </div>

        <div className="border-t border-gray-200 p-4 flex-shrink-0">
          <button
            onClick={guardar}
            disabled={!tieneTrazo}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 active:bg-emerald-800 disabled:opacity-40 text-white font-extrabold text-[16px] py-4 rounded-xl transition"
          >
            <Check className="w-5 h-5" strokeWidth={3} />
            Listo
          </button>
          {!tieneTrazo && (
            <p className="text-[11px] text-gray-400 text-center mt-2">
              La firma es opcional: puedes cerrar y confirmar la entrega sin ella.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
