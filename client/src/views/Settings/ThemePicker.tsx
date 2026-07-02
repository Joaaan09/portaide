// ThemePicker — 3 swatches de tema (DESIGN.md §10). Cada uno previsualiza el
// acento del tema (tokens --accent-{id}, siempre disponibles en tokens.css) y su
// nombre; el activo lleva anillo de acento. Grupo de botones toggle con
// aria-pressed (más robusto que un radiogroup a medias: cada botón es
// enfocable por Tab y operable con Enter/Espacio sin manejo de flechas propio).
import { THEMES, useTheme } from '../../theme/ThemeProvider'
import styles from './SettingsView.module.css'

export default function ThemePicker() {
  const { theme, setTheme } = useTheme()

  return (
    <div className={styles.swatches} role="group" aria-label="Theme">
      {THEMES.map((t) => {
        const active = t.id === theme
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={active}
            data-theme-id={t.id}
            className={`${styles.swatch} ${active ? styles.swatchActive : ''}`}
            onClick={() => setTheme(t.id)}
          >
            <span className={styles.swatchDot} aria-hidden="true" />
            <span className={styles.swatchLabel}>{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}
