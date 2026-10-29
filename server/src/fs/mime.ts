// Content-Type por extensión, compartido por la FS API (/raw, /download) y la
// vista previa de HTML (/api/preview). Lo que no esté en el mapa sale como
// octet-stream → el navegador lo descarga en vez de intentar interpretarlo.

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
};

/** Extensión en minúsculas de un nombre de archivo ('a.PNG' → 'png'). */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** MIME por extensión, con fallback a octet-stream (fuerza descarga). */
export function mimeFor(name: string): string {
  return MIME_BY_EXT[extOf(name)] ?? 'application/octet-stream';
}
