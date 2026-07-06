// NavMenuButton — botón ☰ que abre el drawer de navegación (DESIGN.md §5/§13b).
// Va como primer elemento (izquierda) de la cabecera de cada vista. Se auto-oculta
// en modo barra inferior (retorna null): ahí la navegación vive en la barra fija.
import { useNavMode } from '../../navigation/NavModeProvider'
import styles from './NavMenuButton.module.css'

export default function NavMenuButton() {
  const { navMode, drawerOpen, openDrawer } = useNavMode()

  // En modo barra inferior el ☰ no aplica: la navegación está siempre visible abajo.
  if (navMode !== 'drawer') return null

  return (
    <button
      type="button"
      className={styles.button}
      aria-label="Abrir navegación"
      aria-expanded={drawerOpen}
      onClick={openDrawer}
    >
      {/* Hamburguesa de 3 líneas; el nombre va en el aria-label */}
      <span className={styles.burger} aria-hidden="true">
        <span className={styles.line} />
        <span className={styles.line} />
        <span className={styles.line} />
      </span>
    </button>
  )
}
