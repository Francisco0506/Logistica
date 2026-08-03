import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Truck, MapPin, Clock, Phone, Navigation, Check, AlertTriangle,
  ChevronRight, ChevronDown, ChevronUp, LogOut, RefreshCw, PackageCheck, Map as MapIcon,
} from 'lucide-react';
import LabenLogo from '../../components/LabenLogo';
import { useAviso } from '../../components/useAviso';
import { getRutas, getRutaChofer, confirmarEntrega, getCamionesGPS, getFlota, subirFotoEntrega, subirFirmaEntrega } from '../../services/api';
import HojaEntrega from './components/HojaEntrega';
import MapaRuta from './components/MapaRuta';
import { ESTILO_ENTREGA, esVisitada, huboEntrega, salioMal } from '../../config/estadosRuta';
import { hoyLocal } from '../../lib/fecha';
import { useConfig } from '../../config/useConfig';

/**
 * La app del chofer.
 *
 * Pensada PARA CELULAR primero: se usa de pie, en la calle, con una mano y a
 * veces con prisa. De ahí las decisiones — botones grandes, poco texto, la
 * siguiente parada siempre hasta arriba, y el camino normal ("entregué todo")
 * en un solo toque.
 *
 * Es la única pieza que le dice al sistema qué pasó de verdad. Sin ella,
 * "Entregado" solo significa que alguien en la oficina cerró la ruta.
 */

// Se refresca para que el chofer vea si el despachador le movió algo.
const REFRESH_MS = 60_000;

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

