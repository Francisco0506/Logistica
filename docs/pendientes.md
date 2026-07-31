# Pendientes del proyecto

Lista viva de lo que falta. Actualizada el **31 de julio de 2026**.

El detalle de alcance de los paneles de Vendedor y Chofer está aparte, en
[`pendientes-vendedor-chofer.md`](pendientes-vendedor-chofer.md).

Prioridad: 🔴 bloquea · 🟡 importante · ⚪ cuando se pueda

> **Lo más importante de todo, medido el 27-jul-2026:** el proyecto no está
> trabado en programación, está trabado en **captura de direcciones**. El
> optimizador acomoda el 98% de lo que alcanza a ver y los camiones van al 14%
> de su capacidad de peso; lo que no puede es rutear a un cliente sin
> coordenada, y hoy son dos de cada tres. Ver §3.
>
> El otro dato que cambia el plan: los 5 camiones dan para ~100 paradas por
> turno y el lunes pico pide 133. Hoy no se nota porque solo se ven 57.

---

## 1. Choferes — quién maneja qué

🔴 **No existe el dato de qué persona maneja cada camión.** Hoy el nombre se
escribe a mano en el panel y **se borra al recargar la página**: solo vive en el
navegador (`changeDriver` en `DispatcherPanel.jsx` no guarda nada en la base).
Lo que sí queda guardado es un texto inventado, "Chofer 1", que pone el
optimizador al crear la ruta.

Falta decidir y conseguir:

- La lista de choferes: nombre y, si existe, algún identificador de nómina.
- Si un chofer trae siempre la misma unidad o rota. Eso cambia el diseño: unidad
  fija = el chofer es un campo del camión; rotación = hay que asignarlo por día.
- Si se quiere historial ("quién manejó el 027 el martes pasado"), tiene que
  guardarse en la ruta, no en el camión.
- Si los choferes van a usar la app del chofer, cada uno necesita usuario —
  eso se cruza con el login, que hoy no valida nada (ver §5).

**Mientras tanto:** el campo sigue siendo texto libre y volátil. Hasta no tener
la lista real no vale la pena construir la tabla, porque el diseño depende de
las respuestas de arriba.

## 2. Flota y camiones

- ✅ ~~**La identidad del camión.**~~ La ruta ya se guarda con la **placa real**.
  Se acabó el `T-001`, y con él la traducción que hacía el frontend. Ojo: las
  rutas guardadas **antes** de este cambio siguen diciendo `T-00X` y no hay forma
  de saber a qué unidad correspondían (eran todas de prueba, no se perdió nada
  real).
- ✅ ~~**Las capacidades por posición.**~~ Al optimizar se mandan las **placas**
  de los camiones activos, y la capacidad y el tope de paradas salen de la ficha
  de cada uno. Verificado: apagando el 027 y prendiendo el 024, el plan usa el
  024 con sus 25 paradas de tope, no las 29 del 027.
- ✅ ~~**La revisión de peso al asignar a mano usaba 3,000 kg para todos.**~~
  Ahora usa la capacidad real de la unidad de esa ruta.
- 🟡 **El chofer sigue viviendo solo en el navegador** y se borra al recargar
  (ver §1). La ruta ya no guarda el "Chofer 1" inventado: guarda vacío, que es
  la verdad.
- 🟡 **Confirmar capacidades contra la tarjeta de circulación.** Hoy salen del
  VIN que reporta Samsara contra la ficha de Isuzu México. Los 8 VIN están en
  [`flota.md` §6](flota.md). Ojo con el **013**: se tenía como 2 ton y el VIN
  dice ELF 100 = **1.5 ton**.
- 🔴 **No salen 5 camiones: salen 4, y en promedio 3.** Medido con GPS de
  Samsara, 20 al 27-jul:

  | Día | Salieron | Cuáles |
  |---|---|---|
  | lunes 20 | 4 | 027, 023, 017, 013 |
  | martes 21 | 4 | 013, 017, 027, 023 |
  | miércoles 22 | 4 | 027, 013, 017, 023 |
  | jueves 23 | 4 | 027, 023, 013, 017 |
  | viernes 24 | 3 | 027, 023, 013 |
  | sábado 25 | 2 | 013, 023 |

  **El 016 (RJ97892) no tiene UN SOLO punto de GPS en 7 días**, y sin embargo
  `fleet.py` lo trae con `activo_default: True`, así que el panel arranca
  contando con él. Hay que averiguar si está descompuesto, si el GPS está
  desconectado, o si simplemente no opera — y apagarlo mientras tanto.

  **Esto cambia la cuenta de capacidad:** con 4 camiones son ~80 paradas por
  turno, no ~100. El lunes pico pide 133. El hueco es más grande de lo que decía
  el cálculo con 5 unidades.

