// Store del Chat (singleton a nivel de módulo). Gestiona UNA conexión WebSocket
// a /ws/chat y el estado de todas las pestañas/hilos, y mapea los eventos del
// puente real (Agent SDK) a los bloques de UI (thinking → texto → tool-cards →
// done). Es singleton A PROPÓSITO: AppShell remonta ChatView con key={view} al
// navegar, así que un estado dentro del componente perdería el hilo y el socket;
// aquí sobreviven al remontaje. `useChatSession.ts` es la fachada React (hook).
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

function chatWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/chat`
}

/** Título de pestaña a partir del primer mensaje (recortado). */
function snippet(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean
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

// --- El store --------------------------------------------------------------

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

  /** Pestaña (id local) cuyo turno está en curso; a ella se atribuyen los eventos. */
  private pendingLocalId: string | null = null
  /** Estado transitorio por turno: id del mensaje del asistente + thinking abierto. */
  private turns = new Map<string, { assistantId: string; thinkingOpen: boolean }>()

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

  // ---- Arranque ----------------------------------------------------------

  private init(): void {
    if (this.started) return
    this.started = true
    this.connect()
    this.loadSessions()
  }

  private loadSessions(): void {
    fetch('/api/chat/sessions', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((data: { sessions?: { id: string; title: string; claudeSessionId?: string | null }[] }) => {
        const list = Array.isArray(data.sessions) ? data.sessions : []
        const sessions: ChatSession[] = list.map((d) => ({
          id: d.id,
          name: d.title,
          items: [],
          ...(d.claudeSessionId ? { claudeSessionId: d.claudeSessionId } : {}),
        }))
        if (sessions.length === 0) sessions.push(this.newLocalSession())
        this.setState({ sessions, activeId: sessions[0]!.id, loading: false })
      })
      .catch(() => {
        const s = this.newLocalSession()
        this.setState({ sessions: [s], activeId: s.id, loading: false })
      })
  }

  private newLocalSession(): ChatSession {
    return { id: uid('chat'), name: 'new chat', items: [] }
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
      // Sincroniza modelo/modo si no son los del server (default).
      if (this.state.model) this.raw({ type: 'set_model', model: this.state.model })
      if (this.state.permissionMode !== 'default') {
        this.raw({ type: 'set_permission_mode', mode: this.state.permissionMode })
      }
      const pending = this.queue
      this.queue = []
      for (const m of pending) ws.send(m)
    }

    ws.onmessage = (e) => {
      try {
        this.handleEvent(JSON.parse(String(e.data)))
      } catch {
        /* trama no-JSON: se ignora */
      }
    }

    ws.onclose = () => {
      this.ws = null
      this.setState({ connStatus: 'closed' })
      // Un turno a medias no puede continuar en la nueva conexión: se cierra.
      if (this.pendingLocalId) this.finishTurn(this.pendingLocalId, 'Conexión perdida')
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

  // ---- Helpers de mutación inmutable -------------------------------------

  private getSession(id: string): ChatSession | undefined {
    return this.state.sessions.find((s) => s.id === id)
  }

  private updateSession(id: string, fn: (s: ChatSession) => ChatSession): void {
    this.setState({ sessions: this.state.sessions.map((s) => (s.id === id ? fn(s) : s)) })
  }

  /** Aplica `fn` a los bloques del mensaje del asistente del turno de `localId`. */
  private mutateAssistant(localId: string, fn: (blocks: AssistantBlock[]) => AssistantBlock[]): void {
    const turn = this.turns.get(localId)
    if (!turn) return
    this.updateSession(localId, (s) => ({
      ...s,
      items: s.items.map((it) =>
        it.kind === 'assistant' && it.id === turn.assistantId ? { ...it, blocks: fn(it.blocks) } : it
      ),
    }))
  }

  // ---- Mapeo de eventos server→cliente -----------------------------------

  private handleEvent(ev: Record<string, unknown>): void {
    const localId = this.pendingLocalId
    if (!localId) return
    switch (ev.type) {
      case 'session':
        if (typeof ev.sessionId === 'string') {
          this.updateSession(localId, (s) => ({ ...s, claudeSessionId: ev.sessionId as string }))
        }
        return
      case 'thinking':
        if (typeof ev.delta === 'string') this.appendThinking(localId, ev.delta)
        return
      case 'thinking_done': {
        const turn = this.turns.get(localId)
        if (turn) turn.thinkingOpen = false
        return
      }
      case 'text':
        if (typeof ev.delta === 'string') this.appendText(localId, ev.delta)
        return
      case 'tool_use':
        if (typeof ev.id === 'string' && typeof ev.name === 'string') {
          this.mutateAssistant(localId, (blocks) => [...blocks, buildToolBlock(ev.id as string, ev.name as string, ev.input)])
        }
        return
      case 'tool_result':
        if (typeof ev.id === 'string') {
          this.applyToolResult(localId, ev.id, ev.ok !== false, typeof ev.output === 'string' ? ev.output : '')
        }
        return
      case 'permission_request':
        if (typeof ev.requestId === 'string' && typeof ev.toolName === 'string') {
          this.setPending(localId, ev.requestId, ev.toolName, ev.input)
        }
        return
      case 'assistant_done': {
        const turn = this.turns.get(localId)
        if (turn) turn.thinkingOpen = false
        return
      }
      case 'result':
        this.finishTurn(localId)
        return
      case 'error':
        this.finishTurn(localId, typeof ev.message === 'string' ? ev.message : 'Error')
        return
      default:
        return
    }
  }

  private appendThinking(localId: string, delta: string): void {
    const turn = this.turns.get(localId)
    this.mutateAssistant(localId, (blocks) => {
      const last = blocks[blocks.length - 1]
      if (turn?.thinkingOpen && last?.type === 'thinking') {
        return [...blocks.slice(0, -1), { ...last, text: last.text + delta }]
      }
      if (turn) turn.thinkingOpen = true
      return [...blocks, { type: 'thinking', text: delta }]
    })
  }

  private appendText(localId: string, delta: string): void {
    this.mutateAssistant(localId, (blocks) => {
      const last = blocks[blocks.length - 1]
      if (last?.type === 'text') {
        return [...blocks.slice(0, -1), { ...last, text: last.text + delta }]
      }
      return [...blocks, { type: 'text', text: delta }]
    })
  }

  private setPending(localId: string, requestId: string, toolName: string, input: unknown): void {
    this.mutateAssistant(localId, (blocks) => {
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
    })
  }

  private applyToolResult(localId: string, id: string, ok: boolean, output: string): void {
    this.mutateAssistant(localId, (blocks) =>
      blocks.map((b) => {
        if (!('id' in b) || b.id !== id) return b
        // Si nunca hubo permission_request (modo auto), la decisión pasa a 'auto'.
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
    )
  }

  private finishTurn(localId: string, errorMsg?: string): void {
    const turn = this.turns.get(localId)
    const assistantId = turn?.assistantId
    this.turns.delete(localId)
    if (this.pendingLocalId === localId) this.pendingLocalId = null
    this.updateSession(localId, (s) => ({
      ...s,
      streaming: false,
      items: s.items.map((it): ChatItem => {
        if (it.kind !== 'assistant' || it.id !== assistantId) return it
        const blocks = errorMsg ? [...it.blocks, { type: 'text' as const, text: `⚠ ${errorMsg}` }] : it.blocks
        return { ...it, streaming: false, blocks }
      }),
    }))
  }

  // ---- Acciones públicas (fachada del hook) ------------------------------

  selectSession = (id: string): void => {
    this.setState({ activeId: id })
  }

  addSession = (): void => {
    const local = this.newLocalSession()
    this.setState({ sessions: [...this.state.sessions, local], activeId: local.id })
    // Persistencia best-effort: si el POST responde con id de server y la pestaña
    // sigue vacía (sin turno), se enlaza para una recarga limpia (sin huérfanos).
    fetch('/api/chat/sessions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'new chat' }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((data: { session?: { id?: string } }) => {
        const serverId = data.session?.id
        const cur = this.getSession(local.id)
        if (serverId && cur && cur.items.length === 0 && !cur.streaming) {
          this.setState({
            sessions: this.state.sessions.map((s) => (s.id === local.id ? { ...s, id: serverId } : s)),
            activeId: this.state.activeId === local.id ? serverId : this.state.activeId,
          })
        }
      })
      .catch(() => {
        /* sin persistencia: la pestaña vive en memoria igualmente */
      })
  }

  closeSession = (id: string): void => {
    const { sessions } = this.state
    const idx = sessions.findIndex((s) => s.id === id)
    if (idx === -1) return

    // Best-effort: borra la meta en el server; se ignora el fallo (404 si nunca
    // se persistió, o red/servidor caídos). La pestaña se cierra en local igual.
    fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {
      /* sin persistencia: la pestaña vive solo en memoria, cerrarla basta */
    })

    // Si esta pestaña tenía el turno en curso, se interrumpe y se limpia su
    // estado transitorio (los eventos tardíos se descartan: pendingLocalId=null).
    if (this.pendingLocalId === id) {
      this.interrupt()
      this.pendingLocalId = null
    }
    this.turns.delete(id)

    let next = sessions.filter((s) => s.id !== id)
    let activeId = this.state.activeId

    // Nunca dejar la vista sin pestañas: si era la última, abrimos una vacía.
    if (next.length === 0) {
      const fresh = this.newLocalSession()
      next = [fresh]
      activeId = fresh.id
    } else if (activeId === id) {
      // Si cerramos la activa, activamos un vecino (anterior o siguiente).
      const neighbor = next[Math.min(idx, next.length - 1)]!
      activeId = neighbor.id
    }

    this.setState({ sessions: next, activeId })
  }

  sendMessage = (text: string, cwd: string | null): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    const localId = this.state.activeId
    const session = this.getSession(localId)
    if (!session || session.streaming) return

    const userItem: ChatItem = { kind: 'user', id: uid('u'), text: trimmed }
    const assistantId = uid('a')
    const assistantItem: AssistantChatItem = { kind: 'assistant', id: assistantId, blocks: [], streaming: true }

    this.turns.set(localId, { assistantId, thinkingOpen: false })
    this.pendingLocalId = localId

    const name = session.items.length === 0 ? snippet(trimmed) : session.name
    this.updateSession(localId, (s) => ({ ...s, name, streaming: true, items: [...s.items, userItem, assistantItem] }))

    // Payload de esfuerzo por-mensaje:
    // - 'ultracode' → activa workflows multiagente (workflows:true) + effort 'max'.
    // - cualquier otro nivel → effort normal.
    // - 'auto' → nada (usa el default del engine).
    const effortPayload =
      this.state.effort === 'ultracode'
        ? { workflows: true, effort: 'max' as const }
        : this.state.effort !== 'auto'
          ? { effort: this.state.effort }
          : {}

    this.raw({
      type: 'user_message',
      text: trimmed,
      ...(cwd ? { cwd } : {}),
      ...(session.claudeSessionId ? { sessionId: session.claudeSessionId } : {}),
      ...effortPayload,
    })
  }

  decide = (requestId: string, decision: UserEditDecision): void => {
    this.raw({ type: 'permission_decision', requestId, decision: decision === 'applied' ? 'allow' : 'deny' })
    const localId = this.pendingLocalId ?? this.state.activeId
    this.mutateAssistant(localId, (blocks) =>
      blocks.map((b) => ('requestId' in b && b.requestId === requestId ? { ...b, decision } : b))
    )
  }

  setModel = (model: string): void => {
    this.setState({ model })
    lsSet(LS_MODEL, model)
    this.raw({ type: 'set_model', model })
  }

  setPermissionMode = (mode: ChatPermissionMode): void => {
    this.setState({ permissionMode: mode })
    lsSet(LS_PERMISSION, mode)
    this.raw({ type: 'set_permission_mode', mode })
  }

  // El esfuerzo no se sincroniza en caliente (viaja en el próximo user_message).
  setEffort = (effort: ChatEffortSetting): void => {
    this.setState({ effort })
    lsSet(LS_EFFORT, effort)
  }

  interrupt = (): void => {
    this.raw({ type: 'interrupt' })
  }
}

/** Instancia única compartida por toda la app (sobrevive al remontaje de la vista). */
export const chatStore = new ChatStore()
