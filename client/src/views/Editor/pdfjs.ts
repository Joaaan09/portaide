// Carga perezosa de pdf.js (visor de PDF, DESIGN.md §7.2). Ni la librería ni su
// worker entran en el bundle principal: se piden la primera vez que se abre un
// PDF y se reutilizan después.
//
// Build LEGACY a propósito (ADR 2026-10-29): el build moderno de pdf.js 6 usa
// APIs de JS recientísimas sin polyfill (Map#getOrInsertComputed, Promise.try)
// que el WebView de iOS puede no tener; el legacy las trae polyfilleadas.
// El worker va por `?worker` → Vite lo emite como .js (el nginx del frontend no
// conoce el MIME de .mjs y un worker de módulo con MIME incorrecto no arranca).
type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsPromise: Promise<Pdfjs> | null = null

export function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'),
  ])
    .then(([lib, worker]) => {
      // Un único worker para todos los documentos (pdf.js no termina un
      // workerPort ajeno al destruir un documento).
      lib.GlobalWorkerOptions.workerPort ??= new worker.default()
      return lib
    })
    .catch((err: unknown) => {
      pdfjsPromise = null // p.ej. chunk caído por red: que el siguiente intento reintente
      throw err
    })
  return pdfjsPromise
}
