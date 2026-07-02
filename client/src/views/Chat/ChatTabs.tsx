// ChatTabs — cabecera de la vista Chat (DESIGN.md §6, mockup canónico):
// pestañas de conversaciones (✦ + nombre; activa con subrayado --accent y
// fondo --surface2), botón ✕ por pestaña para cerrarla y botón `+` para abrir
// un chat nuevo.
import { useEffect, useRef } from 'react'
import type { MouseEvent } from 'react'
import type { ChatSession } from './types'
import styles from './ChatTabs.module.css'

interface ChatTabsProps {
  sessions: ChatSession[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
}

export default function ChatTabs({ sessions, activeId, onSelect, onAdd, onClose }: ChatTabsProps) {
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
      <button type="button" className={styles.add} aria-label="Nuevo chat" onClick={onAdd}>
        +
      </button>
    </header>
  )
}
