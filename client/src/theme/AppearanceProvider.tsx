// AppearanceProvider — ajustes visuales del editor (DESIGN.md §10). Hermano de
// ThemeProvider: persiste el tamaño de fuente del editor de código en
// localStorage y lo aplica como la CSS var --editor-font-size en <html>, que el
// editor CodeMirror consume (ver views/Editor/cmTheme.ts → .cm-scroller).
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const STORAGE_KEY = 'portaide:editorFontSize'

/** Rango del stepper (px). Fuera de aquí el editor se vuelve incómodo en móvil. */
export const EDITOR_FONT_MIN = 11
export const EDITOR_FONT_MAX = 20
const DEFAULT_FONT_SIZE = 14

/** Encierra un valor en [MIN, MAX] y lo redondea a entero (px). */
function clamp(size: number): number {
  return Math.min(EDITOR_FONT_MAX, Math.max(EDITOR_FONT_MIN, Math.round(size)))
}

/** Lee el tamaño persistido; si no hay valor útil (ausente, vacío o no numérico)
    o el storage falla, cae al default. Ojo: Number('') === 0, así que hay que
    descartar la cadena vacía antes de parsear para no clampar a MIN. */
function readStoredFontSize(): number {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    const parsed = stored != null && stored.trim() !== '' ? Number(stored) : NaN
    return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT_FONT_SIZE
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

interface AppearanceContextValue {
  editorFontSize: number
  setEditorFontSize: (size: number) => void
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [editorFontSize, setEditorFontSize] = useState<number>(readStoredFontSize)

  // useLayoutEffect: aplica la var antes del pintado (mismo patrón que ThemeProvider).
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', `${editorFontSize}px`)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(editorFontSize))
    } catch {
      // Storage no disponible (p.ej. navegación privada): funciona igual, sin persistir.
    }
  }, [editorFontSize])

  const value = useMemo(
    () => ({
      editorFontSize,
      setEditorFontSize: (size: number) => setEditorFontSize(clamp(size)),
    }),
    [editorFontSize],
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useEditorFontSize(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext)
  if (!ctx) throw new Error('useEditorFontSize debe usarse dentro de <AppearanceProvider>')
  return ctx
}
