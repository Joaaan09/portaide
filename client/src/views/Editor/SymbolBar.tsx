// Barra de símbolos móvil (DESIGN.md §7): fila scrollable de teclas mono que
// insertan su texto en el cursor del editor. Cada tecla es un <button> real.
import { SYMBOL_KEYS } from './symbols'
import styles from './EditorView.module.css'

interface SymbolBarProps {
  onInsert: (text: string) => void
}

export default function SymbolBar({ onInsert }: SymbolBarProps) {
  return (
    <div className={styles.symbar} role="toolbar" aria-label="Símbolos de código">
      {SYMBOL_KEYS.map((key) => (
        <button
          key={key.label}
          type="button"
          className={styles.symkey}
          aria-label={key.aria}
          // Evita que el tap robe el foco del editor (mantiene cursor y teclado
          // móvil abiertos), como la KeyBar del Terminal.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(key.insert)}
        >
          {key.label}
        </button>
      ))}
    </div>
  )
}
