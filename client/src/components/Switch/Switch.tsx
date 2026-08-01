// Switch — interruptor on/off del sistema de diseño (DESIGN.md §10.1).
// `<button role="switch">` con `aria-checked`: enfocable por Tab y operable con
// Enter/Espacio sin código extra. El nombre accesible lo aporta quien lo usa
// (`labelledBy` apunta al texto de su fila).
import styles from './Switch.module.css'

interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** id del elemento que da nombre accesible al control. */
  labelledBy?: string
}

export default function Switch({ checked, onChange, disabled = false, labelledBy }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.track}>
        <span className={styles.knob} />
      </span>
    </button>
  )
}