export default function DriverApp() {
  const navigate = useNavigate();
  const avisar = useAviso();
  const [params, setParams] = useSearchParams();

  // La placa puede venir en la dirección (?camion=RA7475A) para que el chofer
  // llegue directo a su ruta desde un enlace o un acceso directo del celular.
  // Si no viene, la escoge de una lista. Cuando haya usuarios de chofer esto
  // saldrá de su sesión y la lista desaparece.
  const camion = params.get('camion') || '';
  // El catálogo de motivos sale del backend, no de una copia en el celular.
  const { config } = useConfig();
  const [rutasDelDia, setRutasDelDia] = useState([]);
  // Evidencia que NO alcanzó a subir, por parada: { [remisionId]: {foto, firma} }.
  // Vive en memoria a propósito y no en localStorage: un File/Blob no se puede
  // serializar, y guardar la foto en el navegador para "después" daría una
  // promesa que no se puede cumplir si el chofer cierra la pestaña. Lo honesto
  // es ofrecer el reintento mientras la app siga abierta, que es el caso real
  // (el chofer llega a la siguiente bodega y ahí sí hay señal).
  const [evidenciaPendiente, setEvidenciaPendiente] = useState({});
  const [subiendoEvidencia, setSubiendoEvidencia] = useState(null);
  // Distinguir "todavía no llega la respuesta" de "no hay rutas". Sin esto, con
  // la señal de la calle el chofer veía "Sin rutas todavía · Pregunta en el
  // CEDIS" durante segundos aunque sus rutas SÍ existieran — y ese chofer marca
  // al CEDIS por nada.
  const [buscandoRutas, setBuscandoRutas] = useState(true);
  const [flota, setFlota] = useState([]);
  const [ruta, setRuta] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [abierta, setAbierta] = useState(null);   // parada con la hoja de entrega abierta
  const [guardando, setGuardando] = useState(false);
  const [gps, setGps] = useState([]);
  const [verMapa, setVerMapa] = useState(true);
  const [verHechas, setVerHechas] = useState(false);   // lo ya reportado no estorba
  const fecha = hoyLocal();

  // Los camiones que SALEN hoy. Antes se listaba la flota completa, incluidos
  // los que están apagados y los que no tienen ruta: el chofer podía escoger un
  // camión que no va a ninguna parte.
  useEffect(() => {
    const c = new AbortController();
    // Se vuelve a preguntar cada 30 s. Antes se pedía UNA sola vez al abrir la
    // app: si el despachador generaba las rutas a las 6:40 y el chofer había
    // abierto a las 6:35, la pantalla se quedaba vacía PARA SIEMPRE hasta que
    // se le ocurriera recargar el navegador — y un chofer no tiene por qué
    // saber recargar un navegador.
    const traer = () => getRutas(fecha, { signal: c.signal })
      .then(setRutasDelDia)
      .catch(() => {})
      .finally(() => setBuscandoRutas(false));
    traer();
    const i = setInterval(traer, 30_000);
    return () => { c.abort(); clearInterval(i); };
  }, [fecha]);

  // El color del camión, que lo identifica en TODAS las demás pantallas. Esta
  // era la única donde no aparecía.
  useEffect(() => {
    const c = new AbortController();
    getFlota({ signal: c.signal }).then(setFlota).catch(() => {});
    return () => c.abort();
  }, []);
  const colorDe = (placa) => flota.find((f) => f.placa === placa)?.color || '#94a3b8';

  // Su propia posición, para verse en el mapa. Aparte de la ruta: si Samsara
  // falla, la lista de paradas sigue funcionando.
  useEffect(() => {
    const c = new AbortController();
    const traer = () => getCamionesGPS({ signal: c.signal }).then(setGps).catch(() => {});
    traer();
    const i = setInterval(traer, 20_000);
    return () => { c.abort(); clearInterval(i); };
  }, []);

  useEffect(() => {
    if (!camion) { setRuta(null); return; }
    const c = new AbortController();
    const traer = () => {
      getRutaChofer(fecha, camion, { signal: c.signal })
        .then(setRuta)
        .catch((e) => { if (e.name !== 'AbortError') console.error('Ruta chofer:', e); })
        .finally(() => setCargando(false));
    };
    setCargando(true);
    traer();
    const i = setInterval(traer, REFRESH_MS);
    return () => { c.abort(); clearInterval(i); };
  }, [camion, fecha]);

  const paradas = ruta?.paradas || [];
  // Paradas ya VISITADAS: el camión pasó por ahí, se haya podido entregar o no.
  // Es lo que mide el avance de la ruta.
  const hechas = paradas.filter((p) => esVisitada(p.estado)).length;
  // Las que de verdad se entregaron (completas o a medias). Se cuentan aparte
  // porque la barra decía "8 de 10 entregas" incluyendo las que NO se
  // entregaron: el chofer terminaba su turno creyendo que le fue mejor de lo
  // que le fue, y el número no cuadraba con lo que veía ventas.
  const entregadas = paradas.filter((p) => huboEntrega(p.estado)).length;
  const completas = paradas.filter((p) => p.estado === 'Entregado').length;
  // La primera que todavía no se reporta. Sin useMemo a propósito: son 20
  // elementos y `paradas` se recrea en cada render, así que memorizarlo no
  // ahorraría nada y solo escondería la dependencia.
  const siguiente = paradas.find((p) => !esVisitada(p.estado));
  const porReportar = paradas.filter((p) => !esVisitada(p.estado));
  // "La que sigue" ya se pinta en su propia sección, arriba y en grande. Sin
  // quitarla de aquí, el mismo cliente aparecía DOS VECES seguidas en un
  // celular —se lee como dos entregas al mismo lugar— y el encabezado decía
  // "Por entregar (8)" cuando abajo del bloque grande quedaban 7.
  const pendientes = porReportar.slice(1);
  const reportadas = paradas.filter((p) => esVisitada(p.estado));
  const incompletas = paradas.filter((p) => salioMal(p.estado)).length;
  const miPosicion = gps.find((c) => c.placa === camion) || null;
  // Solo se puede entregar si el camión YA SALIÓ del CEDIS. Mientras el
  // despachador no le dé Salida, la mercancía sigue en el almacén: dejar
  // reportar entregas antes convertiría el dato en algo que no ocurrió, que es
  // justo el problema que esta app viene a resolver.
  const puedeEntregar = ruta?.estado === 'En_Ruta';

  /**
   * Volver a intentar subir la evidencia de una parada ya confirmada.
   *
   * Solo reintenta lo que falta: si la foto sí subió y la firma no, no se
   * vuelve a mandar la foto.
   */
  const reintentarEvidencia = async (remisionId) => {
    const pend = evidenciaPendiente[remisionId];
    if (!pend) return;
    setSubiendoEvidencia(remisionId);
    const sigueFallando = {};
    if (pend.foto) {
      try { await subirFotoEntrega(remisionId, pend.foto); }
      catch { sigueFallando.foto = pend.foto; }
    }
    if (pend.firma) {
      try { await subirFirmaEntrega(remisionId, pend.firma); }
      catch { sigueFallando.firma = pend.firma; }
    }
    setSubiendoEvidencia(null);

    setEvidenciaPendiente((prev) => {
      const copia = { ...prev };
      if (sigueFallando.foto || sigueFallando.firma) copia[remisionId] = sigueFallando;
      else delete copia[remisionId];
      return copia;
    });

    if (sigueFallando.foto || sigueFallando.firma) {
      avisar('Sigue sin subir. Inténtalo donde agarre mejor la señal.', 'error');
    } else {
      avisar('Listo, ya subió.', 'exito');
      try { setRuta(await getRutaChofer(fecha, camion)); } catch { /* el intervalo la trae */ }
    }
  };

  const confirmar = async (datos, foto, firma) => {
    setGuardando(true);
    try {
      const res = await confirmarEntrega(abierta.id, datos);

      // El backend contesta 200 aunque no haya guardado nada (ninja manda los
      // errores de negocio en el cuerpo, con status 'error'). Antes eso caía al
      // camino feliz: se cerraba la hoja y se refrescaba como si la entrega
      // hubiera quedado registrada. En la app cuyo único propósito es que
      // "Entregado" signifique algo, eso es lo peor que puede pasar.
      if (res.status === 'error') {
        avisar(res.message || 'No se pudo guardar la entrega.', 'error');
        return;
      }

      avisar(res.message, res.estado === 'Entregado' ? 'exito' : 'info');

      // La foto y la firma se suben DESPUÉS y aparte: si fallan por mala
      // señal, la entrega ya quedó registrada, que es lo que importa.
      //
      // Lo que faltaba era el recurso. Antes solo se avisaba del fallo y la
      // hoja se cerraba: la evidencia se perdía sin forma de recuperarla, y
      // justo la evidencia es lo que no se puede volver a pedir a SAP ni a
      // ningún lado. Ahora lo que no subió se GUARDA en memoria y la parada
      // queda con un botón de "Subir foto/firma" para reintentar desde una
      // bodega con mejor señal.
      const pendiente = {};
      if (foto) {
        try { await subirFotoEntrega(abierta.id, foto); }
        catch { pendiente.foto = foto; }
      }
      if (firma) {
        try { await subirFirmaEntrega(abierta.id, firma); }
        catch { pendiente.firma = firma; }
      }
      if (pendiente.foto || pendiente.firma) {
        setEvidenciaPendiente((prev) => ({ ...prev, [abierta.id]: pendiente }));
        const qué = pendiente.foto && pendiente.firma ? 'la foto y la firma'
          : pendiente.foto ? 'la foto' : 'la firma';
        avisar(`La entrega se guardó, pero ${qué} no subió. Queda un botón para reintentarlo.`, 'error');
      }
      setAbierta(null);
    } catch (e) {
      console.error('Confirmar entrega:', e);
      avisar('No se pudo guardar. Revisa tu señal e inténtalo otra vez.', 'error');
      return;
    } finally {
      setGuardando(false);
    }

    // El refresco va FUERA del try de la confirmación, y a propósito.
    //
    // Estaba adentro, así que en una bodega con mala señal pasaba esto: el POST
    // sí llegaba —el backend ya había guardado la entrega, con su foto y su
    // firma— pero el GET siguiente tronaba y caía al catch. El chofer veía el
    // toast rojo "No se pudo guardar, inténtalo otra vez" encima del verde que
    // ya se había mostrado, y la parada seguía apareciendo pendiente. Iba a
    // volver a reportar una entrega que ya estaba registrada.
    //
    // Que no se refresque la lista es una molestia: el intervalo la trae en un
    // minuto. Decirle que no se guardó cuando sí se guardó es un dato falso, y
    // eso es lo que esta app existe para evitar.
    try {
      setRuta(await getRutaChofer(fecha, camion));
    } catch {
      avisar('Tu entrega quedó guardada. La lista se actualiza en un momento.', 'info');
    }
  };

  // ── Escoger camión ──
  if (!camion) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LabenLogo variant="horizontal" />
            <span className="text-[9px] text-gray-300 font-bold tracking-[.2em] uppercase self-end pb-0.5">· Chofer</span>
          </div>
          {/* Con padding de verdad: iba a ~20 px de alto en la esquina del
              pulgar, así que al querer cerrar algo el chofer se salía del
              sistema sin querer. */}
          <button onClick={() => navigate('/')} className="text-[13px] font-bold text-gray-500 flex items-center gap-1.5 px-3 py-2.5 -mr-2 rounded-lg active:bg-gray-100">
            <LogOut className="w-4 h-4" /> Salir
          </button>
        </header>

        <div className="flex-1 p-4">
          {/* El título va CHICO y la placa grande: el chofer ya sabe la
              pregunta antes de abrir la app, lo único que escanea es su placa. */}
          <h1 className="text-[15px] font-bold text-gray-500 mb-1">¿Cuál camión traes?</h1>
          <p className="text-[14px] text-gray-600 mb-4">
            {rutasDelDia.length ? 'Estos son los que salen hoy.' : ''}
          </p>

          {buscandoRutas && !rutasDelDia.length && (
            <div className="bg-white rounded-xl border border-gray-200 text-center py-12 px-4">
              <RefreshCw className="w-7 h-7 mx-auto mb-3 text-gray-300 animate-spin" />
              <p className="text-[15px] font-bold text-gray-600">Buscando tus rutas…</p>
            </div>
          )}

          {!buscandoRutas && !rutasDelDia.length && (
            <div className="bg-white rounded-xl border border-gray-200 text-center py-10 px-5">
              <Truck className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="text-[17px] font-extrabold text-gray-700">Todavía no hay camiones para hoy</p>
              <p className="text-[14px] text-gray-500 mt-1.5 leading-snug">
                En el CEDIS aún no arman las rutas. Esta pantalla se actualiza
                sola; no tienes que hacer nada.
              </p>
              <button
                onClick={() => { setBuscandoRutas(true); getRutas(fecha).then(setRutasDelDia).catch(() => {}).finally(() => setBuscandoRutas(false)); }}
                className="mt-5 inline-flex items-center gap-2 bg-gray-100 active:bg-gray-200 text-gray-700 font-bold text-[15px] px-5 py-3 rounded-xl"
              >
                <RefreshCw className="w-4 h-4" /> Volver a buscar
              </button>
            </div>
          )}

          <div className="space-y-2">
            {/* Las terminadas hasta abajo: un camión que ya cerró su día no
                debe estorbarle al que todavía no sale. */}
            {[...rutasDelDia]
              .sort((a, b) => (a.estado === 'Finalizada') - (b.estado === 'Finalizada'))
              .map((r) => {
              const salio = r.estado === 'En_Ruta';
              const cerrada = r.estado === 'Finalizada';
              return (
                <button
                  key={r.id}
                  onClick={() => setParams({ camion: r.camion })}
                  className="w-full flex items-stretch gap-3 bg-white border border-gray-200 active:bg-gray-50 rounded-xl px-4 py-4 text-left transition"
                >
                  {/* La franja de color: es el mismo con el que este camión
                      aparece en el mapa y en el manifiesto del CEDIS. */}
                  <span className="w-1.5 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: colorDe(r.camion) }} />

                  <div className="flex-1 min-w-0 self-center">
                    {/* A 26 px la placa se lee a un brazo de distancia, sin
                        tener que acercarse el celular a la cara — que es el
                        gesto que no puede hacer con una mano ocupada. */}
                    <div className="text-[26px] font-extrabold text-gray-900 tracking-wider leading-none">{r.camion}</div>
                    {/* El nombre del chofer es el dato que de verdad decide: si
                        dice su nombre, no tiene que acordarse de ninguna placa. */}
                    {r.chofer && <div className="text-[15px] font-bold text-gray-700 mt-1">{r.chofer}</div>}
                    <div className="text-[14px] text-gray-600 mt-1">
                      {r.pedidos_count} {r.pedidos_count === 1 ? 'entrega' : 'entregas'}
                      {r.hora_salida && ` · salió ${r.hora_salida}`}
                    </div>
                  </div>

                  {/* Fondos -100 y no -50: al sol, un bg-blue-50 sobre blanco
                      es prácticamente invisible. */}
                  <span className={`text-[11px] font-bold uppercase px-2 py-1 rounded-full flex-shrink-0 self-center ${
                    salio ? 'bg-blue-100 text-blue-800'
                      : cerrada ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {salio ? 'En ruta' : cerrada ? 'Terminada' : 'En el CEDIS'}
                  </span>
                  <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0 self-center" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      {/* ═══ CABECERA — pegada arriba, con el avance siempre visible ═══ */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <LabenLogo variant="horizontal" />
            <span className="text-[9px] text-gray-300 font-bold tracking-[.2em] uppercase self-end pb-0.5 hidden sm:inline">
              · Chofer
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setParams({})}
              title="Cambiar de camión"
              className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-2.5 py-1.5"
            >
              <Truck className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-xs font-extrabold text-gray-700">{camion}</span>
            </button>
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 text-xs font-bold text-gray-400 active:text-red-600 px-2 py-1.5"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {!!paradas.length && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between text-[11px] font-bold mb-1.5">
              <span className="text-gray-500">
                {hechas} de {paradas.length} paradas
                {hechas > entregadas && ` · ${entregadas} entregadas`}
              </span>
              <span className="text-gray-400">
                {ruta?.hora_salida ? `Salió ${ruta.hora_salida}` : 'Sin salir del CEDIS'}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${paradas.length ? (hechas / paradas.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </header>

      <main className="px-4 py-4 space-y-4 max-w-2xl mx-auto">
        {cargando && !ruta && (
          <div className="text-center py-16 text-gray-400">
            <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
            <p className="text-sm">Cargando tus entregas…</p>
          </div>
        )}

        {!cargando && !ruta && (
          <div className="bg-white rounded-xl border border-gray-200 text-center py-14 px-4">
            <Truck className="w-8 h-8 mx-auto mb-3 text-gray-200" />
            <p className="text-sm font-bold text-gray-600">El {camion} no tiene ruta para hoy</p>
            <p className="text-xs text-gray-400 mt-1">Pregunta en el CEDIS si ya se generaron las rutas.</p>
          </div>
        )}

        {!!paradas.length && (
          <>
            {/* ═══ RESUMEN — mismas tarjetas que el dispatcher y ventas, en dos
                columnas porque esto se ve en un celular ═══ */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                // Cuenta TODO lo que falta, incluida "la que sigue". `pendientes`
                // ya no sirve aquí: excluye la de arriba para no repetirla en la
                // lista, y usarla dejaría al chofer con un "por entregar" uno
                // menos de lo que de verdad le falta.
                { etiqueta: 'Por entregar', valor: porReportar.length, clase: porReportar.length ? 'text-orange-600' : 'text-gray-300' },
                // Solo las completas: este recuadro y "Con problema" tienen que
                // sumar las paradas hechas sin encimarse, o los cuatro números
                // no cuadran entre sí.
                { etiqueta: 'Completas', valor: completas, clase: 'text-emerald-600' },
                { etiqueta: 'Con problema', valor: incompletas, clase: incompletas ? 'text-amber-600' : 'text-gray-300' },
                { etiqueta: 'Total del día', valor: paradas.length, clase: 'text-gray-800' },
              ].map((m) => (
                <div key={m.etiqueta} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 shadow-sm">
                  <div className={`text-2xl font-extrabold leading-none ${m.clase}`}>{m.valor}</div>
                  <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mt-1.5">{m.etiqueta}</div>
                </div>
              ))}
            </section>

            {!puedeEntregar && ruta?.estado !== 'Finalizada' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[13px] font-bold text-amber-900">Todavía no sales del CEDIS</p>
                  <p className="text-[12px] text-amber-800 leading-snug mt-0.5">
                    Puedes ver tus paradas y tus productos, pero no reportar entregas hasta
                    que te den Salida en el almacén.
                  </p>
                </div>
              </div>
            )}

            {/* ═══ LA QUE SIGUE ═══ */}
            {siguiente ? (
              <section>
                <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2 px-1">La que sigue</h2>
                <TarjetaParada parada={siguiente} destacada puedeEntregar={puedeEntregar} onAbrir={() => setAbierta(siguiente)} />
              </section>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                <PackageCheck className="w-7 h-7 mx-auto mb-2 text-emerald-600" />
                <p className="text-sm font-extrabold text-emerald-800">Terminaste tus {paradas.length} entregas</p>
                <p className="text-xs text-emerald-700 mt-0.5">Ya puedes regresar al CEDIS.</p>
              </div>
            )}

            {/* ═══ MAPA — al centro, igual que en ventas ═══ */}
            <section className="space-y-2">
              <button
                onClick={() => setVerMapa((v) => !v)}
                className="w-full flex items-center gap-2 px-1"
              >
                <MapIcon className="w-3.5 h-3.5 text-orange-500" />
                <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Mi ruta en el mapa</h2>
                <span className="ml-auto text-gray-400">
                  {verMapa ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </span>
              </button>
              {verMapa && (
                <MapaRuta paradas={paradas} siguiente={siguiente} miPosicion={miPosicion} />
              )}
            </section>

            {/* ═══ POR ENTREGAR ═══ */}
            {pendientes.length > 0 && (
              <section>
                {/* "Las demás" y no "Por entregar": el recuadro de arriba ya usa
                    ese nombre para el total, y aquí van las que quedan DESPUÉS
                    de la que sigue. Dos números distintos con la misma etiqueta
                    en la misma pantalla se leen como un error del sistema. */}
                <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2 px-1">
                  Las demás ({pendientes.length})
                </h2>
                <div className="space-y-2">
                  {pendientes.map((p) => (
                    <TarjetaParada key={p.id} parada={p} puedeEntregar={puedeEntregar} onAbrir={() => setAbierta(p)} />
                  ))}
                </div>
              </section>
            )}

            {/* ═══ YA REPORTADAS — cerrado: ya no hay nada que hacer con ellas ═══ */}
            {!!reportadas.length && (
              <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setVerHechas((v) => !v)}
                  className="w-full flex items-center gap-2 px-4 py-3 active:bg-gray-50 text-left"
                >
                  <Check className="h-4 w-4 text-emerald-600" />
                  <h2 className="text-sm font-bold text-gray-800">Ya reportadas</h2>
                  <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {reportadas.length}
                  </span>
                  <span className="ml-auto text-gray-400">
                    {verHechas ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                </button>
                {verHechas && (
                  <div className="p-3 pt-0 space-y-2">
                    {reportadas.map((p) => (
                      <TarjetaParada
                        key={p.id}
                        parada={p}
                        puedeEntregar={puedeEntregar}
                        onAbrir={() => setAbierta(p)}
                        evidenciaPendiente={evidenciaPendiente[p.id]}
                        subiendoEvidencia={subiendoEvidencia === p.id}
                        onReintentarEvidencia={() => reintentarEvidencia(p.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {abierta && (
        <HojaEntrega
          parada={abierta}
          puedeEntregar={puedeEntregar}
          guardando={guardando}
          onCerrar={() => setAbierta(null)}
          onConfirmar={confirmar}
          motivos={config.motivos_no_entrega}
        />
      )}
    </div>
  );
}

/**
 * Una parada en la lista: todo lo que el chofer necesita antes de bajarse del
 * camión, y los atajos para llamar o abrir la navegación.
 */
function TarjetaParada({
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
          <div className={`text-[15px] font-extrabold leading-snug ${hecha ? 'text-gray-500' : 'text-gray-900'}`}>
            {parada.card_name}
          </div>
          <div className="text-[12px] text-gray-400 mt-0.5">{parada.address || 'Sin dirección'}</div>

          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
            {parada.eta_desde && (
              <span className="text-[11px] font-bold text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {parada.eta_desde}-{parada.eta_hasta}
              </span>
            )}
            {parada.ventana && <span className="text-[11px] text-gray-400">recibe {parada.ventana}</span>}
            <span className="text-[11px] text-gray-400">
              {parada.lineas.length} producto{parada.lineas.length === 1 ? '' : 's'}
            </span>
          </div>

          {estado && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border mt-2 ${estado.clase}`}>
              <Icono className="w-3 h-3" /> {estado.corto}
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
            className="flex-shrink-0 bg-amber-500 active:bg-amber-600 disabled:opacity-50 text-white font-bold text-[12px] px-3 py-2 rounded-lg"
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
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-bold text-gray-600 active:bg-gray-50"
            >
              <Phone className="w-3.5 h-3.5" /> Llamar
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
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-bold text-gray-600 active:bg-gray-50"
              >
                <Navigation className="w-3.5 h-3.5" /> Waze
              </a>
              <a
                href={enlaceMaps(parada.lat, parada.lng)}
                target="_blank"
                rel="noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-bold text-gray-600 active:bg-gray-50"
              >
                <MapIcon className="w-3.5 h-3.5" /> Maps
              </a>
            </>
          )}
          <button
            onClick={onAbrir}
            disabled={!puedeEntregar}
            title={puedeEntregar ? undefined : 'El camión todavía no sale del CEDIS'}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-extrabold text-orange-600 active:bg-orange-50 disabled:text-gray-300 disabled:active:bg-transparent"
          >
            <MapPin className="w-3.5 h-3.5" /> Entregar
          </button>
        </div>
      )}
    </div>
  );
}
