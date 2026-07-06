// Store del Chat (singleton a nivel de módulo). Gestiona UNA conexión WebSocket
// multiplexada a /ws/chat y el estado de todas las pestañas/hilos.
//
// Protocolo (SessionRuntime, decisiones.md · "Chat en segundo plano"): el turno
// vive en el server, desacoplado del socket. El cliente:
//   - `attach{sessionId}` a cada pestaña → recibe `snapshot{events,status,...}`
//     (log AUTORITATIVO del hilo) y luego `event{event}` en vivo + `status{...}`.
//   - `message{sessionId,localId,text,...}` para enviar (arranca/encola turno).
//   - `stop` / `permission` / `set_model` / `set_permission_mode`, todos con sessionId.
// El server es la fuente de verdad del hilo (lo persiste él); el cliente solo
// ENSAMBLA el log de eventos (`LogEvent[]`) en los bloques de UI y gestiona la
// META de las pestañas por REST (título, open, borrado). Singleton A PROPÓSITO:
// AppShell remonta ChatView con key={view}; el estado y el socket sobreviven.
import type {
  AssistantBlock,
  AssistantChatItem,
  ChatEffortSetting,
  ChatItem,
  ChatPermissionMode,
  ChatSession,
  DiffLine,
  EditDecision,
  UserEditDecision,
} from './types'

/**
 * Modelos seleccionables. El valor es el alias (robusto: resuelve al último de
 * cada familia); '' = default del engine (config de ~/.claude). La etiqueta
 * lleva la versión concreta (informativa; el alias sigue mandando).
 */
export const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Por defecto' },
  { value: 'fable', label: 'Fable 5' },
  { value: 'opus', label: 'Opus 4.8' },
  { value: 'sonnet', label: 'Sonnet 5' },
  { value: 'haiku', label: 'Haiku 4.5' },
]

/**
 * Topes del slider de esfuerzo. 'auto' = no enviar effort (default del engine).
 * 'ultracode' es el tope superior (tras Max): no es un nivel de effort, activa
 * los workflows multiagente del SDK y manda effort 'max' (ver `sendMessage`).
 */
export const EFFORT_STEPS: { value: ChatEffortSetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' },
  { value: 'ultracode', label: 'Ultracode' },
]

export type ConnStatus = 'connecting' | 'open' | 'closed'

/** Foto inmutable que consume el hook (useSyncExternalStore). */
export interface StoreSnapshot {
  sessions: ChatSession[]
  activeId: string
  model: string
  permissionMode: ChatPermissionMode
  effort: ChatEffortSetting
  connStatus: ConnStatus
  loading: boolean
}

// --- Preferencias persistidas (localStorage) -------------------------------

const LS_MODEL = 'portaide:chat:model'
const LS_PERMISSION = 'portaide:chat:permission'
const LS_EFFORT = 'portaide:chat:effort'
const LS_ACTIVE = 'portaide:chat:activeId'

const MODEL_VALUES = new Set(MODEL_OPTIONS.map((o) => o.value))
const PERMISSION_VALUES: ReadonlySet<ChatPermissionMode> = new Set([
  'default',
  'plan',
  'acceptEdits',
  'bypassPermissions',
])
const EFFORT_VALUES = new Set(EFFORT_STEPS.map((o) => o.value))

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null // modo privado / storage deshabilitado
  }
}

function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* cuota llena / storage deshabilitado: la preferencia vive solo en memoria */
  }
}

function initialModel(): string {
  const v = lsGet(LS_MODEL)
  return v !== null && MODEL_VALUES.has(v) ? v : ''
}

function initialPermission(): ChatPermissionMode {
  const v = lsGet(LS_PERMISSION)
  return v !== null && PERMISSION_VALUES.has(v as ChatPermissionMode)
    ? (v as ChatPermissionMode)
    : 'default'
}

function initialEffort(): ChatEffortSetting {
  const v = lsGet(LS_EFFORT)
  return v !== null && EFFORT_VALUES.has(v as ChatEffortSetting)
    ? (v as ChatEffortSetting)
    : 'auto'
}

