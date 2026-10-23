// ChatThread — hilo de la conversación (DESIGN.md §6): burbujas de usuario,
// mensajes del asistente con sus tool-cards, indicador de streaming y estado
// vacío de chat nuevo. El scroll vive aquí (patrón app-shell, DESIGN.md §5) y
// se pega al fondo cuando entra un item nuevo o mientras streamea la respuesta.
// El hilo NO se pinta entero: hay techo de render (ventana, DESIGN.md §6.7).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatItem, ChatSession, UserEditDecision } from './types'
import AssistantMessage from './AssistantMessage'
import styles from './ChatThread.module.css'

interface ChatThreadProps {
  session: ChatSession
  onDecide: (requestId: string, decision: UserEditDecision) => void
  /** Responde una pregunta de Claude (`AskUserQuestion`, DESIGN.md §6.5). */
  onAnswer: (requestId: string, answers: Record<string, string>) => void
  /** Reintenta un mensaje que no llegó al server (burbuja "no entregado"). */
  onRetryMessage: (localId: string) => void
  /** Retira de la cola un mensaje que aún no ha arrancado (DESIGN.md §6.4). */
  onCancelQueued: (localId: string) => void
}

/** Umbral de "pegado al fondo": por encima, el usuario está leyendo hacia arriba. */
const STICK_PX = 100

/** Presupuesto de bloques de una "página" del hilo (DESIGN.md §6.7). */
const WINDOW_BUDGET = 120

/** Tope de la ventana congelada, en múltiplos del presupuesto (DESIGN.md §6.7). */
const FREEZE_MAX_FACTOR = 3

/** Coste de un item en bloques: burbuja = 1; asistente = sus bloques. */
function itemCost(item: ChatItem): number {
  return item.kind === 'assistant' ? Math.max(1, item.blocks.length) : 1
}

/** Ventana visible del hilo: primer item pintado + recorte de su cabecera. */
interface ThreadWindow {
  /** Índice del primer item que se pinta. */
  start: number
  /** Bloques del primer item que NO se pintan (se recorta por su cola). */
  skipBlocks: number
}

/**
 * Ventana del hilo (DESIGN.md §6.7): se recorre desde el final hacia atrás
 * restando coste, y el presupuesto es DURO. Un turno entero del asistente es UN
 * item (hay items de 576 bloques en la base real), así que cuando un item no
 * cabe entero pero queda presupuesto entra **recortado por su cola** y la
 * ventana acaba ahí; contar por mensajes dejaría el techo en nada.
 */
function threadWindow(items: ChatItem[], budget: number): ThreadWindow {
  let left = budget
  let win: ThreadWindow = { start: items.length, skipBlocks: 0 }
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const cost = itemCost(items[i])
    if (cost <= left) {
      left -= cost
      win = { start: i, skipBlocks: 0 }
      continue
    }
    if (left > 0) win = { start: i, skipBlocks: cost - left }
    break
  }
  // Siempre al menos un item visible, aunque no quepa en el presupuesto.
  if (win.start >= items.length && items.length > 0) {
    const last = items.length - 1
    win = { start: last, skipBlocks: Math.max(0, itemCost(items[last]) - 1) }
  }
  return win
}

