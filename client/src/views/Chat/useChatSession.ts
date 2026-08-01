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
  /** Estado del socket del chat (lo pinta la tira de conexión, DESIGN.md §6.3). */
  connStatus: ConnStatus
  loading: boolean
  /** true si la lista de conversaciones no cargó (se reintenta sola + botón). */
  sessionsError: boolean
  modelOptions: { value: string; label: string }[]
  effortOptions: { value: ChatEffortSetting; label: string }[]
  selectSession: (id: string) => void
  addSession: () => void
  /** Cierra una pestaña (NO la borra): la marca open:false y reactiva un vecino. */
  closeSession: (id: string) => void
  /** Borra de verdad una conversación (historial) y la quita de la tira si estaba abierta. */
  deleteSession: (id: string) => void
  /** Reabre una conversación del historial como pestaña, la activa y rehidrata su hilo. */
  reopenSession: (meta: { id: string; title: string; claudeSessionId?: string | null }) => void
  /** Renombra una conversación (optimista + PATCH best-effort). */
  renameSession: (id: string, title: string) => void
  /** Historial completo (scope=all) para el panel; NO entra en el snapshot. */
  fetchHistory: () => Promise<
    Array<{ id: string; title: string; updatedAt: string; open: boolean; claudeSessionId?: string | null }>
  >
  /** Historial REAL del engine (~/.claude/projects) del proyecto abierto; POR PROYECTO (cwd). */
  fetchEngineHistory: (
    cwd: string | null,
  ) => Promise<Array<{ id: string; title: string; updatedAt: string; gitBranch: string | null; messageCount: number }>>
  /** Abre una conversación del engine (transcript .jsonl): la materializa, repinta y reanuda. */
  openEngineSession: (meta: { id: string; cwd: string | null }) => void
  /** Envía un mensaje del usuario en la conversación activa (con el cwd del workspace). */
  sendMessage: (text: string, cwd: string | null) => void
  /** Reintenta un mensaje marcado como no entregado (por su localId = id de la burbuja). */
  retryMessage: (localId: string) => void
  /** Approve/Reject real de una tool pendiente (manda permission_decision). */
  decide: (requestId: string, decision: UserEditDecision) => void
  setModel: (model: string) => void
  setPermissionMode: (mode: ChatPermissionMode) => void
  setEffort: (effort: ChatEffortSetting) => void
  interrupt: () => void
  /** Reintento manual de conexión + carga de la tira (botón de la tira de estado). */
  retryConnection: () => void
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
    sessionsError: snap.sessionsError,
    modelOptions: MODEL_OPTIONS,
    effortOptions: EFFORT_STEPS,
    selectSession: chatStore.selectSession,
    addSession: chatStore.addSession,
    closeSession: chatStore.closeSession,
    deleteSession: chatStore.deleteSession,
    reopenSession: chatStore.reopenSession,
    renameSession: chatStore.renameSession,
    fetchHistory: chatStore.fetchHistory,
    fetchEngineHistory: chatStore.fetchEngineHistory,
    openEngineSession: chatStore.openEngineSession,
    sendMessage: chatStore.sendMessage,
    retryMessage: chatStore.retryMessage,
    decide: chatStore.decide,
    setModel: chatStore.setModel,
    setPermissionMode: chatStore.setPermissionMode,
    setEffort: chatStore.setEffort,
    interrupt: chatStore.interrupt,
    retryConnection: chatStore.retryConnection,
  }
}