// --- Utilidades ------------------------------------------------------------

let seq = 0
function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

/** id de sesión: UUID (compartido con el server) con fallback a uid('chat'). */
function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* crypto no disponible: se usa el fallback */
  }
  return uid('chat')
}

function chatWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/chat`
}

/** Últimos 2 segmentos de una ruta (legible en móvil): `services/auth.ts`. */
function shortPath(p: unknown): string {
  if (typeof p !== 'string' || !p) return ''
  const parts = p.split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

/** Resumen corto del input de una tool genérica (para la meta de la card). */
function shortInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    for (const key of ['command', 'pattern', 'file_path', 'path', 'url', 'query', 'prompt']) {
      if (typeof o[key] === 'string') return String(o[key])
    }
  }
  return ''
}

/** Construye el diff de una tool Edit/Write a partir de su input. */
function buildEditBlock(
  id: string,
  name: string,
  input: unknown
): Extract<AssistantBlock, { type: 'edit' }> {
  const o = (input ?? {}) as Record<string, unknown>
  const file = shortPath(o.file_path ?? o.path)
  const diff: DiffLine[] = []
  let additions = 0
  let deletions = 0

  const pushPair = (oldStr: string, newStr: string): void => {
    const del = oldStr === '' ? [] : oldStr.split('\n')
    const add = newStr === '' ? [] : newStr.split('\n')
    del.forEach((text) => diff.push({ kind: 'del', text }))
    add.forEach((text) => diff.push({ kind: 'add', text }))
    deletions += del.length
    additions += add.length
  }

  if (name === 'Write') {
    pushPair('', typeof o.content === 'string' ? o.content : '')
  } else if (name === 'MultiEdit' && Array.isArray(o.edits)) {
    for (const e of o.edits as Record<string, unknown>[]) {
      pushPair(
        typeof e.old_string === 'string' ? e.old_string : '',
        typeof e.new_string === 'string' ? e.new_string : ''
      )
    }
  } else {
    pushPair(
      typeof o.old_string === 'string' ? o.old_string : '',
      typeof o.new_string === 'string' ? o.new_string : ''
    )
  }

  return { type: 'edit', id, file, additions, deletions, diff, decision: 'pending' }
}

/** Mapea un tool_use a su bloque de UI (Read / Edit / Bash / genérico). */
function buildToolBlock(id: string, name: string, input: unknown): AssistantBlock {
  if (name === 'Read') {
    return { type: 'read', id, file: shortPath((input as Record<string, unknown>)?.file_path), meta: 'reading…' }
  }
  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') {
    return buildEditBlock(id, name, input)
  }
  if (name === 'Bash') {
    const command = String((input as Record<string, unknown>)?.command ?? '')
    return { type: 'bash', id, command, output: [], decision: 'pending' }
  }
  return { type: 'tool', id, name, meta: shortInput(input), decision: 'pending' }
}

/** Heurística ligera: línea de salida "buena" (PASS/✓) → verde (DESIGN §6). */
function bashLineOk(text: string): boolean {
  return /(\bPASS\b|✓|\bpassed\b|\bok\b)/i.test(text)
}

// --- Ensamblado del log de eventos → bloques de UI -------------------------
// El server manda el hilo como LOG DE EVENTOS (LogEvent = eventos del bridge +
// burbuja de usuario). Aquí se ensamblan en items/bloques. `Assembler` es el
// acumulador mutable: se usa igual para el snapshot completo (bucle) y para cada
// evento en vivo (partiendo del estado actual). Muta `items` reemplazando por
// objetos NUEVOS los items que cambian (inmutabilidad a nivel de item → React).

/** Evento del log del hilo (protocolo server→cliente). */
type LogEvent =
  | { type: 'user'; id: string; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'thinking'; delta: string }
  | { type: 'thinking_done' }
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; output?: string }
  | { type: 'permission_request'; requestId: string; toolName: string; input: unknown }
  | { type: 'assistant_done' }
  | { type: 'result'; subtype: string }
  | { type: 'error'; message: string }

interface Assembler {
  items: ChatItem[]
  /** id del mensaje del asistente "abierto" (recibe los bloques del turno en curso). */
  openId: string | null
  thinkingOpen: boolean
}

function openAssistant(acc: Assembler): void {
  const id = uid('a')
  acc.items.push({ kind: 'assistant', id, blocks: [], streaming: true })
  acc.openId = id
  acc.thinkingOpen = false
}

/** Índice del assistant abierto en acc.items (-1 si ninguno). */
function openIdx(acc: Assembler): number {
  if (!acc.openId) return -1
  return acc.items.findIndex((it) => it.kind === 'assistant' && it.id === acc.openId)
}

/** Aplica `fn` a los bloques del assistant abierto (abre uno si no hay). */
function mutateBlocks(acc: Assembler, fn: (blocks: AssistantBlock[]) => AssistantBlock[]): void {
  let idx = openIdx(acc)
  if (idx < 0) {
    openAssistant(acc)
    idx = acc.items.length - 1
  }
  const it = acc.items[idx] as AssistantChatItem
  acc.items[idx] = { ...it, blocks: fn(it.blocks) }
}

/** Cierra el assistant abierto (marca streaming:false). */
function closeAssistant(acc: Assembler): void {
  const idx = openIdx(acc)
  if (idx >= 0) {
    const it = acc.items[idx] as AssistantChatItem
    acc.items[idx] = { ...it, streaming: false }
  }
  acc.openId = null
  acc.thinkingOpen = false
}

function appendText(blocks: AssistantBlock[], delta: string): AssistantBlock[] {
  const last = blocks[blocks.length - 1]
  if (last?.type === 'text') return [...blocks.slice(0, -1), { ...last, text: last.text + delta }]
  return [...blocks, { type: 'text', text: delta }]
}

function appendThinking(blocks: AssistantBlock[], delta: string, open: boolean): AssistantBlock[] {
  const last = blocks[blocks.length - 1]
  if (open && last?.type === 'thinking') {
    return [...blocks.slice(0, -1), { ...last, text: last.text + delta }]
  }
  return [...blocks, { type: 'thinking', text: delta }]
}

function markPending(blocks: AssistantBlock[], requestId: string, toolName: string, input: unknown): AssistantBlock[] {
  const idx = blocks.findIndex((b) => 'id' in b && b.id === requestId)
  if (idx >= 0) {
    return blocks.map((b, i) => {
      if (i !== idx) return b
      if (b.type === 'edit' || b.type === 'bash' || b.type === 'tool') {
        return { ...b, requestId, decision: 'pending' as EditDecision }
      }
      return b
    })
  }
  // Fallback: el permiso llegó antes que el tool_use → card genérica pendiente.
  return [...blocks, { type: 'tool', id: requestId, requestId, name: toolName, meta: shortInput(input), decision: 'pending' }]
}

function applyResult(blocks: AssistantBlock[], id: string, ok: boolean, output: string): AssistantBlock[] {
  return blocks.map((b) => {
    if (!('id' in b) || b.id !== id) return b
    // Si nunca hubo permission_request (modo auto/bypass), la decisión pasa a 'auto'.
    const autoDecision = (d: EditDecision, req?: string): EditDecision =>
      !req && d === 'pending' ? 'auto' : d
    switch (b.type) {
      case 'read':
        return { ...b, meta: ok ? `${output ? output.split('\n').length : 0} lines` : 'error' }
      case 'edit':
        return { ...b, decision: autoDecision(b.decision, b.requestId) }
      case 'bash':
        return {
          ...b,
          ok,
          output: output
            .split('\n')
            .filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ''))
            .map((text) => ({ text, ok: bashLineOk(text) })),
          decision: autoDecision(b.decision, b.requestId),
        }
      case 'tool':
        return { ...b, ok, meta: ok ? b.meta : 'error', decision: autoDecision(b.decision, b.requestId) }
      default:
        return b
    }
  })
}

/** Aplica UN evento del log al acumulador (muta acc). `session` se maneja fuera. */
function reduceEvent(acc: Assembler, ev: LogEvent): void {
  switch (ev.type) {
    case 'user':
      closeAssistant(acc)
      acc.items.push({ kind: 'user', id: ev.id, text: ev.text })
      openAssistant(acc)
      return
    case 'thinking':
      mutateBlocks(acc, (b) => appendThinking(b, ev.delta, acc.thinkingOpen))
      acc.thinkingOpen = true
      return
    case 'thinking_done':
      acc.thinkingOpen = false
      return
    case 'text':
      mutateBlocks(acc, (b) => appendText(b, ev.delta))
      return
    case 'tool_use':
      mutateBlocks(acc, (b) => [...b, buildToolBlock(ev.id, ev.name, ev.input)])
      return
    case 'tool_result':
      mutateBlocks(acc, (b) => applyResult(b, ev.id, ev.ok !== false, ev.output ?? ''))
      return
    case 'permission_request':
      mutateBlocks(acc, (b) => markPending(b, ev.requestId, ev.toolName, ev.input))
      return
    case 'assistant_done':
      acc.thinkingOpen = false
      return
    case 'result':
      closeAssistant(acc)
      return
    case 'error':
      mutateBlocks(acc, (b) => [...b, { type: 'text', text: `⚠ ${ev.message}` }])
      closeAssistant(acc)
      return
    default:
      return
  }
}

// --- El store --------------------------------------------------------------

type TurnStatus = 'idle' | 'queued' | 'running' | 'error'

class ChatStore {
  private state: StoreSnapshot = {
    sessions: [],
    activeId: '',
    model: initialModel(),
    permissionMode: initialPermission(),
    effort: initialEffort(),
    connStatus: 'closed',
    loading: true,
  }

  private listeners = new Set<() => void>()
  private ws: WebSocket | null = null
  private queue: string[] = []
  private started = false
  private reconnectTimer: number | null = null

  /** Cursor de ensamblado por sesión (openId + thinkingOpen del hilo). */
  private cursors = new Map<string, { openId: string | null; thinkingOpen: boolean }>()
  /** Sesiones a las que este socket ya mandó `attach` (se limpia al reconectar). */
  private attached = new Set<string>()
  /** requestId de aprobación → sessionId (para enrutar el decide en multi-sesión). */
  private pendingPerm = new Map<string, string>()

  // ---- Suscripción (useSyncExternalStore) --------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.init()
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): StoreSnapshot => this.state

  private emit(): void {
    for (const l of this.listeners) l()
  }

  private setState(patch: Partial<StoreSnapshot>): void {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  /** Cambia la pestaña activa y persiste el id en localStorage (recarga limpia). */
  private setActive(id: string): void {
    this.setState({ activeId: id })
    lsSet(LS_ACTIVE, id)
  }

  // ---- Arranque ----------------------------------------------------------

  private init(): void {
    if (this.started) return
    this.started = true
    this.connect()
    this.loadSessions()
  }

  private loadSessions(): void {
    // scope=open → pestañas abiertas (la tira). El HILO no viene aquí: llega por el
    // `snapshot` de cada `attach` (el server es autoritativo del hilo).
    fetch('/api/chat/sessions?scope=open', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((data: { sessions?: { id: string; title: string; claudeSessionId?: string | null }[] }) => {
        const list = Array.isArray(data.sessions) ? data.sessions : []
        const sessions: ChatSession[] = list.map((d) => ({
          id: d.id,
          name: d.title,
          items: [],
          open: true,
          ...(d.claudeSessionId ? { claudeSessionId: d.claudeSessionId } : {}),
        }))
        if (sessions.length === 0) sessions.push(this.newLocalSession())
        const stored = lsGet(LS_ACTIVE)
        const activeId = stored && sessions.some((s) => s.id === stored) ? stored : sessions[0]!.id
        this.setState({ sessions, activeId, loading: false })
        this.attachAll()
      })
      .catch(() => {
        const s = this.newLocalSession()
        this.setState({ sessions: [s], activeId: s.id, loading: false })
        this.attachAll()
      })
  }

  private newLocalSession(): ChatSession {
    return { id: newSessionId(), name: 'new chat', items: [], open: true }
  }

  // ---- WebSocket ---------------------------------------------------------

  private connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.setState({ connStatus: 'connecting' })
    const ws = new WebSocket(chatWsUrl())
    this.ws = ws

    ws.onopen = () => {
      this.setState({ connStatus: 'open' })
      const pending = this.queue
      this.queue = []
      for (const m of pending) ws.send(m)
      // (Re)suscribe a todas las pestañas abiertas → snapshot autoritativo de cada una.
      this.attachAll()
    }

    ws.onmessage = (e) => {
      try {
        this.handleFrame(JSON.parse(String(e.data)) as Record<string, unknown>)
      } catch {
        /* trama no-JSON: se ignora */
      }
    }

    ws.onclose = () => {
      this.ws = null
      this.setState({ connStatus: 'closed' })
      // Las suscripciones del server se pierden con el socket: re-attach al reconectar.
      this.attached.clear()
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      try {
        ws.close()
      } catch {
        /* noop */
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 1500)
  }

  private raw(obj: unknown): void {
    const msg = JSON.stringify(obj)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg)
    } else {
      this.queue.push(msg)
      this.connect()
    }
  }

  /** Suscribe (attach) a una sesión si el socket está abierto y no lo estaba ya. */
  private attach(id: string): void {
    if (this.attached.has(id)) return
    this.attached.add(id)
    this.raw({ type: 'attach', sessionId: id })
  }

  private detach(id: string): void {
    if (!this.attached.delete(id)) return
    this.raw({ type: 'detach', sessionId: id })
  }

  /** Attach a todas las pestañas abiertas (idempotente). */
  private attachAll(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    for (const s of this.state.sessions) if (s.open !== false) this.attach(s.id)
  }

  // ---- Helpers de estado -------------------------------------------------

  private getSession(id: string): ChatSession | undefined {
    return this.state.sessions.find((s) => s.id === id)
  }

  private updateSession(id: string, fn: (s: ChatSession) => ChatSession): void {
    this.setState({ sessions: this.state.sessions.map((s) => (s.id === id ? fn(s) : s)) })
  }

  // ---- Frames server→cliente ---------------------------------------------

  private handleFrame(frame: Record<string, unknown>): void {
    const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : null
    if (!sessionId) return
    switch (frame.type) {
      case 'snapshot':
        this.applySnapshot(
          sessionId,
          Array.isArray(frame.events) ? (frame.events as LogEvent[]) : [],
          typeof frame.status === 'string' ? (frame.status as TurnStatus) : 'idle',
          typeof frame.claudeSessionId === 'string' ? frame.claudeSessionId : null,
          typeof frame.queueLength === 'number' ? frame.queueLength : 0
        )
        return
      case 'event':
        if (frame.event && typeof frame.event === 'object') {
          this.applyLive(sessionId, frame.event as LogEvent)
        }
        return
      case 'status':
        this.updateSession(sessionId, (s) => ({
          ...s,
          streaming: frame.status === 'running' || frame.status === 'queued',
          queued: typeof frame.queueLength === 'number' ? frame.queueLength : s.queued,
        }))
        return
      default:
        return
    }
  }

  /** Reemplaza el estado de una sesión con el snapshot autoritativo del server. */
  private applySnapshot(
    sessionId: string,
    events: LogEvent[],
    status: TurnStatus,
    claudeSessionId: string | null,
    queueLength: number
  ): void {
    if (!this.getSession(sessionId)) return // snapshot de una sesión ya cerrada
    const acc: Assembler = { items: [], openId: null, thinkingOpen: false }
    for (const ev of events) {
      if (ev && ev.type) reduceEvent(acc, ev)
      // Registra aprobaciones pendientes del snapshot para enrutar el decide.
      if (ev?.type === 'permission_request') this.pendingPerm.set(ev.requestId, sessionId)
    }
    const running = status === 'running' || status === 'queued'
    // Si el turno NO está vivo, cierra el assistant abierto (no dejar typing fantasma).
    if (!running) closeAssistant(acc)
    this.cursors.set(sessionId, { openId: acc.openId, thinkingOpen: acc.thinkingOpen })
    this.updateSession(sessionId, (s) => ({
      ...s,
      items: acc.items,
      streaming: running,
      queued: queueLength,
      ...(claudeSessionId ? { claudeSessionId } : {}),
    }))
  }

  /** Aplica un evento en vivo sobre el estado actual de la sesión. */
  private applyLive(sessionId: string, ev: LogEvent): void {
    const session = this.getSession(sessionId)
    if (!session || !ev.type) return
    // 'session' solo actualiza el claudeSessionId (para reanudar); no toca el hilo.
    if (ev.type === 'session') {
      this.updateSession(sessionId, (s) => ({ ...s, claudeSessionId: ev.sessionId }))
      return
    }
    if (ev.type === 'permission_request') this.pendingPerm.set(ev.requestId, sessionId)

    const cur = this.cursors.get(sessionId) ?? { openId: null, thinkingOpen: false }
    const acc: Assembler = { items: [...session.items], openId: cur.openId, thinkingOpen: cur.thinkingOpen }
    reduceEvent(acc, ev)
    this.cursors.set(sessionId, { openId: acc.openId, thinkingOpen: acc.thinkingOpen })
    this.updateSession(sessionId, (s) => ({ ...s, items: acc.items }))
  }

  // ---- Acciones públicas (fachada del hook) ------------------------------

  selectSession = (id: string): void => {
    this.setActive(id)
    this.attach(id) // por si aún no estaba suscrita (idempotente)
  }

  addSession = (): void => {
    const local = this.newLocalSession()
    this.setState({ sessions: [...this.state.sessions, local] })
    this.setActive(local.id)
    this.attach(local.id) // el server crea el runtime vacío → snapshot vacío
  }

  /**
   * Cierra una pestaña (NO la borra): detach + marca open:false en el server
   * (best-effort) y la quita de la tira. La conversación sigue en el historial.
   */
  closeSession = (id: string): void => {
    const idx = this.state.sessions.findIndex((s) => s.id === id)
    if (idx === -1) return
    this.detach(id)
    fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open: false }),
    }).catch(() => {
      /* sin persistencia: cerrarla en local basta */
    })
    this.removeFromStrip(id, idx)
  }

  /** Borrado REAL de una conversación (historial): DELETE + quitar de la tira. */
  deleteSession = (id: string): void => {
    this.detach(id)
    fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {
      /* sin persistencia: quitarla de la tira (si estaba) basta */
    })
    const idx = this.state.sessions.findIndex((s) => s.id === id)
    if (idx !== -1) this.removeFromStrip(id, idx)
  }

  /**
   * Reabre una conversación del historial como pestaña: marca open:true en el
   * server, la añade a la tira si no estaba, la activa y attach (→ snapshot).
   */
  reopenSession = (meta: { id: string; title: string; claudeSessionId?: string | null }): void => {
    fetch(`/api/chat/sessions/${encodeURIComponent(meta.id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open: true }),
    }).catch(() => {
      /* sin persistencia: abrirla en local basta */
    })
    if (!this.getSession(meta.id)) {
      const session: ChatSession = {
        id: meta.id,
        name: meta.title,
        items: [],
        open: true,
        ...(meta.claudeSessionId ? { claudeSessionId: meta.claudeSessionId } : {}),
      }
      this.setState({ sessions: [...this.state.sessions, session] })
    }
    this.setActive(meta.id)
    this.attach(meta.id)
  }

  /** Renombra una conversación (optimista en local + PATCH best-effort). */
  renameSession = (id: string, title: string): void => {
    this.updateSession(id, (s) => ({ ...s, name: title }))
    fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => {
      /* sin persistencia: el nombre vive en memoria */
    })
  }

  /** Historial completo (scope=all) para el panel. NO entra en el snapshot; lo consume la UI. */
  fetchHistory = async (): Promise<Array<{ id: string; title: string; updatedAt: string; open: boolean }>> => {
    try {
      const r = await fetch('/api/chat/sessions?scope=all', { credentials: 'include' })
      if (!r.ok) return []
      const data: { sessions?: Array<{ id: string; title: string; updatedAt: string; open: boolean }> } = await r.json()
      return Array.isArray(data.sessions) ? data.sessions : []
    } catch {
      return []
    }
  }

  /** Quita una pestaña de la tira, activa un vecino y nunca deja 0 pestañas. */
  private removeFromStrip(id: string, idx: number): void {
    this.cursors.delete(id)
    let next = this.state.sessions.filter((s) => s.id !== id)
    let activeId = this.state.activeId

    if (next.length === 0) {
      const fresh = this.newLocalSession()
      next = [fresh]
      activeId = fresh.id
      this.setState({ sessions: next, activeId })
      lsSet(LS_ACTIVE, activeId)
      this.attach(fresh.id)
      return
    }
    if (activeId === id) {
      const neighbor = next[Math.min(idx, next.length - 1)]!
      activeId = neighbor.id
    }
    this.setState({ sessions: next, activeId })
    lsSet(LS_ACTIVE, activeId)
  }

  sendMessage = (text: string, cwd: string | null): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    const sessionId = this.state.activeId
    const session = this.getSession(sessionId)
    if (!session || session.streaming) return

    // Bloqueo optimista del composer hasta que el server confirme el status.
    this.updateSession(sessionId, (s) => ({ ...s, streaming: true }))
    this.attach(sessionId) // asegura la suscripción antes de enviar

    // Payload de esfuerzo por-mensaje:
    // - 'ultracode' → workflows multiagente + effort 'max'.
    // - otro nivel → effort normal. - 'auto' → nada (default del engine).
    const effortPayload =
      this.state.effort === 'ultracode'
        ? { workflows: true, effort: 'max' as const }
        : this.state.effort !== 'auto'
          ? { effort: this.state.effort }
          : {}

    this.raw({
      type: 'message',
      sessionId,
      localId: uid('u'),
      text: trimmed,
      ...(cwd ? { cwd } : {}),
      ...(this.state.model ? { model: this.state.model } : {}),
      mode: this.state.permissionMode,
      ...effortPayload,
    })
  }

  decide = (requestId: string, decision: UserEditDecision): void => {
    const sessionId = this.pendingPerm.get(requestId) ?? this.state.activeId
    this.pendingPerm.delete(requestId)
    this.raw({
      type: 'permission',
      sessionId,
      requestId,
      decision: decision === 'applied' ? 'allow' : 'deny',
    })
    // Refleja la decisión en la card de inmediato (el tool_result confirmará luego).
    this.updateSession(sessionId, (s) => ({
      ...s,
      items: s.items.map((it) =>
        it.kind === 'assistant'
          ? {
              ...it,
              blocks: it.blocks.map((b) =>
                'requestId' in b && b.requestId === requestId ? { ...b, decision } : b
              ),
            }
          : it
      ),
    }))
  }

  setModel = (model: string): void => {
    this.setState({ model })
    lsSet(LS_MODEL, model)
    // Cambio en caliente del turno vivo de la sesión activa (si lo hay).
    this.raw({ type: 'set_model', sessionId: this.state.activeId, model })
  }

  setPermissionMode = (mode: ChatPermissionMode): void => {
    this.setState({ permissionMode: mode })
    lsSet(LS_PERMISSION, mode)
    this.raw({ type: 'set_permission_mode', sessionId: this.state.activeId, mode })
  }

  // El esfuerzo no se sincroniza en caliente (viaja en el próximo message).
  setEffort = (effort: ChatEffortSetting): void => {
    this.setState({ effort })
    lsSet(LS_EFFORT, effort)
  }

  /** Aborta el turno vivo de la sesión activa (+ vacía su cola). */
  interrupt = (): void => {
    this.raw({ type: 'stop', sessionId: this.state.activeId })
  }
}

/** Instancia única compartida por toda la app (sobrevive al remontaje de la vista). */
export const chatStore = new ChatStore()
