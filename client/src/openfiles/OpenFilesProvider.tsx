// OpenFilesProvider — estado compartido de los archivos abiertos en el Editor.
// Files llama a `openFile(path)` al pulsar un archivo: lo añade, lo activa y
// navega a la vista 'editor'. La vista Editor (otro agente) consume este estado
// para pintar sus pestañas y el contenido activo.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useNavigation } from '../navigation/NavigationProvider'

export interface OpenFile {
  /** Ruta absoluta del archivo (identidad; dentro de FS_ROOT). */
  path: string
  /** Nombre para la pestaña (basename de la ruta). */
  name: string
}

interface OpenFilesContextValue {
  files: OpenFile[]
  /** Ruta del archivo activo, o null si no hay ninguno abierto. */
  activePath: string | null
  /** Abre (o reactiva) un archivo y navega a la vista Editor. */
  openFile: (path: string) => void
  /** Cierra un archivo; si era el activo, activa un vecino. */
  closeFile: (path: string) => void
  /** Activa un archivo ya abierto (sin navegar). */
  setActive: (path: string) => void
  /** Sustituye la pestaña `from` por `to` en su sitio y la activa (el visor de
   *  imágenes pasa a la siguiente sin abrir una pestaña por imagen). Si `to` ya
   *  estaba abierto en otra pestaña, esa se retira. */
  replaceFile: (from: string, to: string) => void
}

const OpenFilesContext = createContext<OpenFilesContextValue | null>(null)

/** basename de una ruta POSIX ('/a/b/c.ts' → 'c.ts'). */
function basename(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1]! : p
}

export function OpenFilesProvider({ children }: { children: ReactNode }) {
  const { setView } = useNavigation()
  const [files, setFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)

  const openFile = useCallback(
    (path: string) => {
      setFiles((prev) =>
        prev.some((f) => f.path === path) ? prev : [...prev, { path, name: basename(path) }]
      )
      setActivePath(path)
      setView('editor')
    },
    [setView]
  )

  const closeFile = useCallback((path: string) => {
    setFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === path)
      if (idx === -1) return prev
      const next = prev.filter((f) => f.path !== path)
      // Si cerramos el activo, activamos un vecino (anterior o siguiente).
      setActivePath((current) => {
        if (current !== path) return current
        if (next.length === 0) return null
        const neighbor = next[Math.min(idx, next.length - 1)]
        return neighbor ? neighbor.path : null
      })
      return next
    })
  }, [])

  const setActive = useCallback((path: string) => {
    setActivePath((current) => current === path ? current : path)
  }, [])

  const replaceFile = useCallback((from: string, to: string) => {
    if (from === to) return
    setFiles((prev) => {
      if (!prev.some((f) => f.path === from)) return prev
      setActivePath(to) // idempotente (mismo patrón que closeFile)
      return prev
        .filter((f) => f.path !== to)
        .map((f) => (f.path === from ? { path: to, name: basename(to) } : f))
    })
  }, [])

  const value = useMemo<OpenFilesContextValue>(
    () => ({ files, activePath, openFile, closeFile, setActive, replaceFile }),
    [files, activePath, openFile, closeFile, setActive, replaceFile]
  )

  return <OpenFilesContext.Provider value={value}>{children}</OpenFilesContext.Provider>
}

export function useOpenFiles(): OpenFilesContextValue {
  const ctx = useContext(OpenFilesContext)
  if (!ctx) throw new Error('useOpenFiles debe usarse dentro de <OpenFilesProvider>')
  return ctx
}
