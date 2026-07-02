// ChatThread — hilo de la conversación (DESIGN.md §6): burbujas de usuario,
// mensajes del asistente, indicador de typing y estado vacío de chat nuevo.
// El scroll vive aquí (patrón app-shell, DESIGN.md §5) y baja solo al fondo
// cuando entra un item nuevo o se cambia de conversación.
import { useEffect, useRef } from 'react'
import type { ChatItem, ChatSession, UserEditDecision } from './types'
import AssistantMessage from './AssistantMessage'
import styles from './ChatThread.module.css'

interface ChatThreadProps {
  session: ChatSession
  onDecideEdit: (blockId: string, decision: UserEditDecision) => void
}

/* Tres puntos --accent con la animación `dot` (DESIGN.md §11) */
function TypingIndicator() {
  return (
    <div className={styles.typing} role="status" aria-label="Claude Code está escribiendo">
      <span className={styles.typingDot} aria-hidden="true" />
      <span className={styles.typingDot} aria-hidden="true" />
      <span className={styles.typingDot} aria-hidden="true" />
    </div>
  )
}

/* Estado inicial de un chat recién creado */
function EmptyState() {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        ✦
      </span>
      <p className={styles.emptyTitle}>New chat</p>
      <p className={styles.emptyHint}>Ask Claude about this project — build, fix, refactor.</p>
    </div>
  )
}

export default function ChatThread({ session, onDecideEdit }: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll al fondo cuando entra un item (mensaje o typing) o al cambiar
  // de conversación. Depende del ÚLTIMO id y no del array completo para no
  // saltar al fondo al aprobar/rechazar una card antigua.
  const lastItem = session.items[session.items.length - 1]
  const lastItemId = lastItem?.id
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.id, lastItemId])

  const renderItem = (item: ChatItem) => {
    switch (item.kind) {
      case 'user':
        return (
          <li key={item.id} className={styles.userItem}>
            <p className={styles.userBubble}>{item.text}</p>
          </li>
        )
      case 'assistant':
        return (
          <li key={item.id} className={styles.assistantItem}>
            <AssistantMessage item={item} onDecideEdit={onDecideEdit} />
          </li>
        )
      case 'typing':
        return (
          <li key={item.id} className={styles.assistantItem}>
            <TypingIndicator />
          </li>
        )
    }
  }

  return (
    <div ref={scrollRef} className={styles.thread}>
      {session.items.length === 0 ? (
        <EmptyState />
      ) : (
        <ol className={styles.list} aria-label="Mensajes de la conversación">
          {session.items.map(renderItem)}
        </ol>
      )}
    </div>
  )
}
