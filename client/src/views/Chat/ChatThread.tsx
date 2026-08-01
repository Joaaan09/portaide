// ChatThread — hilo de la conversación (DESIGN.md §6): burbujas de usuario,
// mensajes del asistente con sus tool-cards, indicador de streaming y estado
// vacío de chat nuevo. El scroll vive aquí (patrón app-shell, DESIGN.md §5) y
// se pega al fondo cuando entra un item nuevo o mientras streamea la respuesta.
import { useEffect, useRef } from 'react'
import type { ChatItem, ChatSession, UserEditDecision } from './types'
import AssistantMessage from './AssistantMessage'
import styles from './ChatThread.module.css'

interface ChatThreadProps {
  session: ChatSession
  onDecide: (requestId: string, decision: UserEditDecision) => void
  /** Reintenta un mensaje que no llegó al server (burbuja "no entregado"). */
  onRetryMessage: (localId: string) => void
}

/** Umbral de "pegado al fondo": por encima, el usuario está leyendo hacia arriba. */
const STICK_PX = 100

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

/** Señal barata que cambia mientras streamea el último mensaje (para auto-scroll). */
function streamingTick(session: ChatSession): number {
  const last = session.items[session.items.length - 1]
  if (!last || last.kind !== 'assistant') return 0
  let tick = last.blocks.length
  const lb = last.blocks[last.blocks.length - 1]
  if (lb && (lb.type === 'text' || lb.type === 'thinking')) tick += lb.text.length
  return tick
}

export default function ChatThread({ session, onDecide, onRetryMessage }: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /** true si el usuario está pegado al fondo (si no, NO le movemos el scroll). */
  const stickRef = useRef(true)

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
  }

  // Al cambiar de conversación siempre al fondo (y se recupera el "pegado").
  useEffect(() => {
    stickRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.id])

  // Auto-scroll cuando entra un item o mientras crece la respuesta (tick), pero
  // SOLO si el usuario ya estaba al fondo: si está leyendo hacia arriba se
  // respeta su posición (el hilo se reconstruye en cada reconexión y sería
  // insoportable saltar). No depende del array completo para no saltar al
  // aprobar/rechazar una card antigua.
  const lastItem = session.items[session.items.length - 1]
  const lastItemId = lastItem?.id
  const tick = streamingTick(session)
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [lastItemId, tick])

  const renderItem = (item: ChatItem) => {
    switch (item.kind) {
      case 'user':
        return (
          <li key={item.id} className={styles.userItem}>
            <p
              className={
                item.delivery ? `${styles.userBubble} ${styles.userBubblePending}` : styles.userBubble
              }
            >
              {item.text}
            </p>
            {item.delivery === 'failed' && (
              <p className={styles.undelivered}>
                <span className={styles.undeliveredLabel}>⚠ No entregado</span>
                <button
                  type="button"
                  className={styles.undeliveredRetry}
                  onClick={() => onRetryMessage(item.id)}
                >
                  Reintentar
                </button>
              </p>
            )}
          </li>
        )
      case 'assistant':
        return (
          <li key={item.id} className={styles.assistantItem}>
            <div className={styles.assistantCol}>
              <AssistantMessage item={item} onDecide={onDecide} />
              {item.streaming && <TypingIndicator />}
            </div>
          </li>
        )
    }
  }

  return (
    <div ref={scrollRef} className={styles.thread} onScroll={handleScroll}>
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
