# Bitácora: reestructura del proyecto

Todo lo que se hizo en esta sesión, por qué se hizo y dónde quedó.

**Fecha:** 25 de julio de 2026
**Rama:** `reestructura`
**Parte de:** `main` en `397d30e`
**Estado:** 7 commits, **sin subir a GitHub y sin fusionar a `main`**

---

## Dónde está todo

```
main          397d30e   intacta, igual que en GitHub — tu red de seguridad
reestructura  703cde1   todo el trabajo de esta sesión  ← estás aquí
```

`main` **no se tocó**. Si algo de esto no convence, se borra la rama y no pasó
nada. Para revisar la diferencia completa:

```bash
git diff main..reestructura           # todo el cambio
git log main..reestructura            # los 7 commits
git checkout main                     # volver a como estaba
```

Para publicarlo cuando estés conforme:

```bash
git push -u origin reestructura       # subirlo a GitHub sin fusionar
```

---

## Los 7 commits

| # | Commit | Qué hizo |
|---|--------|----------|
| 1 | `7b2dc8b` | Limpia código muerto y documenta qué se ocupa en producción |
| 2 | `d81a56f` | Lista de pendientes del proyecto por prioridad |
| 3 | `69e09b8` | El camión se identifica por placa, no por posición en una lista |
| 4 | `5abe8ec` | Explicaciones del sistema y hallazgo de los días de entrega |
| 5 | `1659658` | El sugeridor busca dónde SÍ cabe el pedido |
| 6 | `86ef424` | Parte el panel del despachador y arregla lo que no se veía |
| 7 | `887e074` | Panel de vendedor desde cero y Login en su carpeta |
| 8 | `703cde1` | Menos clics en el dispatcher y mapa en vivo para la vendedora |

---

## 1. Limpieza (`7b2dc8b`)

**Por qué:** había código que no se usaba y documentación que mentía.

| Qué se quitó | Por qué |
|---|---|
| `geocode_address()` en `routing_service.py` | Definida pero **nunca llamada**, y hacía justo lo que el proyecto había decidido no hacer: mandar direcciones de clientes a un servidor externo |
| Campo `window` de `RemisionOut` | Decía `"09:00 - 12:00"` para **todos** los clientes. Nadie lo llenaba y nadie lo leía: una mentira esperando a que alguien la mostrara |
| Default `eta = "09:30 AM"` | Otra hora falsa. Ahora dice `"Pendiente"` |
| `PARADAS_TIPICAS_POR_RUTA` | Constante que no se usaba en ningún cálculo |
| `frontend/README.md` | Plantilla de Vite tal cual, hablaba de TypeScript que no usamos |
| `frontend/dist/` | Build viejo del 19-jul |

**La regla que quedó:** *un valor por defecto nunca debe parecerse a un dato
real.* Si no sabemos algo, tiene que decir que no lo sabemos.

**Qué se agregó:** el `README.md` de raíz, que no existía, con la tabla de qué
carpeta va a producción y cuál no.

**Se arreglaron** dos referencias a `docs/uso-flota-samsara.md`, que no existe
(es `docs/flota.md`), y `docker/README.md`, que seguía diciendo que el backend
cae a SQLite cuando ese respaldo se quitó hace tiempo.

---

## 2. La flota por placa (`69e09b8`) — el cambio más importante

**El problema:** la flota vivía duplicada en dos archivos que había que
mantener sincronizados a mano, y el backend **no sabía qué camión era cuál**:
los llamaba `T-001`, `T-002`… y solo el frontend traducía esos códigos a placas.

**De dónde venía:** una mudanza a medias, rastreada en el historial de git.

| Cuándo | Qué pasó |
|---|---|
| 5-jul (`bbb89fb`) | Se agrega OR-Tools. **No había camiones reales**: `T-001` solo quería decir "vehículo 1 del solver" |
| 8-14 jul | Nacen las capacidades como **lista por posición**, coherente con ese mundo |
| 17-jul (`71abb64`) | **Llegan los ISUZU reales** con placa y Samsara… pero solo al frontend |

El backend nunca migró. `T-001` quedó como cicatriz de cuando los camiones no
existían.

**Las tres consecuencias, las tres arregladas:**

1. **Capacidades equivocadas sin avisar.** El panel mandaba solo *cuántos*
   camiones estaban activos y el backend tomaba los primeros N de la lista.
   Apagar el 027 y prender el 024 dejaba el plan corriendo con la capacidad y el
   tope de paradas **del 027**.
   *Verificado:* con `["PP4873A","PR6889B","RJ97892","RJ37663","PP4872A"]` el
   plan trae al 024 topado en sus 25 paradas y el 027 no aparece.

