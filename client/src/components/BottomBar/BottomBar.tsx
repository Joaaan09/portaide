// BottomBar — barra de navegación inferior fija (DESIGN.md §5/§13b). Modo
// alternativo al drawer: 5 destinos siempre visibles al borde inferior. En este
// modo el ☰ de las cabeceras se auto-oculta y --nav-inset reserva su altura.
import { VIEWS, useNavigation } from '../../navigation/NavigationProvider'
import { useNavMode } from '../../navigation/NavModeProvider'
import styles from './BottomBar.module.css'

export default function BottomBar() {
  const { navMode } = useNavMode()
  const { view, setView } = useNavigation()

  if (navMode !== 'bottombar') return null

  return (
    <nav className={styles.bar} aria-label="Navegación principal">
      {VIEWS.map((v) => {
        const active = v.id === view
        return (
          <button
            key={v.id}
            type="button"
            className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
            aria-current={active ? 'page' : undefined}
            onClick={() => setView(v.id)}
          >
            <span className={styles.icon} aria-hidden="true">
              {v.icon}
            </span>
            <span className={styles.label}>{v.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
