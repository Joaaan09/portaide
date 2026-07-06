// ChatTabs — cabecera de la vista Chat (DESIGN.md §6, mockup canónico):
// pestañas de conversaciones (✦ + nombre; activa con subrayado --accent y
// fondo --surface2), botón ✕ por pestaña para cerrarla y botón `+` para abrir
// un chat nuevo.
import { useEffect, useRef } from 'react'
import type { MouseEvent } from 'react'
import NavMenuButton from '../../components/NavMenuButton/NavMenuButton'
import type { ChatSession } from './types'
import styles from './ChatTabs.module.css'

interface ChatTabsProps {
  sessions: ChatSession[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  /** Abre el panel de historial de conversaciones (DESIGN.md §6.2). */
  onOpenHistory: () => void
}

export default function ChatTabs({
  sessions,
  activeId,
  onSelect,
  onAdd,
  onClose,
  onOpenHistory,
}: ChatTabsProps) {
  const activeTabRef = useRef<HTMLButtonElement>(null)

  // La pestaña activa siempre visible en la fila scrollable (p.ej. al crear un chat)
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  // Cerrar no debe cambiar de pestaña: corta la propagación al contenedor.
  const handleClose = (event: MouseEvent, id: string) => {
    event.stopPropagation()
    onClose(id)
  }

  return (
    <header className={styles.bar}>
      <NavMenuButton />
      <ul className={styles.tabs} aria-label="Conversaciones">
        {sessions.map((session) => {
          const isActive = session.id === activeId
          return (
            <li
              key={session.id}
              className={isActive ? `${styles.tabItem} ${styles.tabItemActive}` : styles.tabItem}
            >
              <button
                ref={isActive ? activeTabRef : undefined}
                type="button"
                className={styles.tab}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelect(session.id)}
              >
                <span className={styles.tabIcon} aria-hidden="true">
                  ✦
                </span>
                <span className={styles.tabName}>{session.name}</span>
              </button>
              <button
                type="button"
                className={styles.tabClose}
                aria-label={`Cerrar ${session.name}`}
                onClick={(event) => handleClose(event, session.id)}
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        className={`${styles.add} ${styles.history}`}
        aria-label="Historial de conversaciones"
        onClick={onOpenHistory}
      >
        <svg
          viewBox="0 0 24 24"
          width="17"
          height="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 1.8" />
        </svg>
      </button>
      <button type="button" className={styles.add} aria-label="Nuevo chat" onClick={onAdd}>
        +
      </button>
    </header>
  )
}