2. **El historial de Postgres era ilegible.** Las rutas se guardaban como
   `T-001`, y a qué unidad correspondía dependía de cuáles estaban prendidos en
   el navegador ese día. Ahora se guarda la placa. *Las rutas guardadas antes
   del cambio siguen diciendo `T-00X` y no hay forma de recuperarlas* — eran
   todas de prueba, no se perdió nada real.

3. **La revisión de peso usaba 3,000 kg parejo** para toda la flota al decidir
   si un pedido cabía: al 013 (1,500 kg) le decía que sí cabía yendo
   sobrecargado, y al 027 (6,000 kg) que no cabía con medio camión libre.

**Cómo quedó:** `backend/delivery/fleet.py` es la fuente única (placa, Samsara,
VIN, modelo, capacidad, tope de paradas, color, si arranca activo). El frontend
la pide con `GET /api/dispatcher/flota`. `ID_TO_PLATE` desapareció.

**También:** la ruta ya no guarda un chofer inventado (`"Chofer 1"`). Guarda
vacío, que es la verdad — quién maneja no es un dato que el sistema tenga.

---

## 3. El optimizador (`1659658`)

**El caso Mangioz.** Al asignar a mano un pedido suelto se evaluaba **una sola**
posición: la más barata en tiempo. Para un cliente que abre tarde eso siempre
cae a media mañana, así que salían todos los camiones en rojo aunque el pedido
sí cupiera más adelante en la ruta.

Ahora se evalúan **todas** las posiciones y se prefiere una donde el camión
llegue dentro de la ventana. *Medido con Mangioz (recibe 15:00-22:00): antes
sugería la posición 6 con llegada 10:47; ahora la 19, final de ruta, con llegada
14:23.*

**Dos correcciones más en el mismo cálculo:**

- La hora de llegada estimada **solo sumaba el manejo** entre paradas y se
  saltaba los 12 min de descarga de cada parada previa: con 10 paradas antes,
  **dos horas de error**. Y no cuadraba con la ETA que calcula
  `recalcular_etas_desde_salida`, que sí los suma.
- El motivo decía *"llegaría fuera de la ventana"* sin decir de qué lado. El
  caso común es llegar **demasiado temprano**, no tarde, y son problemas
  distintos: llegar temprano se resuelve esperando o metiéndolo más adelante;
  llegar tarde no se resuelve.

**Las horas pasaron a formato 24 h** en ETAs, hora de salida y ventanas, igual
que como se capturan en SAP.

---

## 4. El panel del despachador (`86ef424`, `703cde1`)

`DispatcherPanel.jsx` eran **1,173 líneas** con todo revuelto. Quedó como
orquestador y se extrajeron ocho componentes:

```
views/Dispatcher/
  DispatcherPanel.jsx          estado y composición
  components/
    HeaderDespacho.jsx         encabezado, fecha, estado de SAP
    TarjetaCamion.jsx          un camión con su avance
    EstadoDespacho.jsx         el paso a paso del despacho
    PanelSinAsignar.jsx        alertas y sugerencias
    TablaPedidos.jsx           los pedidos del día
    Manifiesto.jsx             orden de carga LIFO y peso
    MapaRutas.jsx              el mapa
    ModalForzar.jsx            confirmación de forzar
```

**Lo que cambió a la vista:**

| Antes | Ahora |
|---|---|
| `ESTADO: BORRADOR` con tres botones, dos siempre apagados | El camino completo (Borrador → Cargando → Listo → En ruta → Terminó), dónde estás, y **una sola acción** con su explicación |
| La ventana de recibo del cliente **no se veía en ningún lado** | Aparece en la tabla, en cada parada y en el manifiesto |
| El manifiesto no decía cuánto peso lleva | Barra de carga contra la capacidad de **esa** unidad, con aviso de sobrepeso |
| Las rutas en línea recta se veían iguales a las reales | Aviso en el mapa y traza **punteada** |
| El mapa se llevaba dos tercios de la pantalla | El panel toma 42% (52% en Pedidos y Manifiesto) |
| `Manifiesto` era sub-pestaña dentro de `Pedidos` | Las cuatro pestañas al mismo nivel |
| Solo un camión abierto a la vez | Varios a la vez, para comparar rutas |
| Había que abrir cada camión para ver cómo iba | La tarjeta muestra **sin abrirla** las entregas, el estado y la próxima parada |
| "Descargar Guía" fingía con un aviso | Deshabilitado con su motivo |

