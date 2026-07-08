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
  'T-001': 'SPM-82-91',
  'T-002': 'NLE-14-38',
  'T-003': 'GUA-90-21',
  'T-004': 'SNI-77-04',
  'T-005': 'MTY-55-12',
};

// Datos base de los 5 camiones (con pequeño offset para que no se empalmen en el mapa)
export const FLEET = [
  { id: 'SPM-82-91', driver: 'Roberto Sánchez', route: 'Sta. Catarina Pte.', pos: [CEDIS[0], CEDIS[1] - 0.002], color: '#F27A18' },
  { id: 'NLE-14-38', driver: 'Luis Garza',       route: 'San Pedro / Valle',  pos: [CEDIS[0] + 0.001, CEDIS[1] - 0.001], color: '#D92525' },
  { id: 'GUA-90-21', driver: 'Mario Gómez',      route: 'Mitras / Lincoln',   pos: [CEDIS[0] - 0.001, CEDIS[1] - 0.001], color: '#3b82f6' },
  { id: 'SNI-77-04', driver: 'Saúl Cano',        route: 'García Industrial',  pos: [CEDIS[0] + 0.001, CEDIS[1] + 0.001], color: '#10b981' },
  { id: 'MTY-55-12', driver: 'Tono Vega',        route: 'Centro Monterrey',   pos: [CEDIS[0] - 0.001, CEDIS[1] + 0.001], color: '#8b5cf6' },
];

// Alertas SAP de ejemplo
export const SAP_ALERTS = [
  { id: 1, docNum: '#1915', client: 'Taquería La Fama',  error: 'Sin georreferencia en SAP B1' },
  { id: 2, docNum: '#1918', client: 'Buffet Express',    error: 'Excede ventana horaria de chofer' },
];
