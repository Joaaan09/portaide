// Construye el tema de xterm a partir de NUESTROS tokens CSS (DESIGN.md §3),
// para que el terminal siga el tema activo (Midnight/Lavender/Magenta) sin
// literales. Se lee del `document.documentElement`, donde ThemeProvider fija
// `data-theme` y viven las variables `--*`.
import type { ITheme } from '@xterm/xterm'

/**
 * Lee los tokens del tema activo y arma el `ITheme` de xterm. La paleta ANSI se
 * mapea a los tokens de estado/acento (verde/rojo/amarillo/azul/naranja +
 * acentos violeta): así la salida coloreada del shell encaja con la identidad.
 */
export function buildXtermTheme(): ITheme {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string): string => cs.getPropertyValue(name).trim()

  const bg = v('--bg')
  const text = v('--text')
  const dim = v('--dim')
  const faint = v('--faint')
  const accent = v('--accent')
  const accent2 = v('--accent2')
  const surface2 = v('--surface2')
  const green = v('--green')
  const red = v('--red')
  const yellow = v('--yellow')
  const blue = v('--blue')
  const orange = v('--orange')

  return {
    background: bg,
    foreground: text,
    cursor: accent, // cursor en acento, parpadeante (DESIGN.md §9)
    cursorAccent: bg, // glifo bajo el bloque del cursor
    selectionBackground: surface2,

    // ANSI base (0–7)
    black: bg,
    red,
    green,
    yellow,
    blue,
    magenta: accent, // el violeta de marca ocupa el slot magenta
    cyan: accent2, // sin cyan propio: acento secundario, en paleta
    white: dim,

    // ANSI brillantes (8–15)
    brightBlack: faint,
    brightRed: red,
    brightGreen: green,
    brightYellow: orange, // el naranja entra por aquí (DESIGN.md §3)
    brightBlue: blue,
    brightMagenta: accent,
    brightCyan: accent2,
    brightWhite: text,
  }
}
