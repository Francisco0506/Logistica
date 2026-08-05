import {
  MapPin, Clock, Phone, Navigation, AlertTriangle,
  ChevronRight, Map as MapIcon,
} from 'lucide-react';
import { ESTILO_ENTREGA } from '../../../config/estadosRuta';

// El vocabulario de los estados finales vive en config/estadosRuta.js: esta
// pantalla lo tenía en una copia propia, y por eso una parada `No_Entregado`
// llevaba aquí PALOMITA VERDE mientras el panel del despachador —que ya se
// había arreglado— la marcaba en ámbar. Se usa el `corto` porque en un celular
// la pastilla no da para "Entregado incompleto".
const ESTILO_ESTADO = ESTILO_ENTREGA;

/**
 * Abrir la dirección en la aplicación de mapas del celular.
 *
 * Con coordenadas y no con el texto de la calle: las direcciones de SAP vienen
 * como las capturó alguien —abreviaturas, sin código postal, a veces con el
 * número de local— y un buscador de mapas las manda a otra colonia. La
 * coordenada es la que el optimizador ya usó para armar la ruta, así que el
 * chofer llega exactamente al punto que el sistema planeó.
 *
 * Waze se abre por su esquema propio (`waze://`) y Google Maps por su URL
 * universal, que en un celular la abre la app y en una computadora el navegador.
 */
const enlaceWaze = (lat, lng) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
const enlaceMaps = (lat, lng) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

/**
 * Una parada en la lista: todo lo que el chofer necesita antes de bajarse del
 * camión, y los atajos para llamar o abrir la navegación.
 */
