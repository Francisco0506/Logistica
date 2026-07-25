# Pendientes del proyecto

Lista viva de lo que falta. Actualizada el **25 de julio de 2026**.

El detalle de alcance de los paneles de Vendedor y Chofer está aparte, en
[`pendientes-vendedor-chofer.md`](pendientes-vendedor-chofer.md).

Prioridad: 🔴 bloquea · 🟡 importante · ⚪ cuando se pueda

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

- 🔴 **La identidad del camión.** La base guarda `T-001`, `T-002`… en vez de la
  placa. Eso vuelve **inservibles los reportes históricos**: consultar Postgres
  por lo que hizo la flota el mes pasado no dice qué camión fue, porque a qué
  unidad correspondía cada `T-00X` dependía de cuáles estaban prendidos en el
  navegador ese día. *(En proceso — rama `reestructura`.)*
- 🔴 **Las capacidades se toman por posición, no por camión.** Si en el panel se
  apaga un camión y se prende otro, el optimizador planea con la capacidad del
  que se apagó. No avisa nada. *(En proceso — misma rama.)*
- 🟡 **Confirmar capacidades contra la tarjeta de circulación.** Hoy salen del
  VIN que reporta Samsara contra la ficha de Isuzu México. Los 8 VIN están en
  [`flota.md` §6](flota.md). Ojo con el **013**: se tenía como 2 ton y el VIN
  dice ELF 100 = **1.5 ton**.
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

- 🔴 **Conectar SAP en producción.** En la computadora personal las credenciales
  están vacías y todo corre con pedidos de prueba.
- 🔴 **Peso real por pedido.** Sin él, la restricción de kilos del optimizador
  corre con `PESO_ESTIMADO_KG = 150` inventado y **no puede garantizar que un
  camión no salga sobrecargado**. La consulta ya está escrita (suma de
  `cantidad × OITM.SWeight1` por línea, `sync.py`); falta que los artículos
  tengan el peso capturado en su ficha.
- 🟡 **Corregir 4 destinos con la hora mal capturada** (les falta el PM):
  LA PARMESANA "08:00-06:00", Santo Chickn Gpe "09:00-03:00", WYNDHAM MONTERREY
  "09:00-05:00", BARBARO "08:00-00:00". El optimizador las ignora y usa el turno
  completo, pero conviene arreglarlas en el origen.
- 🟡 **Narciso Cafetería recibe 07:00–09:00** y el primer camión sale ~09:06.
  Es imposible de atender con la operación actual: hay que negociar la ventana o
  aceptar que no entra.
- ⚪ **UDF de contacto, teléfono y referencias**: no existen en `CRD1`. El código
  ya los lee si algún día se configuran; hoy los 195 destinos los tienen vacíos.
- ⚪ **Segunda ventana de recibo**: el código ya la usa (commit `397d30e`), pero
  en la base local hay **0 destinos con segunda ventana**, así que ese arreglo
  no se ha podido probar con datos reales.

## 4. Ruteo (OSRM)

- 🔴 **Procesar el mapa y prender el OSRM propio.** El archivo
  `mexico-latest.osm.pbf` está descargado (357 MB) pero **nunca se procesó**, así
  que `OSRM_BASE` sigue comentado y todo corre contra el servidor público de
  demostración.
- 🔴 **Consecuencia directa:** el público **acepta máximo 100 paradas**. Con ~77
  pedidos de día normal se va raspando; un día pico de 139 lo cruza. Es decir,
  **el día más cargado —justo cuando más se ocupa el optimizador— es el día que
  se cae a línea recta**, y entrega rutas de aspecto normal con el orden de las
  paradas mal.
- 🟡 **Aplicar el factor de calibración (~1.25).** OSRM cree que la flota va a
  52.9 km/h cuando el GPS dice 42.3. El plan mete ~18 paradas donde caben ~15.
  **Ya se ve en los datos**: las rutas guardadas del 19-jul tienen 23, 23, 20, 18
  y 17 paradas contra las 15.5 reales. Ver
  [`calibracion-tiempos-osrm.md`](calibracion-tiempos-osrm.md).
  Hay que **re-medir el factor** al prender el OSRM propio, porque otro perfil da
  otros tiempos.
- ⚪ Hoy tampoco se evitan casetas: el servidor público rechaza `exclude=motorway`.

## 5. Antes de producción

- 🔴 **`SECRET_KEY` está escrita en `core/settings.py`** y ese archivo sí está en
  GitHub. Debe salir del `.env` y hay que **generar una nueva**, porque la actual
  ya es pública.
- 🔴 **`DEBUG = True`** — muestra el código y las variables de entorno en
  cualquier error.
- 🔴 **`CORS_ALLOW_ALL_ORIGINS = True`** y `ALLOWED_HOSTS = []`.
- 🔴 **El login no valida nada.** Es un selector de rol: quien abra la URL entra.
- 🟡 **Apagar el botón "Cargar pedidos de prueba" fuera de desarrollo.** Borra
  todas las rutas del día, **incluidas las ya despachadas**.
- 🟡 **No hay entorno virtual ni versiones fijadas** de las librerías de Python.
  Hoy corre contra la instalación global (Python 3.14).
- 🟡 **No hay ni una prueba automatizada** en todo el proyecto. El optimizador
  tiene reglas delicadas (ventanas de medianoche, rutas congeladas, ETAs) que
  hoy solo se verifican a mano.
- ⚪ **El Excel de direcciones tiene datos reales de clientes y está en el
  repositorio.** Si el repo es privado no pasa nada; si algún día se hace
  público, ahí va la lista de clientes de Laben.

## 6. Interfaz

- 🟡 **El panel de ventas se hace desde cero.** Lo que hay son 4 pedidos
  inventados escritos a mano; no llama al backend ni una vez.
- 🟡 **`DispatcherPanel.jsx` son 1,173 líneas en un solo archivo** — header,
  camiones, alertas, tabla, manifiesto, mapa y modal, todo junto.
- 🟡 **La ventana de recibo del cliente no se muestra en ninguna parte**, aunque
  los 195 destinos la tienen capturada. Es justo el dato que explica por qué las
  rutas van apretadas (97 de 195 cierran antes de las 14:00).
- 🟡 **Apagar un camión no libera sus pedidos de verdad**: se marcan pendientes
  solo en pantalla y el auto-refresco de 45 s los regresa como estaban.
- ⚪ **La app del chofer está en pausa** (una pantalla que dice "en pausa"). Lo
  que se necesita: entrega parcial, motivo de no entrega, firma de quien recibe,
  foto de evidencia, y que funcione en celular.
- ⚪ **El botón "Descargar Guía" del manifiesto no descarga nada**, solo muestra
  un aviso.

## 7. Basura acumulada

- ⚪ **Dos rutas colgadas en `En_Ruta` del 18-jul** que nunca se finalizaron.
- ⚪ **La rama `worktree-dispatcher-overhaul`** en GitHub quedó abandonada; su
  contenido ya llegó a `main` por otro camino.
