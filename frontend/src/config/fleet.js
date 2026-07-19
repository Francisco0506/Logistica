/**
 * Configuración de flota de Laben Food Service.
 * Fuente única de verdad para datos de camiones y CEDIS.
 */

// Coordenadas exactas de salida de los camiones (CEDIS Santa Catarina)
export const CEDIS = [25.693214524592616, -100.48167993202988];

// Mapeo Backend T-00X → Placa del frontend (mismo orden que FLEET)
export const ID_TO_PLATE = {
  'T-001': 'RA7475A',
  'T-002': 'PP4873A',
  'T-003': 'PR6889B',
  'T-004': 'RJ97892',
  'T-005': 'RJ37663',
  'T-006': 'PP4872A',
  'T-007': 'RJ57620',
  'T-008': 'RH83800',
};

// Datos base de los 8 camiones ISUZU de reparto reales (placa y nombre real de
// Samsara — mismo criterio que backend/delivery/samsara_service.py). Los
// Nissan/Hino/Freightliner y los 4 vehículos de vendedores quedan fuera, no
// son de reparto. `driver` queda vacío: el chofer se captura a mano desde el
// panel cuando haga falta (no hay roster fijo). La posición en el mapa es
// SOLO la capa verde de GPS real (Samsara) — aquí no se guardan posiciones.
// `capacidadKg` es la carga útil ESTIMADA por modelo (ficha Isuzu México),
// pendiente de confirmar con la tarjeta de circulación de cada unidad — debe
// coincidir con CAPACIDADES_CAMION_KG en backend/delivery/api.py (mismo orden).
// ORDEN = ranking de uso real (km GPS Samsara, últimos 60 días al 18-jul-2026,
// ver docs/uso-flota-samsara.md): los que más salen hasta arriba. Así el panel
// muestra primero los camiones que de verdad trabajan, y el optimizador los
// usa en ese mismo orden. 015 y 012 (últimos) llevan 2 meses sin operar.
// `activo: false` = los que casi no salen (ver días trabajados en 30 días:
// 024 salió 1 día, 015 tres días con 9 km, 012 ninguno). Arrancan apagados
// para no meterlos en la optimización por default — se activan con un clic
// desde el panel el día que se ocupen.
export const FLEET = [
  { id: 'RA7475A', samsara: '027', modelo: 'ELF 600', capacidadKg: 5500, activo: true, driver: '', route: 'Sin ruta asignada', color: '#06b6d4' },
  { id: 'PP4873A', samsara: '023', modelo: 'ELF 400/500', capacidadKg: 3800, activo: true, driver: '', route: 'Sin ruta asignada', color: '#ec4899' },
  { id: 'PR6889B', samsara: '017', modelo: 'ELF 600', capacidadKg: 5500, activo: true, driver: '', route: 'Sin ruta asignada', color: '#8b5cf6' },
  { id: 'RJ97892', samsara: '016', modelo: 'ELF 100/200', capacidadKg: 2000, activo: true, driver: '', route: 'Sin ruta asignada', color: '#10b981' },
  { id: 'RJ37663', samsara: '013', modelo: 'ELF 100/200', capacidadKg: 2000, activo: true, driver: '', route: 'Sin ruta asignada', color: '#D92525' },
  { id: 'PP4872A', samsara: '024', modelo: 'ELF 400/500', capacidadKg: 3800, activo: false, driver: '', route: 'Sin ruta asignada', color: '#eab308' },
  { id: 'RJ57620', samsara: '015', modelo: 'ELF 100/200', capacidadKg: 2000, activo: false, driver: '', route: 'Sin ruta asignada', color: '#3b82f6' },
  { id: 'RH83800', samsara: '012', modelo: 'ELF 400/500', capacidadKg: 3800, activo: false, driver: '', route: 'Sin ruta asignada', color: '#F27A18' },
];
