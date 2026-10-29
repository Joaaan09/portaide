// Utilidades de texto compartidas por el Editor y sus visores (imagen, PDF, HTML).
import { ApiError } from '../../api/client'

/** basename de una ruta POSIX ('/a/b/c.ts' → 'c.ts'). */
export function basename(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1]! : p
}

/** Traduce el código de error de la API a un texto sobrio. */
export function errText(err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'request_failed'
  if (code === 'forbidden') return 'sin permisos'
  if (code === 'not_found') return 'el archivo ya no existe'
  if (code === 'too_large') return 'archivo demasiado grande'
  return 'error de conexión'
}
