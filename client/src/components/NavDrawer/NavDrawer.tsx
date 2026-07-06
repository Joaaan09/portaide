// NavDrawer — panel lateral de navegación (DESIGN.md §5/§13b). Modo por defecto:
// se abre con el botón ☰ de la cabecera y desliza desde la izquierda. Lista los 5
// destinos (VIEWS); al tocar uno navega y se cierra. Accesible: role="dialog",
// aria-modal, focus-trap, cierre con Esc y devolución de foco al cerrar.
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { VIEWS, useNavigation, type ViewId } from '../../navigation/NavigationProvider'
import { useNavMode } from '../../navigation/NavModeProvider'
import styles from './NavDrawer.module.css'

export default function NavDrawer() {
  const { navMode, drawerOpen, closeDrawer } = useNavMode()
  const { view, setView } = useNavigation()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  const isOpen = navMode === 'drawer' && drawerOpen

  // Al abrir: recuerda el foco actual y enfoca el primer destino. Al cerrar
  // (cleanup): devuelve el foco al disparador (el ☰).
  useEffect(() => {
    if (!isOpen) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('[data-drawer-focus]')
    first?.focus()
    return () => {
      previouslyFocused.current?.focus?.()
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeDrawer()
      return
    }
    if (event.key !== 'Tab') return
    // Focus-trap: mantiene el tabulador dentro del panel.
    const panel = panelRef.current
    if (!panel) return
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const go = (id: ViewId) => {
    setView(id)
    closeDrawer()
  }

  return (
    <div className={styles.root} onKeyDown={handleKeyDown}>
      <div className={styles.scrim} onClick={closeDrawer} aria-hidden="true" />
      <div ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-label="Navegación">
        <div className={styles.head}>
          <span className={styles.wordmark}>PortaIDE</span>
        </div>
        <nav className={styles.list} aria-label="Vistas">
          {VIEWS.map((v, index) => {
            const active = v.id === view
            return (
              <button
                key={v.id}
                type="button"
                data-drawer-focus={index === 0 ? '' : undefined}
                className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
                aria-current={active ? 'page' : undefined}
                onClick={() => go(v.id)}
              >
                <span className={styles.itemIcon} aria-hidden="true">
                  {v.icon}
                </span>
                <span className={styles.itemLabel}>{v.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
