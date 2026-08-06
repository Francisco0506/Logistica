/**
 * Achica la foto de evidencia ANTES de subirla.
 *
 * ── POR QUÉ ──
 *
 * El chofer toma la foto con `<input capture="environment">`, o sea con la
 * cámara del celular tal cual: 3-4 MB por foto en cualquier teléfono medianamente
 * nuevo. Eso pega por dos lados, y el segundo importa más que el primero:
 *
 *   1. DISCO. A ~100 entregas al día, subir la foto sin tocar son ~300 MB
 *      diarios, ~78 GB al año, en un disco que además hay que respaldar
 *      completo cada noche (ver scripts/respaldo.sh).
 *   2. EL CHOFER PARADO EN LA PUERTA. Está en la calle, con la señal que haya.
 *      Subir 3 MB con mala cobertura tarda decenas de segundos y muchas veces
 *      truena a media subida — y aunque la confirmación de la entrega va por
 *      separado y no se pierde (ver api/chofer.py), el chofer se queda ahí
 *      esperando a ver si pasó o no.
 *
 * Comprimida queda en ~150-250 KB: sube casi instantánea y el disco deja de ser
 * un problema. Para lo que sirve la foto —enseñar en qué estado se entregó, o
 * que el camión sí llegó a esa puerta— 1280 px es de sobra.
 *
 * ── POR QUÉ EN EL NAVEGADOR Y NO EN EL SERVIDOR ──
 *
 * Comprimir en el backend arreglaría el disco pero NO el problema del chofer:
 * los 3 MB tendrían que viajar igual. Aquí se achica antes de salir del
 * teléfono, así que se arreglan los dos de una vez.
 *
 * ── SI ALGO FALLA, SE SUBE LA ORIGINAL ──
 *
 * Cualquier tropiezo (un formato que el navegador no sabe decodificar, un
 * celular viejo sin canvas) devuelve el archivo tal como llegó. Una foto pesada
 * es un problema de disco; una entrega sin evidencia es un problema con el
 * cliente. Nunca se pierde la foto por intentar hacerla chica.
 */

// 1280 px en el lado largo. Suficiente para ver una tarima, una puerta o una
// caja golpeada, y ya no baja de forma perceptible arriba de esto.
const LADO_MAXIMO = 1280;

// 0.7 en JPEG es el punto donde deja de notarse la diferencia a simple vista
// pero el archivo todavía baja fuerte. Más abajo empiezan a verse cuadros.
const CALIDAD = 0.7;

/**
 * @param {File} archivo  la foto tal como la entrega el `<input type="file">`.
 * @returns {Promise<File>} la versión chica, o la original si no se pudo achicar.
 */
export async function comprimirFoto(archivo) {
  if (!archivo || !archivo.type?.startsWith('image/')) return archivo;

  let url;
  try {
    url = URL.createObjectURL(archivo);
    const img = await cargarImagen(url);

    // Ya es chica: no tiene caso recomprimir. Volver a codificar un JPEG que ya
    // venía comprimido solo le quita calidad sin ahorrar nada.
    const ladoLargo = Math.max(img.width, img.height);
    if (ladoLargo <= LADO_MAXIMO && archivo.size <= 400_000) return archivo;

    const escala = Math.min(1, LADO_MAXIMO / ladoLargo);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', CALIDAD),
    );
    if (!blob) return archivo;

    // Si por lo que sea quedó MÁS pesada que la original (pasa con fotos ya muy
    // comprimidas o casi de un solo color), se queda la original.
    if (blob.size >= archivo.size) return archivo;

    return new File([blob], nombreJpeg(archivo.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return archivo;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function cargarImagen(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** `IMG_0421.HEIC` → `IMG_0421.jpg`. El contenido ya es JPEG, que la extensión
 *  no diga otra cosa: el backend guarda el archivo con el nombre que llega. */
function nombreJpeg(nombre) {
  const base = (nombre || 'foto').replace(/\.[^.]+$/, '');
  return `${base}.jpg`;
}