- 🟡 **Decidir qué pasa con 024, 015 y 012.** El 024 lleva parado en Guadalupe
  desde el 14-jul; el 015 y el 012 llevan dos meses sin operar (9 km y 0 km en
  60 días). ¿Descompuestos, vendidos, reserva? Si no van a operar, conviene
  sacarlos del sistema.
- ⚪ **Aclarar el caso del 023 del sábado 18-jul**: salió, se quedó 5.5 horas
  parado en el Periférico y pernoctó en García sin regresar al CEDIS. ¿Taller?
  ¿El chofer se lleva la unidad?
- ⚪ **Los camiones que se agregan con "+ Agregar camión" desaparecen al
  recargar.** El backend nunca se entera de que existen.

## 3. Datos que faltan de SAP

- ✅ ~~**Conectar SAP en producción.**~~ Probado el 27-jul contra
  `DB_LABEN_PRODUCTIVA`: se bajaron **17 pedidos reales**, el optimizador armó
  rutas con ellos y los kilos cuadraron. Es la primera corrida del sistema con
  datos de verdad. El `.env` quedó apuntando de vuelta a la base de pruebas para
  no jalar producción sin querer.

- 🔴 **LAS DIRECCIONES SON EL ÚNICO TAPÓN DEL PROYECTO.** No es exageración: el
  sistema funciona y los camiones van vacíos, pero no sabe a dónde llevar dos
  terceras partes de la carga.

  SAP productiva tiene coordenada en **1 Ship-To de 3,528**. Las que usa el
  sistema vienen del Excel que se importó, no de SAP.

  El desglose de cobertura (`DESGLOSE_COBERTURA.xlsx`, hecho con órdenes de
  entrega de junio-julio, corte al 21-jul — verificado contra SAP destino por
  destino: 579 de 620 cuadran exactos) reparte los 620 destinos así:

  | Etapa | Destinos | Paradas del lunes pico | Cobertura acumulada |
  |---|---|---|---|
  | YA CARGADA EN SAP | 217 | 57 | **43%** |
  | LISTA PARA CARGAR | 136 | 38 | **71%** |
  | FALTA HORARIO | 40 | 15 | **83%** |
  | SIN TRABAJAR | 227 | 23 | **100%** |

  **El paso que más rinde es cargar las 136 que ya están listas: sube la
  cobertura de 43% a 71% sin escribir una línea de código.**

  Medido con el lunes 20-jul (día pico, 171 entregas): el optimizador ruteó 59
  de las 60 que tenían coordenada, con el camión más cargado en 840 kg de 6,000.
  Ni la capacidad ni el algoritmo son el problema.

- 🔴 **El despachador está pidiendo el día equivocado.** ~~La captura de la
  entrega tiene que adelantarse~~ — resuelto al medir el ciclo completo, ver
  [`flujo-documentos-sap.md`](flujo-documentos-sap.md).

  **La entrega capturada hoy sale mañana.** El panel se veía vacío en la mañana
  porque pedía las entregas *de hoy*, que a las 9 am apenas empiezan a existir
  (0 a las 09:49 del 28-jul, 27 a las 10:48). Lo que sale esa mañana se capturó
  ayer y ya está completo desde anoche.

  **Falta cambiarlo:** que el panel abra con el último día con captura en vez de
  con hoy, y que lo diga claro ("Entregas del 27-jul — salen hoy 28"). No hace
  falta mover la hora de captura de almacén: el problema era del sistema, no de
  la operación.

  **Decidido (Francisco y Sebastián, 27-jul-2026): el planeador trabaja SIEMPRE
  con órdenes de entrega. No es negociable y no hay ruta alterna por órdenes de
  venta.** Es lo correcto: la entrega es la mercancía que de verdad sube al
  camión, y para el 27-jul había 17 órdenes de venta abiertas contra 73
  entregas. Un día normal trae ~100 entregas de reparto real.

  El código ya quedó así. Lo que falta es del lado de la operación: medido el
  lunes 20-jul, **a las 9 de la mañana —cuando salieron los camiones— existía
  UNA sola orden de entrega**. Las 181 del día se capturaron entre las 12 y las
  7 de la noche.

  Mientras la captura siga siendo por la tarde, **el panel se ve vacío justo en
  la mañana, que es cuando se ocupa**. No es una falla del sistema: es que el
  documento con el que se planea todavía no existe a esa hora.

  **Lo que hay que definir:** a qué hora queda capturada la entrega, y que esa
  hora sea antes de que salgan los camiones.

