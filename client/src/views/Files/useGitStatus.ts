// Estado de git del workspace activo (DESIGN.md §8.1). Vive en FilesView y lo
// comparten el chip de rama, el panel Source Control y las marcas del explorer:
// una sola fuente de verdad, un solo GET.
import { useCallback, useEffect, useRef, useState } from 'react'
import { gitStatus, type GitRepoStatus, type GitStatus } from '../../api/git'

/** Ventana mínima entre refrescos automáticos (al volver a la app). */
const AUTO_REFRESH_MS = 5_000

export interface UseGitStatus {
  /** Estado del repo, o null si la carpeta no es un repo / aún no se sabe. */
  repo: GitRepoStatus | null
  /** true mientras se resuelve el PRIMER estado de este workspace. */
  loading: boolean
  /** Vuelve a pedir el estado al servidor. */
  refresh: () => void
  /** Sustituye el estado con el que devuelve una acción del panel (evita un GET extra). */
  apply: (status: GitRepoStatus) => void
}

export function useGitStatus(workspace: string | null): UseGitStatus {
  const [repo, setRepo] = useState<GitRepoStatus | null>(null)
  const [loading, setLoading] = useState(false)
  // Contador de peticiones: solo la última manda (evita que una respuesta lenta
  // de un workspace anterior pise el estado del actual).
  const reqRef = useRef(0)
  const lastFetchRef = useRef(0)

  const fetchStatus = useCallback(
    (showLoading: boolean) => {
      if (!workspace) {
        setRepo(null)
        return
      }
      const id = (reqRef.current += 1)
      lastFetchRef.current = Date.now()
      if (showLoading) setLoading(true)
      gitStatus(workspace)
        .then((res: GitStatus) => {
          if (reqRef.current !== id) return
          setRepo(res.repo ? res : null)
        })
        .catch(() => {
          // Un fallo del estado de git no debe romper el explorer: se degrada a
          // "sin repo" (el chip desaparece) en vez de pintar un error.
          if (reqRef.current === id) setRepo(null)
        })
        .finally(() => {
          if (reqRef.current === id && showLoading) setLoading(false)
        })
    },
    [workspace]
  )

  // Carga inicial y recarga al cambiar de carpeta de trabajo.
  useEffect(() => {
    setRepo(null)
    fetchStatus(true)
  }, [fetchStatus])

  // Al volver a la app (otra pestaña, Terminal, bloqueo del móvil) el repo puede
  // haber cambiado por fuera. Refresco silencioso, con ventana mínima.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastFetchRef.current < AUTO_REFRESH_MS) return
      fetchStatus(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchStatus])

  const refresh = useCallback(() => fetchStatus(false), [fetchStatus])
  const apply = useCallback((status: GitRepoStatus) => {
    reqRef.current += 1 // invalida cualquier GET en vuelo: esto es más reciente
    lastFetchRef.current = Date.now()
    setRepo(status)
  }, [])

  return { repo, loading, refresh, apply }
}

/**
 * Mapa `ruta absoluta → letra de estado` para pintar las marcas del explorer.
 * Se queda con la letra más informativa de cada archivo: la del árbol de
 * trabajo si la hay (es lo que el usuario acaba de tocar), si no la del index.
 */
export function buildGitMarks(repo: GitRepoStatus | null): Map<string, string> {
  const marks = new Map<string, string>()
  if (!repo) return marks
  for (const f of repo.files) {
    const letter = f.work ?? f.index
    if (!letter) continue
    // Una CARPETA entera sin seguimiento llega con barra final
    // (`client/src/hooks/`): se normaliza o la marca nunca casaría con la ruta
    // que pinta el árbol.
    const rel = f.path.endsWith('/') ? f.path.slice(0, -1) : f.path
    marks.set(`${repo.root}/${rel}`, letter)
  }
  return marks
}
