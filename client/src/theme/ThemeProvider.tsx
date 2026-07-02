// ThemeProvider — estado global del tema visual (DESIGN.md §3).
// Aplica `data-theme` en <html> (los tokens CSS viven en styles/tokens.css)
// y persiste la elección en localStorage.
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemeId = 'midnight' | 'lavender' | 'magenta'

/** Metadatos de los 3 temas (los consumirá Settings → Appearance) */
export const THEMES: readonly { id: ThemeId; label: string }[] = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'lavender', label: 'Lavender' },
  { id: 'magenta', label: 'Magenta' },
]

const STORAGE_KEY = 'portaide:theme'
const DEFAULT_THEME: ThemeId = 'midnight'

function isThemeId(value: unknown): value is ThemeId {
  return value === 'midnight' || value === 'lavender' || value === 'magenta'
}

/** Lee el tema persistido; si no hay (o el storage falla), cae al default */
function readStoredTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isThemeId(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

interface ThemeContextValue {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(readStoredTheme)

  // useLayoutEffect: aplica el tema antes del pintado para evitar un flash
  // (index.html arranca ya con data-theme="midnight" como base)
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage no disponible (p.ej. navegación privada): el tema funciona igual, sin persistir
    }
  }, [theme])

  const value = useMemo(() => ({ theme, setTheme }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>')
  return ctx
}