- 🔴 **La base productiva NO tiene las ventanas de recibo ni los días de
  entrega.** Los UDF `U_IniRecibo1`, `U_FinRecibo1`, `U_EntLun`…`U_EntSab`
  existen en `CRD1` de la base de **pruebas** —se crearon para este proyecto—
  pero **en productiva solo están `U_Latitud` y `U_Longitud`**. O sea que contra
  producción el sistema planea como si todos los clientes recibieran a cualquier
  hora y cualquier día.

  Esto además tumbaba el sync entero con "Invalid column name" y el despachador
  se quedaba sin pedidos sin saber por qué. Ya se corrigió: `sync.py` pregunta
  primero qué columnas existen y trabaja con lo que haya. Pero **el dato sigue
  sin existir en producción** y hay que crearlo ahí.
- ✅ ~~**Peso real por pedido — este pendiente marca el calendario.**~~
  **Resuelto el 27-jul-2026, y no era lo que parecía.**

  Se creía que faltaba capturar el peso de ~900 artículos y que esa captura
  mandaba el calendario. Medido contra la base **productiva**: de los **340
  artículos que de verdad se mueven, solo 11 no tienen peso**, y de esos 7 se
  rescatan de otras fuentes (peso de compra, o el peso que ya viene en la
  descripción: "1 / 1.89 KG"). **Faltan 4 por capturar**, y dos ni son producto:

  | Renglones | Código | Qué es |
  |---|---|---|
  | 8 | `1330071` | Salsa Red Hot Buffalo Wing 3.78 LT |
  | 1 | `2122079` | Queso Edam cuña 1 KG |
  | 2 | `HC` | datos bancarios metidos como artículo |
  | 1 | `A0356` | una cubicadora (activo, no mercancía) |

  **El problema real era otro, y era del código:** `OITM.SWeight1` no es el peso
  de la pieza, es el de la **unidad de venta** (la caja). Y `RDR1.Quantity` viene
  en la unidad del renglón, que no siempre es esa — el mismo artículo se pide
  unas veces por caja y otras por pieza suelta. La fórmula
  `Quantity × SWeight1` contaba 2 barras de mantequilla como 2 cajas de 30.

  Medido sobre 12,937 renglones de 60 días: reportaba **1,457,832 kg contra
  808,469 kg reales (1.8x)**, con hasta **36x** en el peor pedido. Solo el 4% de
  los renglones estaba mal, pero eran justo los de miles de piezas.

  Corregido en `sync.py`: `InvQty × (SWeight1 / NumInSale)`. Verificado contra
  los pedidos reales del 27-jul — los kilos cuadran con lo que anuncia la
  descripción de cada producto (una caja de 6 quesos de 2.3 kg = 13.62 kg).

  **Pendiente chico:** revisar el peso del paquete de cajas para pizza
  (`CAJA PARA PIZZA PDP`), que da 15 kg por paquete y en un solo pedido suma
  900 kg. Puede estar bien o mal capturado.
- 🟡 **Corregir 4 destinos con la hora mal capturada** (les falta el PM):
  LA PARMESANA "08:00-06:00", Santo Chickn Gpe "09:00-03:00", WYNDHAM MONTERREY
  "09:00-05:00", BARBARO "08:00-00:00". El optimizador las ignora y usa el turno
  completo, pero conviene arreglarlas en el origen.
- 🟡 **Narciso Cafetería recibe 07:00–09:00** y el primer camión sale ~09:06.
  Es imposible de atender con la operación actual: hay que negociar la ventana o
  aceptar que no entra.
