// NavPicker — toggle de 2 opciones para el modo de navegación (DESIGN.md §5/§13b).
// Mismo patrón que ThemePicker: grupo de botones toggle con aria-pressed (cada
// botón enfocable por Tab y operable con Enter/Espacio, sin manejo de flechas).
import { useNavMode, type NavMode } from '../../navigation/NavModeProvider'
import styles from './NavPicker.module.css'

const OPTIONS: { id: NavMode; label: string }[] = [
  { id: 'drawer', label: 'Drawer (☰)' },
  { id: 'bottombar', label: 'Barra inferior' },
]

export default function NavPicker() {
  const { navMode, setNavMode } = useNavMode()

  return (
    <div className={styles.group} role="group" aria-label="Navigation mode">
      {OPTIONS.map((o) => {
        const active = o.id === navMode
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            className={active ? `${styles.option} ${styles.optionActive}` : styles.option}
            onClick={() => setNavMode(o.id)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
