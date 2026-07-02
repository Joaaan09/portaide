// FontSizeStepper — stepper "− {n}px +" del tamaño de fuente del editor
// (DESIGN.md §10). Escribe en AppearanceProvider, que aplica --editor-font-size
// en <html> y el editor CodeMirror consume al instante. Rango 11–20, paso 1.
import {
  EDITOR_FONT_MAX,
  EDITOR_FONT_MIN,
  useEditorFontSize,
} from '../../theme/AppearanceProvider'
import styles from './SettingsView.module.css'

export default function FontSizeStepper() {
  const { editorFontSize, setEditorFontSize } = useEditorFontSize()
  const atMin = editorFontSize <= EDITOR_FONT_MIN
  const atMax = editorFontSize >= EDITOR_FONT_MAX

  return (
    <div className={styles.stepper}>
      <button
        type="button"
        className={styles.stepperBtn}
        onClick={() => setEditorFontSize(editorFontSize - 1)}
        disabled={atMin}
        aria-label="Decrease editor font size"
      >
        −
      </button>
      <span className={styles.stepperValue} aria-live="polite">
        {editorFontSize}px
      </span>
      <button
        type="button"
        className={styles.stepperBtn}
        onClick={() => setEditorFontSize(editorFontSize + 1)}
        disabled={atMax}
        aria-label="Increase editor font size"
      >
        +
      </button>
    </div>
  )
}