- 🟡 **Cuánto tarda una parada con varios clientes.** Cuando el camión llega a
  un domicilio donde entrega a varios (PROVEO PARQUE MARTEL son cuatro razones
  sociales, EL SURTIDOR tres, y hay pares como `C587-44`/`C587-45` que facturan
  aparte pero entregan en la misma puerta), **no tarda 12 min por cliente** —
  se estaciona una vez. El optimizador ya lo cuenta como **una parada de 12
  min**, que es lo que Samsara midió: sus 11.7 min son tiempo detenido en un
  punto, así que esos casos ya están dentro del promedio.

  Lo que falta medir es **cuánto más** tarda esa parada por cada entrega extra
  (papeleo y firma de cada una). Francisco (25-jul-2026): *"no creo que se tarde
  12, 12, 12, 12, a lo mejor sí un poco más"*. **Samsara no lo puede decir**,
  porque solo ve que el camión estuvo detenido; hay que medirlo en piso o
  capturarlo desde la app del chofer cuando exista.

  Con los pedidos del 25-jul: **120 documentos = 105 paradas reales**. Antes se
  planeaban 120, o sea **168 minutos de descarga que en la calle no existen**,
  repartidos entre 5 camiones.
- ⚪ **Vale la pena revisar en SAP** algunos Ship-To que parecen captura
  duplicada de verdad (no facturación aparte): `MALIS` / `MALÍS`,
  `Pizza Deprizza Juárez Centro` / `PIZZA DEPRIZZA JUAREZ CENTRO`,
  `Valle de Lincoln` con `DEPRRIZZA` (R de más). El ruteo ya no se ve afectado
  —agrupa por coordenada— pero ensucian reportes y listados.
