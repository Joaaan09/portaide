// Descarga de rutas del FS pensada para la PWA. El problema (bug 18ª sesión):
// en iOS como PWA `standalone` el webview NO tiene gestor de descargas ni botón
// atrás, así que un <a href download> normal:
//   - archivo → navega a la pantalla de descarga de iOS y la app queda ATASCADA
//     (hay que matar la PWA y reabrir),
//   - carpeta (.zip) → el webview no sabe previsualizarlo y el toque se traga en
//     silencio (parece que el botón "no hace nada").
// La cura es NO navegar nunca la página: traer el recurso con fetch (la cookie
// de sesión viaja sola → el gate de auth sigue aplicando) y entregarlo con la
// Web Share API ("Guardar en Archivos" de iOS), con fallback por object URL.
import { fsDownloadUrl, ApiError } from './client'

/**
 * true si la app corre como PWA instalada (sin chrome del navegador). Solo en
 * ese modo cambiamos de estrategia; fuera (escritorio, Android en pestaña,
 * Safari normal) la descarga nativa del <a download> funciona y hace streaming.
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const byMedia = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  // iOS expone el modo instalado por esta propiedad no estándar de navigator.
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return byMedia || iosStandalone
}

interface FileShareData {
  files?: File[]
  title?: string
  text?: string
  url?: string
}
type Sharer = Navigator & {
  canShare?: (data?: FileShareData) => boolean
  share?: (data?: FileShareData) => Promise<void>
}

/**
 * Descarga una ruta del FS SIN navegar la página (imprescindible en standalone).
 * 1) fetch del recurso a blob (misma cookie de sesión → auth intacta).
 * 2) Web Share API con ficheros (iOS → hoja "Guardar en Archivos"), si existe.
 * 3) Fallback: object URL + <a download> sintético (escritorio/Android).
 * Nunca toca document.location, así que la app no se queda atascada.
 *
 * Nota: para compartir hay que tener el blob en memoria. Para zips de carpetas
 * enormes esto consume RAM; es un compromiso aceptable en una herramienta de un
 * solo usuario (ver bugs.md). Fuera de standalone ni se llama a esta función.
 */
export async function downloadFsPath(path: string, name: string): Promise<void> {
  const res = await fetch(fsDownloadUrl(path), { credentials: 'include' })
  if (!res.ok) throw new ApiError(res.status, 'download_failed')
  const blob = await res.blob()

  const nav = window.navigator as Sharer
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] })
      return
    } catch (err) {
      // El usuario cerró la hoja de compartir: no es un fallo.
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Cualquier otro fallo de share → caemos al fallback por object URL.
    }
  }

  // Fallback: descarga por object URL. El <a> es sintético y no está en el
  // árbol más que un instante → no hay navegación de la página.
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoca con holgura para no cortar la descarga en curso.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
