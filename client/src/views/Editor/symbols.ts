// Barra de símbolos del Editor móvil (DESIGN.md §7). Cada tecla inserta su
// texto en el cursor del editor (vía view.dispatch con changes). El conjunto
// sigue al del mockup: puntuación + tabulación (→) + salto de línea (⏎). Se
// omite el glifo ⌘ del mockup por no tener semántica de inserción.

export interface SymbolKey {
  /** Glifo mostrado en la tecla (mono). */
  label: string
  /** Texto que se inserta en el cursor. */
  insert: string
  /** Etiqueta accesible (DESIGN.md §12). */
  aria: string
}

export const SYMBOL_KEYS: readonly SymbolKey[] = [
  { label: '{', insert: '{', aria: 'Insertar llave de apertura' },
  { label: '}', insert: '}', aria: 'Insertar llave de cierre' },
  { label: '(', insert: '(', aria: 'Insertar paréntesis de apertura' },
  { label: ')', insert: ')', aria: 'Insertar paréntesis de cierre' },
  { label: '[', insert: '[', aria: 'Insertar corchete de apertura' },
  { label: ']', insert: ']', aria: 'Insertar corchete de cierre' },
  { label: '<', insert: '<', aria: 'Insertar menor que' },
  { label: '>', insert: '>', aria: 'Insertar mayor que' },
  { label: '/', insert: '/', aria: 'Insertar barra' },
  { label: '\\', insert: '\\', aria: 'Insertar barra invertida' },
  { label: '|', insert: '|', aria: 'Insertar barra vertical' },
  { label: ';', insert: ';', aria: 'Insertar punto y coma' },
  { label: ':', insert: ':', aria: 'Insertar dos puntos' },
  { label: '=', insert: '=', aria: 'Insertar igual' },
  { label: '→', insert: '\t', aria: 'Insertar tabulación' },
  { label: '⏎', insert: '\n', aria: 'Insertar salto de línea' },
]