- 🔴 **Los días de entrega no se respetan — y ahora sí va a doler.** Con 57
  paradas visibles sobra capacidad y mandar un camión a un cliente cerrado no se
  nota. Cuando la cobertura suba a 95 o 133 paradas contra las ~100 que dan los
  cinco camiones, cada parada desperdiciada es una que sí ocupaba otro cliente. `Destino` guarda `ent_lun`…`ent_sab`
  y se llenan desde SAP y desde el Excel, pero **el optimizador nunca los lee**.
  Hoy **68 de 195 destinos** tienen algún día restringido (casi todos "no reciben
  sábado") y el sistema les planea entregas ese día igual.
- 🔴 **Pizza DePrizza: la regla real no está en los datos.** Los **52 destinos**
  con `card_code` que empieza en `C587` en la práctica **solo se surten martes y
  jueves**, pero en el sistema aparecen recibiendo los seis días. De hecho
  **ningún** destino de los 195 está marcado como "solo martes y jueves". Hay que
  capturarlo en SAP; sin ese dato, arreglar el código de arriba no alcanza.
- ⚪ **UDF de contacto, teléfono y referencias**: no existen en `CRD1`. El código
  ya los lee si algún día se configuran; hoy los 195 destinos los tienen vacíos.
- ⚪ **Segunda ventana de recibo**: el código ya la usa (commit `397d30e`), pero
  en la base local hay **0 destinos con segunda ventana**, así que ese arreglo
  no se ha podido probar con datos reales.

## 4. Ruteo (OSRM)

- ✅ ~~**Procesar el mapa y prender el OSRM propio.**~~ Ya estaba hecho desde el
  21-jul; el documento se quedó atrás. Verificado el 27-jul: el servidor propio
  responde en `localhost:5001` y `OSRM_BASE` está puesto en el `.env`.
- ✅ ~~**El límite de 100 paradas.**~~ Probado con **200 paradas: responde en
  2.1 s**. El límite era del servidor público, y ya no se usa.
- ✅ ~~**Hoy tampoco se evitan casetas.**~~ El servidor propio sí acepta
  `exclude=motorway`, así que la exclusión de autopistas de cuota ya es real.
- ✅ ~~**Aplicar el factor de calibración (~1.3).**~~ Aplicado el 27-jul, pero
  **el 1.3 se quedaba corto y el factor no es plano**.

  Medido contra **307 viajes reales** reconstruidos del GPS de Samsara (7 días):
  se detectó cada parada de 2.5 min o más y se comparó el tiempo real de puerta
  a puerta contra lo que dice OSRM del mismo tramo.

  | Tramo | min OSRM | min real | Factor |
  |---|---|---|---|
  | 0–2 km | 183 | 421 | 2.30 |
  | 2–5 km | 529 | 921 | 1.74 |
  | 5–10 km | 488 | 987 | 2.02 |
  | 10–20 km | 474 | 734 | 1.55 |
  | 20+ km | 1,522 | 2,178 | 1.43 |
  | **Todos** | 3,196 | 5,242 | **1.64** |

  Entre más corto el tramo, más castigado: el semáforo y la maniobra pesan más
  que el manejo. Por eso se interpola por distancia en vez de usar un número
  solo. Va en `routing_service.factor_trafico`, junto con el `round()` en vez de
  `int()` (medido: truncar regalaba 0.50 min por tramo).

  **Ojo con el umbral de parada:** subirlo a 8 min inflaba el factor a 2.12
  porque empezaba a contar tiempo de entrega como viaje. A 2.5 min una entrega
  (~12 min) nunca se cuenta como viaje y un semáforo sí, que es lo correcto.

  **Falta afinarlo:** son 7 días de datos y el bucket de 5–10 km rompe la
  tendencia con solo 55 tramos — puede ser ruido. Con 21 días quedaría firme.
- 🔴 **La hora de salida no es 09:00.** Medido: 07:03, 07:11, 09:25 y 13:49 en
  días consecutivos, y hasta 2.5 h de diferencia entre camiones el mismo día. Las
  ETAs ya se corrigen al dar Salida, pero **las ventanas de recibo se evalúan
  contra las 09:00 teóricas**, así que el optimizador acepta o rechaza pedidos
  por una razón equivocada.
- ⚪ Hoy tampoco se evitan casetas: el servidor público rechaza `exclude=motorway`.

## 5. Antes de producción

- 🔴 **Dónde va a vivir el sistema. Esto es lo primero y no está decidido.**
  Hoy todo corre en la computadora personal. Para que un chofer abra su celular
  en la calle y vea sus paradas, el servidor tiene que estar en un lugar que su
  teléfono alcance — un equipo en la oficina con acceso desde fuera, o algo
  rentado. **Hasta que eso exista, nadie más que Francisco puede usar esto**, por
  bien que funcione el código.

  Es la decisión que destraba las demás: los cuatro puntos de seguridad de abajo
  solo importan —y solo se pueden probar— cuando el sistema está expuesto. Y si
  hay que comprar o solicitar el equipo, esa gestión pesa más en el calendario
  que todo lo que falta programar.

- ✅ ~~**`SECRET_KEY` está escrita en `core/settings.py`**~~ — sale del `.env` y
  el backend no arranca sin ella. La vieja quedó quemada y no se debe reusar.
- ✅ ~~**`DEBUG = True`**~~ — se controla por `.env` (`DJANGO_DEBUG=False` en
  producción).
- ✅ ~~**`CORS_ALLOW_ALL_ORIGINS = True`**~~ — ahora vale lo mismo que `DEBUG`.
  En producción solo se aceptan los orígenes de `CORS_ORIGINS` del `.env`.
  Antes era `True` fijo con un comentario que decía "solo para desarrollo", y
  nada lo apagaba al salir de desarrollo.
- 🔴 **El login no valida nada.** Es un selector de rol: quien abra la URL entra.
- 🟡 **Apagar el botón "Cargar pedidos de prueba" fuera de desarrollo.** Borra
  todas las rutas del día, **incluidas las ya despachadas**.
- 🟡 **No hay entorno virtual ni versiones fijadas** de las librerías de Python.
  Hoy corre contra la instalación global (Python 3.14).
- ✅ ~~**Cero pruebas automatizadas.**~~ **88 pruebas** en `delivery/tests/`,
  todas verdes, en 35 s y sin necesitar Postgres, SAP ni OSRM:

  ```bash
  cd backend
  OPTIMIZER_SEGUNDOS=3 DJANGO_TEST_DB=sqlite python manage.py test delivery
  ```

  Cubren lo que estaba en esta lista y más: ventanas (medianoche, segunda
  ventana, horario corrupto, ventana después del turno), que una ruta
  despachada jamás se destruya, que dos clientes en el mismo domicilio sean UNA
  parada, que un pedido que no cupo regrese limpio a `Pendiente`, que el sync
  no borre lo que va en un camión, y que cada endpoint conteste.

  **Se verificó que sirven**: se volvieron a meter cuatro de los bugs
  arreglados y las pruebas los cazaron. Una prueba que pasa con el código roto
  no es una prueba.

  Lo que **falta** cubrir: el frontend no tiene ninguna (no hay corredor de
  pruebas instalado), y `recalcular_etas_desde_salida` solo está cubierta de
  refilón.
- 🔴 **Cero autenticación.** Ninguna mención de login, permisos ni sesión en los
  587 renglones de `api.py`. Cualquiera en la red que sepa la dirección puede
  rehacer el plan del día — o llamar a `/pedidos/cargar-prueba`, que **borra
  todas las rutas de una fecha, incluidas las ya despachadas**.
- 🔴 **Los errores se pierden en silencio.** No hay una sola línea de registro
  en todo el backend: cada falla regresa un diccionario y ahí muere. Si SAP
  truena a las 6 de la mañana nadie se entera hasta que alguien mire la
  pantalla, y no queda constancia de qué pasó.
- 🟡 **Dos despachadores al mismo tiempo se pisan.** Si dos aprietan Optimizar a
  la vez, el segundo borra las rutas en borrador del primero a media corrida.
- 🟡 **El optimizador bloquea la petición**: 20 s una corrida normal, ~30 s el
  análisis de escenarios. Debería correr aparte y avisar al terminar.
- ⚪ **Estructura del backend**: `optimizer.py` (859 líneas) hace cuatro
  trabajos — armar el modelo, resolver, recalcular ETAs y asignar a mano — y
  `api.py` va en 587. Convendría partirlos y agrupar lo que habla con el
  exterior (SAP, Samsara, OSRM) en `integrations/`. Es cosmético al lado de lo
  de arriba.
- 🟡 **El Excel de direcciones salió del repositorio** (31-jul-2026), junto con
  el comando `importar_direcciones_excel`: ya no se usa, la fuente de verdad es
  SAP. **PERO sigue en el HISTORIAL de git.** Si este repo se va a hacer
  público alguna vez, hay que limpiarlo del historial con `git filter-repo`;
  borrarlo de la rama no basta.

## 6. Interfaz

- 🟡 **El panel de ventas se hace desde cero.** Lo que hay son 4 pedidos
  inventados escritos a mano; no llama al backend ni una vez.
- 🟡 **`Dispatcher/index.jsx` son 880 líneas y ~40 `useState`.** Los
  componentes de presentación ya se partieron; lo que falta es sacar el ESTADO
  a hooks (`useFlota`, `useJornada`, `useDatosDelDia`, `useOptimizacion`,
  `useAsignacionManual`). Hay un plan de 8 pasos, cada uno compilable por
  separado, en la bitácora del 31-jul. Los bugs de carrera del archivo ya se
  arreglaron uno por uno; el refactor es para que no vuelvan a aparecer.
- 🟡 **La ventana de recibo del cliente no se muestra en ninguna parte**, aunque
  los 195 destinos la tienen capturada. Es justo el dato que explica por qué las
  rutas van apretadas (97 de 195 cierran antes de las 14:00).
- 🟡 **Apagar un camión no libera sus pedidos de verdad**: se marcan pendientes
  solo en pantalla y el auto-refresco de 45 s los regresa como estaban.
- ✅ ~~**La app del chofer**~~ ya existe y funciona en celular: sus paradas en
  orden con los productos de cada pedido, entrega completa en un toque, entrega
  incompleta renglón por renglón con motivo y nota, foto de evidencia, y no deja
  reportar antes de que el camión salga del CEDIS.
- ✅ ~~**Falta la FIRMA de quien recibe**~~ — la app del chofer abre un recuadro
  donde el cliente firma con el dedo y se guarda como PNG en `Remision.firma`.
  La ve el chofer, el panel de ventas y queda como evidencia de la entrega.
- ✅ ~~**El botón "Descargar Guía"**~~ ahora abre la vista previa de la guía y se
  imprime, con el logo de Laben y el orden de carga LIFO.
- 🟡 **La guía no se descarga como archivo**, solo se imprime desde el navegador.

## 7. Basura acumulada

- ⚪ **Dos rutas colgadas en `En_Ruta` del 18-jul** que nunca se finalizaron.
- ⚪ **Los pedidos de prueba solo existen para un día a la vez.**
  `cargar_pedidos_prueba` reutiliza los folios `8500000+i` para cualquier fecha,
  y como el folio es único, cargar prueba para un día nuevo **mueve** los
  registros del día anterior en vez de crear otros. Se ve como si se hubieran
  borrado pedidos. Se arregla incluyendo la fecha en el folio.
- ⚪ **La rama `worktree-dispatcher-overhaul`** en GitHub quedó abandonada; su
  contenido ya llegó a `main` por otro camino.
