// ChatTabs — cabecera de la vista Chat (DESIGN.md §6, mockup canónico):
// pestañas de conversaciones (✦ + nombre; activa con subrayado --accent y
// fondo --surface2) + botón `+` para abrir un chat nuevo.
import { useEffect, useRef } from 'react'
import type { ChatSession } from './types'
import styles from './ChatTabs.module.css'

interface ChatTabsProps {
  sessions: ChatSession[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
}

export default function ChatTabs({ sessions, activeId, onSelect, onAdd }: ChatTabsProps) {
  const activeTabRef = useRef<HTMLButtonElement>(null)

  // La pestaña activa siempre visible en la fila scrollable (p.ej. al crear un chat)
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  return (
    <header className={styles.bar}>
      <ul className={styles.tabs} aria-label="Conversaciones">
        {sessions.map((session) => {
          const isActive = session.id === activeId
          return (
            <li key={session.id} className={styles.tabItem}>
              <button
                ref={isActive ? activeTabRef : undefined}
                type="button"
                className={isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelect(session.id)}
              >
                <span className={styles.tabIcon} aria-hidden="true">
                  ✦
                </span>
                <span className={styles.tabName}>{session.name}</span>
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
