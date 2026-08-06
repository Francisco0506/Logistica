import { describe, it, expect, vi, beforeEach } from 'vitest';

import { comprimirFoto } from './imagen';

/**
 * Lo que de verdad importa probar aquí no es "¿comprime?" —eso lo hace el
 * navegador— sino que NUNCA se pierda la foto. Una foto pesada cuesta disco;
 * una entrega sin evidencia cuesta una discusión con el cliente que no se puede
 * ganar. Por eso casi todas las pruebas son de los caminos que fallan.
 */

// jsdom no trae canvas ni decodifica imágenes, así que se imita lo mínimo:
// una imagen que "carga" con el tamaño que se le diga, y un canvas que
// devuelve el blob que se le diga.
function prepararNavegador({ ancho, alto, blobSalida, fallaCarga = false }) {
  global.URL.createObjectURL = vi.fn(() => 'blob:falso');
  global.URL.revokeObjectURL = vi.fn();

  global.Image = class {
    constructor() {
      this.width = ancho;
      this.height = alto;
      setTimeout(() => (fallaCarga ? this.onerror?.(new Error('no carga')) : this.onload?.()), 0);
    }
  };

  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag !== 'canvas') return {};
    return {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb) => cb(blobSalida),
    };
  });
}

/** Un File con el peso que se le pida, sin tener que fabricar bytes de verdad. */
function archivoFalso({ nombre = 'IMG_0001.jpg', tipo = 'image/jpeg', peso }) {
  const f = new File(['x'], nombre, { type: tipo });
  Object.defineProperty(f, 'size', { value: peso });
  return f;
}

/** Lo mismo para un Blob: `size` es solo-lectura, hay que redefinirla. */
function blobFalso(peso) {
  const b = new Blob(['x']);
  Object.defineProperty(b, 'size', { value: peso });
  return b;
}

describe('comprimirFoto', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('achica una foto grande de celular', async () => {
    const original = archivoFalso({ peso: 3_500_000 });
    prepararNavegador({
      ancho: 4032,
      alto: 3024,
      blobSalida: blobFalso(200_000),
    });

    const salida = await comprimirFoto(original);

    // No se afirma el tamaño exacto: al envolver el blob en un File, jsdom
    // recalcula `size` con los bytes de mentiras del blob, no con el peso que
    // se le fijó. Lo que sí importa es que salió un archivo NUEVO y en JPEG —
    // que de verdad pese menos lo garantiza la guarda `blob.size >=
    // archivo.size` del código, y eso lo cubre la prueba de "quedó más pesada".
    expect(salida).not.toBe(original);
    expect(salida).toBeInstanceOf(File);
    expect(salida.type).toBe('image/jpeg');
  });

  it('le pone extensión .jpg aunque el celular la haya mandado .HEIC', async () => {
    const original = archivoFalso({ nombre: 'IMG_0421.HEIC', tipo: 'image/heic', peso: 3_000_000 });
    prepararNavegador({
      ancho: 4032,
      alto: 3024,
      blobSalida: blobFalso(180_000),
    });

    const salida = await comprimirFoto(original);

    // El contenido ya es JPEG: la extensión no puede decir otra cosa, porque el
    // backend guarda el archivo con el nombre que le llega.
    expect(salida.name).toBe('IMG_0421.jpg');
  });

  it('deja pasar tal cual una foto que ya venía chica', async () => {
    // Recomprimir un JPEG ya comprimido solo le quita calidad sin ahorrar nada.
    const original = archivoFalso({ peso: 150_000 });
    prepararNavegador({ ancho: 800, alto: 600, blobSalida: null });

    expect(await comprimirFoto(original)).toBe(original);
  });

  it('se queda con la original si comprimir la dejó MÁS pesada', async () => {
    const original = archivoFalso({ peso: 500_000 });
    prepararNavegador({
      ancho: 2000,
      alto: 1500,
      blobSalida: blobFalso(900_000),
    });

    expect(await comprimirFoto(original)).toBe(original);
  });

  // ── Los caminos que fallan: en TODOS tiene que sobrevivir la foto ──

  it('devuelve la original si el navegador no pudo decodificar la imagen', async () => {
    const original = archivoFalso({ peso: 3_000_000 });
    prepararNavegador({ ancho: 4032, alto: 3024, blobSalida: null, fallaCarga: true });

    expect(await comprimirFoto(original)).toBe(original);
  });

  it('devuelve la original si el canvas no entregó blob', async () => {
    const original = archivoFalso({ peso: 3_000_000 });
    prepararNavegador({ ancho: 4032, alto: 3024, blobSalida: null });

    expect(await comprimirFoto(original)).toBe(original);
  });

  it('no truena si no le llega archivo', async () => {
    expect(await comprimirFoto(null)).toBe(null);
    expect(await comprimirFoto(undefined)).toBe(undefined);
  });

  it('no toca algo que no sea una imagen', async () => {
    const pdf = archivoFalso({ nombre: 'remision.pdf', tipo: 'application/pdf', peso: 900_000 });
    expect(await comprimirFoto(pdf)).toBe(pdf);
  });
});