/** Bloques que pinta una ventana (para no dejar que la congelación la infle). */
function visibleBlocks(items: ChatItem[], win: ThreadWindow): number {
  let total = -win.skipBlocks
  for (let i = win.start; i < items.length; i += 1) total += itemCost(items[i]!)
  return total
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

/** Señal barata que cambia mientras streamea el último mensaje (para auto-scroll). */
function streamingTick(session: ChatSession): number {
  const last = session.items[session.items.length - 1]
  if (!last || last.kind !== 'assistant') return 0
  let tick = last.blocks.length
  const lb = last.blocks[last.blocks.length - 1]
  if (lb && (lb.type === 'text' || lb.type === 'thinking')) tick += lb.text.length
  return tick
}

export default function ChatThread({
  session,
  onDecide,
  onAnswer,
  onRetryMessage,
  onCancelQueued,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const earlierRef = useRef<HTMLButtonElement>(null)
  /** true si el usuario está pegado al fondo (si no, NO le movemos el scroll). */
  const stickRef = useRef(true)
  /** Presupuesto de la ventana: crece a golpes de +120 con el botón (§6.7). */
  const [budget, setBudget] = useState(WINDOW_BUDGET)
  /** scrollHeight justo antes de ampliar, para conservar la posición de lectura. */
  const growAnchorRef = useRef<number | null>(null)
  /** Ventana congelada mientras se lee hacia arriba (id del primer item + recorte). */
  const frozenRef = useRef<ThreadWindow & { id: string } | null>(null)
  /** Items revelados al ampliar: no animan nunca más (§6.7). Ids, no índices. */
  const noAnimIdsRef = useRef<Set<string>>(new Set())
  /** Primer item visible en el momento del tap: lo de encima queda "revelado". */
  const pendingRevealRef = useRef<string | null>(null)
  /** true si tras ampliar hay que recolocar el foco (el botón puede desaparecer). */
  const refocusRef = useRef(false)
  /** Fuerza un render cuando el usuario vuelve al fondo (descongela la ventana). */
  const [, bumpStick] = useState(0)

  // Al cambiar de conversación la ventana vuelve al mínimo EN ESTE MISMO render
  // (§6.7): con un efecto, el primer commit pintaría la conversación nueva con
  // el presupuesto crecido de la anterior — justo el pico que se quiere evitar.
  const [prevSessionId, setPrevSessionId] = useState(session.id)
  const sessionChanged = prevSessionId !== session.id
  if (sessionChanged) {
    setPrevSessionId(session.id)
    setBudget(WINDOW_BUDGET)
    stickRef.current = true
    frozenRef.current = null
    growAnchorRef.current = null
    noAnimIdsRef.current = new Set()
    pendingRevealRef.current = null
  }

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const stuck = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
    const was = stickRef.current
    stickRef.current = stuck
    // Volver al fondo DESCONGELA la ventana (§6.7). Sin este render el recálculo
    // esperaría al siguiente evento del store: con el turno ya terminado, no
    // llegaría ninguno y el DOM inflado se quedaría puesto.
    if (stuck && !was) bumpStick((n) => n + 1)
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

  // Tras ampliar: (1) el contenido entra POR ARRIBA, así que se compensa el
  // scroll con lo que ha crecido el hilo y no se mueve lo que estabas leyendo;
  // (2) si el botón ha desaparecido (ya no queda historia oculta) el foco no
  // puede caer al <body> → pasa a la lista. Corre antes de pintar: no se ve.
  useLayoutEffect(() => {
    const before = growAnchorRef.current
    if (before != null) {
      growAnchorRef.current = null
      const el = scrollRef.current
      if (el) el.scrollTop += el.scrollHeight - before
    }
    if (refocusRef.current) {
      refocusRef.current = false
      if (!earlierRef.current) listRef.current?.focus({ preventScroll: true })
    }
  })

  const items = session.items
  let win = threadWindow(items, sessionChanged ? WINDOW_BUDGET : budget)
  // La ventana NO encoge mientras lees hacia arriba (§6.7): con un turno vivo,
  // cada bloque nuevo empujaría el borde superior y desmontaría lo que miras.
  // Gana la que muestre MÁS, así que un tap en "mostrar anteriores" sí amplía.
  if (!stickRef.current && frozenRef.current) {
    const frozen = frozenRef.current
    const idx = items.findIndex((it) => it.id === frozen.id)
    if (
      idx >= 0 &&
      (idx < win.start || (idx === win.start && frozen.skipBlocks < win.skipBlocks))
    ) {
      const held: ThreadWindow = { start: idx, skipBlocks: frozen.skipBlocks }
      // Pero la congelación NO puede quitar el techo (§6.7): con el turno vivo,
      // el borde inferior sigue creciendo y sin este tope la ventana acababa
      // siendo la conversación entera. Pasado el límite, el borde superior
      // avanza y el scroll se compensa (el efecto admite delta negativo), así
      // que tampoco salta lo que estás leyendo.
      if (visibleBlocks(items, held) <= budget * FREEZE_MAX_FACTOR) win = held
      else growAnchorRef.current = scrollRef.current?.scrollHeight ?? null
    }
  }
  const first = items[win.start]

  const visibleItems = win.start > 0 ? items.slice(win.start) : items
  const hasEarlier = win.start > 0 || win.skipBlocks > 0
  // Los revelados al ampliar se apuntan por id y ya no animan nunca: si se
  // marcaran por posición, la siguiente ampliación se los quitaría y CSS
  // arrancaría su animación (cambiar `animation-name` la dispara).
  if (pendingRevealRef.current) {
    const idx = visibleItems.findIndex((it) => it.id === pendingRevealRef.current)
    if (idx >= 0) {
      for (let i = 0; i < idx; i += 1) noAnimIdsRef.current.add(visibleItems[i]!.id)
      pendingRevealRef.current = null
    }
  }

  // La ventana del ÚLTIMO COMMIT, apuntada fuera del render (un render que React
  // descarte no debe dejar la congelación adelantada).
  useLayoutEffect(() => {
    frozenRef.current = first ? { id: first.id, ...win } : null
  })

  const showEarlier = () => {
    growAnchorRef.current = scrollRef.current?.scrollHeight ?? null
    pendingRevealRef.current = first?.id ?? null
    refocusRef.current = document.activeElement === earlierRef.current
    // Se recalcula con el presupuesto nuevo (la congelación no debe frenarla).
    frozenRef.current = null
    setBudget((b) => b + WINDOW_BUDGET)
  }

  const renderItem = (item: ChatItem, index: number) => {
    // Los items revelados al ampliar entran sin animación (§6.7): animar cien
    // elementos es justo el commit que se quiere barato.
    const still = noAnimIdsRef.current.has(item.id)
    switch (item.kind) {
      case 'user':
        return (
          <li key={item.id} className={still ? `${styles.userItem} ${styles.noAnim}` : styles.userItem}>
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
            {/* En cola: escrito mientras Claude trabajaba; aún se puede retirar */}
            {item.delivery === 'queued' && (
              <p className={styles.undelivered}>
                <span className={styles.queuedLabel}>⏳ En cola</span>
                <button
                  type="button"
                  className={`${styles.undeliveredRetry} ${styles.queuedCancel}`}
                  onClick={() => onCancelQueued(item.id)}
                >
                  Cancelar
                </button>
              </p>
            )}
          </li>
        )
      case 'assistant':
        // Un mensaje del asistente SIN contenido y ya cerrado no se pinta: al
        // escribir a mitad de trabajo, la burbuja del usuario parte el mensaje
        // en dos y a veces el tramo siguiente se cierra vacío. Pintarlo dejaba
        // una cabecera "✦ Claude Code" huérfana en medio del hilo.
        if (item.blocks.length === 0 && !item.streaming) return null
        return (
          <li
            key={item.id}
            className={still ? `${styles.assistantItem} ${styles.noAnim}` : styles.assistantItem}
          >
            <div className={styles.assistantCol}>
              <AssistantMessage
                item={item}
                // Solo el PRIMER item visible puede venir recortado (§6.7); en
                // el resto es 0 constante, así que la memo sigue siendo efectiva.
                skipBlocks={index === 0 ? win.skipBlocks : 0}
                onDecide={onDecide}
                onAnswer={onAnswer}
              />
              {item.streaming && <TypingIndicator />}
            </div>
          </li>
        )
    }
  }

  return (
    <div ref={scrollRef} className={styles.thread} onScroll={handleScroll} data-ptr="off">
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Fuera de la lista a propósito: es un control, no un mensaje. */}
          {hasEarlier && (
            <button
              ref={earlierRef}
              type="button"
              className={styles.showEarlier}
              onClick={showEarlier}
            >
              <span className={styles.showEarlierIcon} aria-hidden="true">
                ▲
              </span>
              Mostrar mensajes anteriores
            </button>
          )}
          <ol
            ref={listRef}
            tabIndex={-1}
            className={styles.list}
            aria-label="Mensajes de la conversación"
          >
            {visibleItems.map(renderItem)}
          </ol>
        </>
      )}
    </div>
  )
}
