// WorkspaceProvider — carpeta de trabajo activa, estilo "Open Folder" de VS Code
// (decisiones.md 2026-07-02 "Workspace estilo VS Code"). Acota Files/Editor/
// Terminal/Chat (es el cwd). Persiste en localStorage; el default es el
// `defaultWorkspace` que devuelve GET /api/fs/context (= FS_ROOT del server).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fsContext } from '../api/client'

const STORAGE_KEY = 'portaide:workspace'

interface WorkspaceContextValue {
  /** Carpeta de trabajo activa (ruta absoluta) o null mientras se resuelve. */
  workspace: string | null
  /** Raíz navegable del filesystem (límite del selector de carpeta). */
  root: string | null
  /** Fija la carpeta activa y la persiste. */
  setWorkspace: (path: string) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

/** Lee el workspace persistido (o null si no hay / el storage falla). */
function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspaceState] = useState<string | null>(null)
  const [root, setRoot] = useState<string | null>(null)

  // Al montar: resuelve la raíz/default del server y elige el workspace inicial
  // (persistido si sigue dentro de la raíz, si no el default).
  useEffect(() => {
    let cancelled = false
    fsContext()
      .then((ctx) => {
        if (cancelled) return
        setRoot(ctx.root)
        const stored = readStored()
        const withinRoot =
          stored !== null && (stored === ctx.root || stored.startsWith(ctx.root + '/'))
        setWorkspaceState(withinRoot ? stored : ctx.defaultWorkspace)
      })
      .catch(() => {
        // Sin contexto no podemos navegar; Files mostrará el estado de error.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setWorkspace = useCallback((path: string) => {
    setWorkspaceState(path)
    try {
      window.localStorage.setItem(STORAGE_KEY, path)
    } catch {
      // Storage no disponible: el workspace funciona igual, sin persistir.
    }
  }, [])

  const value = useMemo<WorkspaceContextValue>(
    () => ({ workspace, root, setWorkspace }),
    [workspace, root, setWorkspace]
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace debe usarse dentro de <WorkspaceProvider>')
  return ctx
}
