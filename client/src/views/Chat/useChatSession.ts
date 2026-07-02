// useChatSession — fachada React del store del chat (chatStore.ts). Sustituye al
// antiguo mock: gestiona (a través del singleton) el WebSocket a /ws/chat, el
// estado del hilo y las aprobaciones reales. El estado vive en el store para
// sobrevivir al remontaje de ChatView (AppShell usa key={view}); aquí sólo lo
// leemos con useSyncExternalStore y exponemos las acciones.
import { useSyncExternalStore } from 'react'
import type {
  ChatEffortSetting,
  ChatPermissionMode,
  ChatSession,
  UserEditDecision,
} from './types'
import { chatStore, EFFORT_STEPS, MODEL_OPTIONS, type ConnStatus } from './chatStore'

export interface ChatApi {
  sessions: ChatSession[]
  activeSession: ChatSession
  activeId: string
  model: string
  permissionMode: ChatPermissionMode
  effort: ChatEffortSetting
  connStatus: ConnStatus
  loading: boolean
  modelOptions: { value: string; label: string }[]
  effortOptions: { value: ChatEffortSetting; label: string }[]
  selectSession: (id: string) => void
  addSession: () => void
  /** Envía un mensaje del usuario en la conversación activa (con el cwd del workspace). */
  sendMessage: (text: string, cwd: string | null) => void
  /** Approve/Reject real de una tool pendiente (manda permission_decision). */
  decide: (requestId: string, decision: UserEditDecision) => void
  setModel: (model: string) => void
  setPermissionMode: (mode: ChatPermissionMode) => void
  setEffort: (effort: ChatEffortSetting) => void
  interrupt: () => void
}

/** Sesión de respaldo mientras el store resuelve la lista inicial (evita undefined). */
const PLACEHOLDER: ChatSession = { id: '', name: 'new chat', items: [] }

export function useChatSession(): ChatApi {
  const snap = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot)
  const activeSession = snap.sessions.find((s) => s.id === snap.activeId) ?? snap.sessions[0] ?? PLACEHOLDER

  return {
    sessions: snap.sessions,
    activeSession,
    activeId: activeSession.id,
    model: snap.model,
    permissionMode: snap.permissionMode,
    effort: snap.effort,
    connStatus: snap.connStatus,
    loading: snap.loading,
    modelOptions: MODEL_OPTIONS,
    effortOptions: EFFORT_STEPS,
    selectSession: chatStore.selectSession,
    addSession: chatStore.addSession,
    sendMessage: chatStore.sendMessage,
    decide: chatStore.decide,
    setModel: chatStore.setModel,
    setPermissionMode: chatStore.setPermissionMode,
    setEffort: chatStore.setEffort,
    interrupt: chatStore.interrupt,
  }
}
