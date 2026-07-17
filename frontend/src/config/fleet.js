/**
 * Configuración de flota de Laben Food Service.
 * Fuente única de verdad para datos de camiones, choferes y CEDIS.
 */

// Coordenadas exactas de salida de los camiones (CEDIS Santa Catarina)
export const CEDIS = [25.693214524592616, -100.48167993202988];

// Choferes disponibles
export const DRIVERS = [
  'Roberto Sánchez',
  'Luis Garza',
  'Mario Gómez',
  'Saúl Cano',
  'Tono Vega',
];

// Mapeo Backend T-00X → Placa del frontend
export const ID_TO_PLATE = {
  'T-001': 'RH83800',
  'T-002': 'RJ37663',
  'T-003': 'RJ57620',
  'T-004': 'RJ97892',
  'T-005': 'PR6889B',
  'T-006': 'PP4873A',
  'T-007': 'PP4872A',
  'T-008': 'RA7475A',
};

// Datos base de los 8 camiones ISUZU de reparto reales (placa y nombre real de
// Samsara — mismo criterio que backend/delivery/samsara_service.py). Los
// Nissan/Hino/Freightliner y los 4 vehículos de vendedores quedan fuera, no
// son de reparto. `driver` queda vacío hasta asignar desde el panel (roster
// en DRIVERS); `pos` es solo la posición inicial junto al CEDIS — la capa
// verde de GPS real (Samsara) en el mapa muestra la ubicación en vivo aparte.
export const FLEET = [
  { id: 'RH83800', samsara: '012', driver: '', route: 'Sin ruta asignada', pos: [CEDIS[0], CEDIS[1] - 0.002], color: '#F27A18' },
  { id: 'RJ37663', samsara: '013', driver: '', route: 'Sin ruta asignada', pos: [CEDIS[0] + 0.001, CEDIS[1] - 0.001], color: '#D92525' },
  { id: 'RJ57620', samsara: '015', driver: '', route: 'Sin ruta asignada', pos: [CEDIS[0] - 0.001, CEDIS[1] - 0.001], color: '#3b82f6' },
  { id: 'RJ97892', samsara: '016', driver: '', route: 'Sin ruta asignada', pos: [CEDIS[0] + 0.001, CEDIS[1] + 0.001], color: '#10b981' },
  { id: 'PR6889B', samsara: '017', driver: '', route: 'Sin ruta asignada', pos: [CEDIS[0] - 0.001, CEDIS[1] + 0.001], color: '#8b5cf6' },
  { id: 'PP4873A', samsara: '023', driver: '', route: 'Sin ruta asignada', pos: [CEDIS[0] + 0.002, CEDIS[1]], color: '#ec4899' },
  { id: 'PP4872A', samsara: '024', driver: '', route: 'Sin ruta asignada', pos: [CEDIS[0] - 0.002, CEDIS[1]], color: '#eab308' },
  { id: 'RA7475A', samsara: '027', driver: '', route: 'Sin ruta asignada', pos: [CEDIS[0], CEDIS[1] + 0.002], color: '#06b6d4' },
];