export default function TarjetaParada({
  parada, destacada = false, puedeEntregar = true, onAbrir,
  evidenciaPendiente, subiendoEvidencia = false, onReintentarEvidencia,
}) {
  const estado = ESTILO_ESTADO[parada.estado];
  const Icono = estado?.icono;
  const hecha = !!estado;

  return (
    <div className={`rounded-xl border overflow-hidden transition ${
      destacada ? 'border-orange-300 bg-white shadow-sm ring-2 ring-orange-100'
        : hecha ? 'border-gray-100 bg-gray-50/60'
        : 'border-gray-200 bg-white'
    }`}>
      <button onClick={onAbrir} className="w-full text-left px-4 py-3.5 flex items-start gap-3">
        {/* La bolita NO puede ser una palomita verde para las tres finales.
            Lo era: una parada "No entregado" llevaba palomita verde arriba y,
            dos centímetros abajo, la pastilla roja "No entregado". El chofer
            que revisa su día de un vistazo contaba como buenas las que no lo
            fueron. Ahora el icono y el color salen del propio estado. */}
        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-extrabold flex-shrink-0 text-white ${
          !hecha ? (destacada ? 'bg-orange-500' : 'bg-gray-200 text-gray-600') : ''
        }`} style={hecha ? { backgroundColor: estado.color } : undefined}>
          {hecha ? <Icono className="w-4 h-4" strokeWidth={3} /> : parada.secuencia_ruta}
        </span>

        <div className="flex-1 min-w-0">
          {/* El nombre de la SUCURSAL primero, no la razón social. Un mismo
              cliente (Pollo Loco, Pizza Legacy...) reparte en varios puntos el
              mismo día, y "Pollos Expo Guadalupe, S.A. De C.V." se repetía
              IDÉNTICO en dos paradas seguidas — solo la calle, en gris chiquito,
              las distinguía. `ship_to_code` es lo que está pintado en el local. */}
          <div className={`text-[15px] font-extrabold leading-snug ${hecha ? 'text-gray-500' : 'text-gray-900'}`}>
            {parada.ship_to_code || parada.card_name}
          </div>
          {parada.ship_to_code && (
            <div className="text-[11px] text-gray-500 truncate">{parada.card_name}</div>
          )}
          <div className="text-[13px] text-gray-500 mt-0.5">{parada.address || 'Sin dirección'}</div>

          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
            {parada.eta_desde && (
              <span className="text-[12px] font-bold text-gray-600 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {parada.eta_desde}-{parada.eta_hasta}
              </span>
            )}
            {parada.ventana && <span className="text-[12px] text-gray-500">recibe {parada.ventana}</span>}
            <span className="text-[12px] text-gray-500">
              {parada.lineas.length} producto{parada.lineas.length === 1 ? '' : 's'}
            </span>
          </div>

          {estado && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase px-2.5 py-1 rounded-full border mt-2 ${estado.clase}`}>
              <Icono className="w-3.5 h-3.5" /> {estado.corto}
              {parada.entregado_en && ` · ${parada.entregado_en}`}
            </span>
          )}
        </div>

        <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0 mt-1" />
      </button>

      {/* La evidencia que no alcanzó a subir por señal.
          La entrega YA quedó registrada —eso es lo que importa y por eso la foto
          va en petición aparte— pero antes el aviso se iba con el toast y la
          foto se perdía sin recurso. Y la evidencia es justo lo único del
          sistema que no se puede volver a pedir a ningún lado. */}
      {evidenciaPendiente && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-[12px] font-semibold text-amber-900 leading-snug flex-1">
            Falta subir {evidenciaPendiente.foto && evidenciaPendiente.firma ? 'la foto y la firma'
              : evidenciaPendiente.foto ? 'la foto' : 'la firma'}
          </span>
          <button
            onClick={onReintentarEvidencia}
            disabled={subiendoEvidencia}
            className="flex-shrink-0 bg-amber-500 active:bg-amber-600 disabled:opacity-50 text-white font-bold text-[13px] px-4 py-2.5 rounded-lg"
          >
            {subiendoEvidencia ? 'Subiendo…' : 'Reintentar'}
          </button>
        </div>
      )}

      {/* Atajos: llamar y navegar. Van FUERA del botón principal para que un
          toque no abra la hoja de entrega sin querer. */}
      {!hecha && (
        <div className="flex border-t border-gray-100 divide-x divide-gray-100">
          {parada.telefono && (
            <a
              href={`tel:${parada.telefono}`}
              className="flex-1 flex items-center justify-center gap-1.5 py-3.5 text-[13px] font-bold text-gray-700 active:bg-gray-100"
            >
              <Phone className="w-4 h-4" /> Llamar
            </a>
          )}
          {/* Waze y Maps por separado, no un solo "Cómo llegar".
              Cada chofer usa la que usa, y mandarlo a la que no es le cuesta
              tres toques más de pie junto al camión. Los dos van con la
              COORDENADA del plan y no con el texto de la calle: las direcciones
              de SAP vienen como alguien las capturó y un buscador de mapas las
              manda a otra colonia. */}
          {parada.lat && parada.lng && (
            <>
              <a
                href={enlaceWaze(parada.lat, parada.lng)}
                target="_blank"
                rel="noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-3.5 text-[13px] font-bold text-gray-700 active:bg-gray-100"
              >
                <Navigation className="w-4 h-4" /> Waze
              </a>
              <a
                href={enlaceMaps(parada.lat, parada.lng)}
                target="_blank"
                rel="noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-3.5 text-[13px] font-bold text-gray-700 active:bg-gray-100"
              >
                <MapIcon className="w-4 h-4" /> Maps
              </a>
            </>
          )}
          <button
            onClick={onAbrir}
            disabled={!puedeEntregar}
            title={puedeEntregar ? undefined : 'El camión todavía no sale del CEDIS'}
            className="flex-1 flex items-center justify-center gap-1.5 py-3.5 text-[13px] font-extrabold text-orange-600 active:bg-orange-100 disabled:text-gray-300 disabled:active:bg-transparent"
          >
            <MapPin className="w-4 h-4" /> Entregar
          </button>
        </div>
      )}
    </div>
  );
}
