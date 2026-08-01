// TerminalTabs — cabecera de la vista Terminal (DESIGN.md §9): pestañas con
// marcador de estado (punto verde = conectada, rojo = sin conexión, tenue =
// conectando; CUADRADO rojo = la shell murió) + botón `+` para abrir otra. Cada
// pestaña puede cerrarse (mata su pty) cuando hay más de una.
import NavMenuButton from '../../components/NavMenuButton/NavMenuButton'
import type { TabStatus } from './TerminalPane'
import styles from './TerminalView.module.css'

export interface TermTab {
  id: string
  title: string
}

interface TerminalTabsProps {
  tabs: TermTab[]
  activeId: string
  statuses: Record<string, TabStatus>
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
}

function dotClass(status: TabStatus | undefined): string {
  if (status === 'open') return styles.dotOk
  if (status === 'dead') return styles.dotDead
  if (status === 'error' || status === 'closed') return styles.dotDown
  return styles.dotIdle
}

export default function TerminalTabs({
  tabs,
  activeId,
  statuses,
  onSelect,
  onAdd,
  onClose,
}: TerminalTabsProps) {
  const canClose = tabs.length > 1

  return (
    <header className={styles.bar}>
      <NavMenuButton />
      <ul className={styles.tabs} aria-label="Terminales">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId
          return (
            <li
              key={tab.id}
              className={isActive ? `${styles.tabItem} ${styles.tabItemActive}` : styles.tabItem}
            >
              <button
                type="button"
                className={styles.tab}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelect(tab.id)}
              >
                <span className={`${styles.dot} ${dotClass(statuses[tab.id])}`} aria-hidden="true" />
                <span className={styles.tabName}>{tab.title}</span>
                {/* El color/forma del marcador no puede ser el único indicador (§12) */}
                {statuses[tab.id] === 'dead' && (
                  <span className={styles.srOnly}> (shell terminada)</span>
                )}
              </button>
              {canClose && (
                <button
                  type="button"
                  className={styles.tabClose}
                  aria-label={`Cerrar ${tab.title}`}
                  onClick={() => onClose(tab.id)}
                >
                  ✕
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <button type="button" className={styles.add} aria-label="Nueva terminal" onClick={onAdd}>
        +
      </button>
    </header>
  )
}
