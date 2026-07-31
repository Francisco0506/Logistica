/**
 * Cómo se usa el color de cada camión sin que el texto se pierda.
 *
 * El color identifica al camión en TODAS las pantallas: su línea en el mapa,
 * sus paradas numeradas, la franja de sus pedidos, su tarjeta en el manifiesto.
 * Ese es su trabajo y lo hace bien.
 *
 * El problema aparece donde ese color se vuelve FONDO DE TEXTO. El número de
 * parada va encima, y estaba siempre en blanco. Medido contra los 11 camiones
 * de la flota, cinco quedan por debajo del mínimo legible (4.5:1) con texto
 * blanco encima:
 *
 *      PP4872A  #D97706   3.19:1
 *      RA7475A  #EA580C   3.56:1     <- el naranja de Laben, el más usado
 *      RJ57620  #0891B2   3.68:1
 *      RD9618A  #0D9488   3.74:1
 *      RJ97892  #059669   3.77:1
 *
 * La salida NO es cambiar los colores: están escogidos para distinguirse entre
 * sí de un vistazo cuando están encimados en el mapa, que es lo que de verdad
 * importa. La salida es que el TEXTO se adapte al fondo.
 */

/** Luminancia relativa de un color #RRGGBB, según la fórmula de WCAG. */
function luminancia(hex) {
  const canal = (n) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/**
 * Blanco o casi-negro, el que se lea mejor encima de `fondo`.
 *
 * Se compara el contraste de los dos y gana el mayor, en vez de usar un umbral
 * fijo: así funciona igual con los colores de hoy y con cualquiera que se
 * agregue después, sin que nadie tenga que acordarse de revisarlo.
 */
export function textoSobre(fondo) {
  if (typeof fondo !== 'string' || !/^#[0-9a-f]{6}$/i.test(fondo)) return '#ffffff';
  const L = luminancia(fondo);
  const conBlanco = 1.05 / (L + 0.05);
  const conNegro = (L + 0.05) / 0.05;
  // gray-900 y no negro puro: se ve menos duro y contrasta prácticamente igual.
  return conBlanco >= conNegro ? '#ffffff' : '#111827';
}

/**
 * Un color para un camión que el despachador agregó a mano.
 *
 * Recibe los colores que YA están en uso y devuelve uno que no choque.
 *
 * Antes esto era `PALETA[trucks.length % PALETA.length]` contra una copia de la
 * paleta que vivía en el frontend. Dos problemas, los dos reales:
 *
 *   1. La copia se quedó en 8 colores mientras el backend creció a 11, así que
 *      no conocía los tres de los camiones que no son ISUZU.
 *   2. Con 11 camiones en la flota, `11 % 8 = 3` — o sea que el primer camión
 *      agregado a mano nacía con el MISMO color que el RJ97892. Dos camiones
 *      del mismo color, encimados en el mismo mapa.
 *
 * Ahora los colores de referencia salen de la flota que el backend ya mandó
 * (no hay copia que mantener) y se escoge el primero que esté libre.
 */
export function colorLibre(coloresEnUso = [], paleta = []) {
  const usados = new Set(coloresEnUso.filter(Boolean).map((c) => c.toLowerCase()));
  const libre = paleta.find((c) => c && !usados.has(c.toLowerCase()));
  if (libre) return libre;
  // Se acabaron los de la flota: se genera uno separándolo en el círculo de
  // color, para que siga siendo distinguible de los demás en el mapa.
  const h = (usados.size * 137.5) % 360;   // 137.5° = ángulo áureo, reparte parejo
  return `hsl(${Math.round(h)} 70% 45%)`;
}
