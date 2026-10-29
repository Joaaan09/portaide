// KeyBar — barra de teclas especiales del terminal móvil (DESIGN.md §9):
// `esc tab ctrl alt paste ~ / | - ^C ↑ ↓ ← →`. Cada tecla es un <button> real.
// ctrl/alt son modificadores "sticky" (se arman y afectan a la siguiente
// entrada); `paste` pega el portapapeles; el resto envía su secuencia al pty a
// través de TerminalView.
import { SEQ, type Modifiers } from './keys'
import styles from './TerminalView.module.css'

interface KeyBarProps {
  modifiers: Modifiers
  /** Tecla no imprimible: envía su secuencia cruda al pty. */
  onSeq: (seq: string) => void
  /** Tecla imprimible: se le aplican los modificadores armados antes de enviar. */
  onChar: (char: string) => void
  /** Arma/desarma un modificador sticky. */
  onToggleMod: (mod: 'ctrl' | 'alt') => void
  /** Pega el portapapeles. Debe leerlo dentro del propio click (gesto del usuario). */
  onPaste: () => void
}

type KeyDef =
  | { label: string; kind: 'seq'; seq: string; aria: string }
  | { label: string; kind: 'char'; char: string; aria: string }
  | { label: string; kind: 'mod'; mod: 'ctrl' | 'alt'; aria: string }
  | { label: string; kind: 'paste'; aria: string }

// Sin la API (contexto no seguro, p.ej. dev por http en la LAN) la tecla sería
// un botón mudo: no se pinta (DESIGN.md §9).
const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText

const KEYS: readonly KeyDef[] = [
  { label: 'esc', kind: 'seq', seq: SEQ.esc, aria: 'Escape' },
  { label: 'tab', kind: 'seq', seq: SEQ.tab, aria: 'Tab' },
  { label: 'ctrl', kind: 'mod', mod: 'ctrl', aria: 'Control' },
  { label: 'alt', kind: 'mod', mod: 'alt', aria: 'Alt' },
  ...(canPaste ? [{ label: 'paste', kind: 'paste', aria: 'Pegar el portapapeles' } as const] : []),
  { label: '~', kind: 'char', char: '~', aria: 'Virgulilla' },
  { label: '/', kind: 'char', char: '/', aria: 'Barra' },
  { label: '|', kind: 'char', char: '|', aria: 'Barra vertical' },
  { label: '-', kind: 'char', char: '-', aria: 'Guion' },
  { label: '^C', kind: 'seq', seq: SEQ.ctrlC, aria: 'Control C' },
  { label: '↑', kind: 'seq', seq: SEQ.up, aria: 'Flecha arriba' },
  { label: '↓', kind: 'seq', seq: SEQ.down, aria: 'Flecha abajo' },
  { label: '←', kind: 'seq', seq: SEQ.left, aria: 'Flecha izquierda' },
  { label: '→', kind: 'seq', seq: SEQ.right, aria: 'Flecha derecha' },
]

export default function KeyBar({ modifiers, onSeq, onChar, onToggleMod, onPaste }: KeyBarProps) {
  return (
    <div className={styles.keybar} role="toolbar" aria-label="Teclas especiales del terminal">
      {KEYS.map((key) => {
        const armed = key.kind === 'mod' && modifiers[key.mod]
        return (
          <button
            key={key.label}
            type="button"
            className={armed ? `${styles.key} ${styles.keyArmed}` : styles.key}
            aria-label={key.aria}
            aria-pressed={key.kind === 'mod' ? armed : undefined}
            // Evita que el tap robe el foco al área de escritura del terminal
            // (así el teclado móvil no se cierra entre pulsaciones).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (key.kind === 'seq') onSeq(key.seq)
              else if (key.kind === 'char') onChar(key.char)
              else if (key.kind === 'paste') onPaste()
              else onToggleMod(key.mod)
            }}
          >
            {key.label}
          </button>
        )
      })}
    </div>
  )
}
