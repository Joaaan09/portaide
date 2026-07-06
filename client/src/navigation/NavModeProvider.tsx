// NavModeProvider — preferencia de modo de navegación (DESIGN.md §5/§13b).
// Hermano de ThemeProvider/AppearanceProvider: persiste `navMode` en
// localStorage y aplica la var CSS --nav-inset en <html>, que cada superficie
// inferior consume para reservar su holgura (0 en drawer, alto de la barra en
// bottombar). Gestiona además el estado abierto/cerrado del drawer, compartido
// por el botón ☰ de las cabeceras y el propio panel lateral.
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type NavMode = 'drawer' | 'bottombar'

const STORAGE_KEY = 'portaide:navMode'
const DEFAULT_NAV_MODE: NavMode = 'drawer'

function isNavMode(value: unknown): value is NavMode {
  return value === 'drawer' || value === 'bottombar'
}

/** Lee el modo persistido; si no hay valor útil (ausente/inválido) o el storage
    falla, cae al default (drawer). */
function readStoredNavMode(): NavMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isNavMode(stored) ? stored : DEFAULT_NAV_MODE
  } catch {
    return DEFAULT_NAV_MODE
  }
}

interface NavModeContextValue {
  navMode: NavMode
  setNavMode: (mode: NavMode) => void
  drawerOpen: boolean
  openDrawer: () => void
  closeDrawer: () => void
  toggleDrawer: () => void
}

const NavModeContext = createContext<NavModeContextValue | null>(null)

export function NavModeProvider({ children }: { children: ReactNode }) {
  const [navMode, setNavMode] = useState<NavMode>(readStoredNavMode)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // useLayoutEffect: aplica la var --nav-inset antes del pintado (mismo patrón
  // que ThemeProvider/AppearanceProvider). En bottombar reserva el alto de la
  // barra; en drawer no reserva nada (el contenido llega al fondo real).
  useLayoutEffect(() => {
    const inset = navMode === 'bottombar' ? 'var(--bottombar-height)' : '0px'
    document.documentElement.style.setProperty('--nav-inset', inset)
    try {
      window.localStorage.setItem(STORAGE_KEY, navMode)
    } catch {
      // Storage no disponible (p.ej. navegación privada): funciona igual, sin persistir.
    }
  }, [navMode])

  // Al salir del modo drawer, cualquier drawer abierto debe cerrarse.
  useLayoutEffect(() => {
    if (navMode !== 'drawer') setDrawerOpen(false)
  }, [navMode])

  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const toggleDrawer = useCallback(() => setDrawerOpen((prev) => !prev), [])

  const value = useMemo(
    () => ({ navMode, setNavMode, drawerOpen, openDrawer, closeDrawer, toggleDrawer }),
    [navMode, drawerOpen, openDrawer, closeDrawer, toggleDrawer],
  )

  return <NavModeContext.Provider value={value}>{children}</NavModeContext.Provider>
}

export function useNavMode(): NavModeContextValue {
  const ctx = useContext(NavModeContext)
  if (!ctx) throw new Error('useNavMode debe usarse dentro de <NavModeProvider>')
  return ctx
}
