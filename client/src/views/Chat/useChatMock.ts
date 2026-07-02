// Estado mock de la vista Chat: sesiones (pestañas), envío con typing simulado
// y decisión Approve/Reject sobre las tool-cards de Edit.
// Es el sustituto temporal del puente real con el CLI `claude` (Fase 3).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatItem, ChatSession, UserEditDecision } from './types'
import { createEmptySession, createInitialSessions, createMockReply, uid } from './mockData'

/** Latencia simulada de la respuesta (el typing se ve ~1.2s) */
const TYPING_MS = 1200

export interface ChatMockApi {
  sessions: ChatSession[]
  activeSession: ChatSession
  activeId: string
  selectSession: (id: string) => void
  addSession: () => void
  sendMessage: (text: string) => void
  decideEdit: (blockId: string, decision: UserEditDecision) => void
}

/** Sustituye los items de una sesión concreta */
function withItems(
  sessions: ChatSession[],
  sessionId: string,
  map: (items: ChatItem[]) => ChatItem[],
): ChatSession[] {
  return sessions.map((s) => (s.id === sessionId ? { ...s, items: map(s.items) } : s))
}

export function useChatMock(): ChatMockApi {
  const [sessions, setSessions] = useState<ChatSession[]>(createInitialSessions)
  const [activeId, setActiveId] = useState(() => '')

  // Un timeout de respuesta por sesión: si se envía otra vez antes de que
  // llegue la respuesta, se reprograma (como hace el mockup con clearTimeout)
  const timersRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0]

  const selectSession = useCallback((id: string) => setActiveId(id), [])

  const addSession = useCallback(() => {
    const next = createEmptySession()
    setSessions((prev) => [...prev, next])
    setActiveId(next.id)
  }, [])

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const sessionId = activeSession.id

      // Burbuja del usuario + typing al final (sustituye un typing anterior si lo hubiera)
      const userItem: ChatItem = { kind: 'user', id: uid('msg'), text: trimmed }
      const typingItem: ChatItem = { kind: 'typing', id: uid('typing') }
      setSessions((prev) =>
        withItems(prev, sessionId, (items) => [
          ...items.filter((item) => item.kind !== 'typing'),
          userItem,
          typingItem,
        ]),
      )

      // Respuesta mock tras la latencia simulada (cae en SU sesión aunque cambies de pestaña)
      const timers = timersRef.current
      const pending = timers.get(sessionId)
      if (pending !== undefined) clearTimeout(pending)
      timers.set(
        sessionId,
        window.setTimeout(() => {
          timers.delete(sessionId)
          setSessions((prev) =>
            withItems(prev, sessionId, (items) => [
              ...items.filter((item) => item.kind !== 'typing'),
              createMockReply(),
            ]),
          )
        }, TYPING_MS),
      )
    },
    [activeSession.id],
  )

  const decideEdit = useCallback((blockId: string, decision: UserEditDecision) => {
    setSessions((prev) =>
      prev.map((session) => ({
        ...session,
        items: session.items.map((item) => {
          if (item.kind !== 'assistant') return item
          const hasBlock = item.blocks.some((b) => b.type === 'edit' && b.id === blockId)
          if (!hasBlock) return item
          return {
            ...item,
            blocks: item.blocks.map((b) =>
              b.type === 'edit' && b.id === blockId ? { ...b, decision } : b,
            ),
          }
        }),
      })),
    )
  }, [])

  return {
    sessions,
    activeSession,
    activeId: activeSession.id,
    selectSession,
    addSession,
    sendMessage,
    decideEdit,
  }
}
