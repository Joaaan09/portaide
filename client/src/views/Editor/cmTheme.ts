// Tema de CodeMirror 6 mapeado a NUESTROS tokens (DESIGN.md §3), para que el
// editor siga el tema activo (Midnight/Lavender/Magenta) sin literales. Los
// valores se leen del <html> con getComputedStyle (donde ThemeProvider fija
// data-theme y viven las variables --*), igual que xtermTheme.ts hace con el
// terminal. Se reconstruye al cambiar de tema vía un Compartment (ver CodeArea).
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

const MONO = "'JetBrains Mono', monospace"

interface Tokens {
  bg: string
  surface: string
  surface2: string
  text: string
  dim: string
  faint: string
  accent: string
  green: string
  red: string
  yellow: string
  blue: string
  orange: string
}

/** Lee los tokens del tema activo desde la raíz del documento. */
function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string): string => cs.getPropertyValue(name).trim()
  return {
    bg: v('--bg'),
    surface: v('--surface'),
    surface2: v('--surface2'),
    text: v('--text'),
    dim: v('--dim'),
    faint: v('--faint'),
    accent: v('--accent'),
    green: v('--green'),
    red: v('--red'),
    yellow: v('--yellow'),
    blue: v('--blue'),
    orange: v('--orange'),
  }
}

/** Tinte sutil de un token resuelto (para fondos de línea activa, brackets…). */
function mix(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

/** Tema visual del editor (fondo, gutter, cursor, selección, línea activa). */
function makeEditorTheme(k: Tokens): Extension {
  return EditorView.theme(
    {
      '&': { color: k.text, backgroundColor: k.bg, height: '100%' },
      '.cm-scroller': { fontFamily: MONO, fontSize: '13px', lineHeight: '20px' },
      // Cursor en acento (caret nativo → respeta reduced-motion del SO, DESIGN §11).
      '.cm-content': { caretColor: k.accent, padding: '8px 0' },
      '&.cm-focused': { outline: 'none' },
      // Selección en superficie 2 (DESIGN §3).
      '.cm-content ::selection': { backgroundColor: k.surface2 },
      '.cm-line ::selection': { backgroundColor: k.surface2 },
      // Gutter de números de línea: --faint, no seleccionable (DESIGN §7).
      '.cm-gutters': {
        backgroundColor: k.bg,
        color: k.faint,
        border: 'none',
        fontFamily: MONO,
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 12px', minWidth: '2ch' },
      // Línea activa: tinte muy sutil (separación por color, no por borde).
      '.cm-activeLine': { backgroundColor: mix(k.surface, 55) },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: k.dim },
      // Emparejado de brackets (bracketMatching).
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: mix(k.accent, 20),
        color: k.text,
        outline: `1px solid ${mix(k.accent, 45)}`,
      },
      '.cm-nonmatchingBracket': { color: k.red },
      '.cm-specialChar': { color: k.faint },
    },
    { dark: true }
  )
}

/**
 * HighlightStyle: mapea los tags de Lezer a los 8 colores del DESIGN §3
 * (kw→accent, ty→blue, st→green, fn→yellow, nm→orange, cm→faint, pn→dim, tx→text).
 */
function makeHighlightStyle(k: Tokens): HighlightStyle {
  return HighlightStyle.define([
    // kw — keyword
    {
      tag: [
        t.keyword,
        t.controlKeyword,
        t.operatorKeyword,
        t.definitionKeyword,
        t.moduleKeyword,
        t.modifier,
        t.self,
      ],
      color: k.accent,
    },
    // ty — tipo / clase / etiqueta
    { tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.tagName)], color: k.blue },
    // st — string
    {
      tag: [t.string, t.docString, t.special(t.string), t.regexp, t.character, t.attributeValue],
      color: k.green,
    },
    // fn — función
    {
      tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName],
      color: k.yellow,
    },
    // nm — número / constante
    {
      tag: [t.number, t.integer, t.float, t.bool, t.atom, t.unit, t.null, t.constant(t.variableName)],
      color: k.orange,
    },
    // cm — comentario / meta
    {
      tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta, t.documentMeta, t.annotation],
      color: k.faint,
      fontStyle: 'italic',
    },
    // pn — puntuación / operadores
    {
      tag: [
        t.punctuation,
        t.separator,
        t.bracket,
        t.angleBracket,
        t.squareBracket,
        t.paren,
        t.brace,
        t.operator,
        t.derefOperator,
      ],
      color: k.dim,
    },
    // tx — identificador / texto
    {
      tag: [t.propertyName, t.attributeName, t.variableName, t.definition(t.variableName)],
      color: k.text,
    },
    // Markdown y varios (dentro de la paleta de tokens).
    { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: k.accent, fontWeight: '600' },
    { tag: [t.link, t.url], color: k.blue, textDecoration: 'underline' },
    { tag: t.strong, fontWeight: '600', color: k.text },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.escape, color: k.orange },
    { tag: t.invalid, color: k.red },
  ])
}

/** Extensiones de tema + resaltado a partir del tema activo (se re-lee al llamar). */
export function buildThemeExtensions(): Extension {
  const k = readTokens()
  return [makeEditorTheme(k), syntaxHighlighting(makeHighlightStyle(k))]
}