**Del peso:** cuando SAP no lo manda, el manifiesto **lo dice** en vez de
sustituirlo por el estimado de 150 kg del optimizador. Un peso inventado que se
ve como medido es justo lo que haría sobrecargar un camión con confianza.

---

## 5. El panel de vendedor (`887e074`, `703cde1`)

**Estaba:** 79 líneas con cuatro pedidos inventados escritos a mano
("Restaurante El Rey", "Hotel Central"), sin una sola llamada al backend, con un
buscador que no filtraba. Se rehizo completo.

**Quedó:** cada vendedora ve **solo sus pedidos**, filtrados por el `SlpCode`
que SAP ya trae en cada remisión.

- **La hora es un rango**, no una hora exacta: *"llega entre 09:00 y 09:15"*.
  Una hora al minuto suena a promesa que no se puede cumplir.
- **Cada pedido explica su situación** en lenguaje de vendedora, no en estados
  de base de datos: *"Programado en el RJ97892, llega entre 13:04 y 13:19"*,
  *"No se puede programar: al cliente le falta la ubicación en SAP"*, *"Todavía
  no entra en ninguna ruta de hoy"*.
- **Se agrupan por lo que urge:** En camino → Programados → Sin programar →
  Entregados.
- **Mapa** con sus clientes de colores por estado y el camión que lleva sus
  pedidos con su **posición real de Samsara**. Solo los camiones que llevan
  pedidos suyos, no la flota entera.
- Funciona en celular.

**Endpoints nuevos:** `GET /api/ventas/vendedores` y `GET /api/ventas/pedidos`.

**Un arreglo que salió de probarlo:** LA PARMESANA aparecía como *"recibe 08:00
- 06:00"* (le falta el PM en SAP). En pantalla eso parece un error del sistema y
no del dato. Ahora dice **"Horario mal capturado en SAP"**, que señala qué
arreglar y dónde. Aplica a los 4 destinos con ese problema.

**`Login.jsx`** se movió a `views/Login/Login.jsx` para que todas las vistas
tengan la misma forma. **El diseño no se tocó.**

---

## 6. Hallazgos que no se arreglaron (quedaron documentados)

| Hallazgo | Dónde quedó |
|---|---|
| **La `SECRET_KEY` de Django está en GitHub.** Es la llave con la que firma las sesiones. No basta moverla al `.env`: hay que **generar una nueva** | `pendientes.md` §5 |
| **El optimizador nunca lee los días de entrega.** 68 de 195 destinos tienen algún día restringido y se les planea igual. *(Bajado de prioridad: SAP solo trae pedidos por fecha, así que el día se resuelve solo)* | `pendientes.md` §3 |
| **El mapa `.pbf` está bajado pero nunca se procesó**, por eso OSRM_BASE sigue comentado y todo corre contra el servidor público | `pendientes.md` §4 |
| **OSRM es ~25% optimista.** Se ve en los datos: las rutas del 19-jul tienen 23/23/20/18/17 paradas contra las 15.5 reales | `calibracion-tiempos-osrm.md` |
| **Cero pruebas automatizadas** sobre lógica delicada | `pendientes.md` §5 |
| **La API no tiene autenticación** | `pendientes.md` §5 |
| **Los pedidos de prueba solo existen para un día a la vez**: cargar prueba para un día nuevo *mueve* los del anterior | `pendientes.md` §7 |

**El token de Samsara está seguro.** Verificado a fondo: `backend/.env` nunca
estuvo rastreado por git en ningún momento de la historia, y el valor del token
no aparece en ningún commit. `.env.example` tiene el campo vacío.

---

## 7. Lo que sigue

1. **Calcular desde la hora real de salida**, no las 09:00 teóricas. Es el
   hallazgo de Francisco sobre Mangioz: si el camión sale a las 11:00, todo se
   recorre y el pedido **sí cabría**. Hoy el sistema dice "no cabe" cuando la
   respuesta correcta es "no cabe *si sale a las 9*".
2. **Sacar de Samsara las horas de salida reales** por camión y usarlas
   dinámicamente, en vez de una constante.
3. **Que el optimizador principal busque el hueco**, como ya lo hace el
   sugeridor manual.
4. **Pruebas del optimizador**, que es el riesgo más grande.
5. Panel de administrador y login por usuario de verdad.
