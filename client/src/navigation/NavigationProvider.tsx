// Navegación por estado entre las 5 vistas (CLAUDE.md §3).
// Decisión registrada: sin react-router — la app es un shell de vistas
// conmutadas en memoria, no páginas con URL.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type ViewId = 'files' | 'editor' | 'chat' | 'terminal' | 'settings'

export interface ViewMeta {
  id: ViewId
  label: string
  /** Glifo mono de la isla de navegación (DESIGN.md §5) */
  icon: string
}

/** Orden canónico de las pestañas de la isla (mockup `Editor Movil (offline).html`) */
export const VIEWS: readonly ViewMeta[] = [
  { id: 'files', label: 'Files', icon: '▤' },
  { id: 'editor', label: 'Editor', icon: '{ }' },
  { id: 'chat', label: 'Chat', icon: '✦' },
  { id: 'terminal', label: 'Terminal', icon: '>_' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

// La vista estrella es el Chat (CLAUDE.md §3): es donde arranca la app
const INITIAL_VIEW: ViewId = 'chat'

interface NavigationContextValue {
  view: ViewId
  setView: (view: ViewId) => void
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewId>(INITIAL_VIEW)

  const value = useMemo(() => ({ view, setView }), [view])

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigation debe usarse dentro de <NavigationProvider>')
  return ctx
}
