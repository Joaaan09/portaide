// Barra de teclas especiales del terminal móvil (DESIGN.md §9): utilidades para
// traducir pulsaciones a las secuencias de control que espera el pty.

/** Modificadores "sticky": se arman con un tap y afectan a la siguiente entrada. */
export interface Modifiers {
  ctrl: boolean
  alt: boolean
}

export const NO_MODS: Modifiers = { ctrl: false, alt: false }

/** Secuencias crudas de las teclas no imprimibles. */
export const SEQ = {
  esc: '\x1b',
  tab: '\t',
  ctrlC: '\x03',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
} as const

/**
 * Aplica los modificadores armados a un dato imprimible (una sola tecla):
 *  - ctrl + letra  → código de control (Ctrl+A = 0x01 … Ctrl+Z = 0x1a).
 *  - ctrl + @A–Z[\]^_ → su código de control equivalente.
 *  - alt  + dato   → ESC + dato (convención "meta").
 * Si la combinación no tiene un equivalente claro, devuelve el dato sin tocar.
 * No se aplica a secuencias multi-carácter (flechas, esc, tab): esas se envían
 * crudas para no romperlas.
 */
export function applyModifiers(data: string, mods: Modifiers): string {
  if (data.length !== 1) return data // solo teclas sueltas (no pegados)
  if (mods.ctrl) {
    const lower = data.toLowerCase().charCodeAt(0)
    if (lower >= 97 && lower <= 122) return String.fromCharCode(lower - 96) // a–z → 1–26
    const code = data.charCodeAt(0)
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64) // @A–Z[\]^_
    return data
  }
  if (mods.alt) return SEQ.esc + data
  return data
}
