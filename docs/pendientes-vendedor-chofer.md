# Pendientes: Panel de Vendedor y Panel de Chofer

Capturado el 2026-07-20 a partir de conversación con Francisco. Ninguno de los
dos está implementado todavía — el objetivo de este doc es no perder el
alcance mientras se van juntando los detalles (capturas pendientes de Sales).

---

## 1. Panel de Vendedor (`/ventas`, `SalesPanel.jsx`)

**Estado actual:** existe la pantalla y el diseño, pero con datos 100%
inventados (arreglo fijo en el código). No llama al backend.

**Alcance definido:**
- Debe mostrar **solo los pedidos del vendedor que inició sesión**, filtrado
  por `SlpName`/`SlpCode` (el campo de vendedor que SAP ya trae y que
  `sync.py` ya guarda en `Remision.slp_code`/`slp_name`).
- Esto implica que el login tiene que dejar de ser un simple selector de rol
  (hoy `Login.jsx` no valida nada) — hace falta relacionar el usuario que
  inicia sesión con su `SlpCode` real de SAP.
- **Pendiente: Francisco va a mandar capturas** con más campos que quiere ver
  en este panel además del estado del pedido. No arrancar el desarrollo final
  hasta tener eso — evita rehacer trabajo.

---

## 2. Panel de Chofer (`/chofer`, `DriverApp.jsx`)

**Estado actual:** sin revisar a detalle todavía (pendiente de auditar como
se hizo con Sales).

**Requisitos nuevos, marcados como importantes:**
- Registrar si la entrega fue **parcial** (no se pudo entregar todo) o si
  **no se pudo entregar nada**, y **por qué** (motivo/causa) — hoy el sistema
  solo tiene estados binarios (Pendiente/Asignado/En_Camino/Entregado), sin
  captura de excepciones de entrega.
- Capturar **firma de quien recibió** el pedido.
- Capturar **foto en el lugar de entrega** (evidencia).
- La pantalla **debe ser responsiva** (uso real en celular por los choferes en
  la calle) — hay que probarla en viewport móvil, no solo desktop.

---

## Siguiente paso

Esperar las capturas de Francisco sobre los campos del panel de Vendedor
antes de tocar código. El panel de Chofer se puede empezar a auditar/planear
en paralelo (revisar qué tan lejos está `DriverApp.jsx` de esto).
