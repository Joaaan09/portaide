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
//
// Resiliencia móvil (el socket se queda ZOMBI en OPEN al volver del background):
//   - `lastFrameAt` + listeners de foreground/online → reconexión forzada.
//   - backoff con jitter, cola de salida y ping de aplicación (watchdog).
//   - envíos con `localId`: la burbuja local vive hasta que su evento `user`
//     aparece en el LOG del server (mismo id → relevo sin parpadeo). El
//     `ack{localId}` confirma la RECEPCIÓN (deja de reenviarse y de caducar)
//     pero NO retira la burbuja: el server registra el evento `user` al ARRANCAR
//     el turno, que antes puede esperar slot de concurrencia. Lo que salió por
//     una conexión anterior y sigue SIN `ack` se reenvía tras el snapshot;
//     agotados los intentos se marca NO ENTREGADO en la UI, con reintento
//     manual. Nunca se finge que un mensaje llegó.
//   - ids de item deterministas (`a-<índice del evento>`) para que reaplicar un
//     snapshot no remonte el hilo ni mueva el scroll.
import type {
  AssistantBlock,
  AssistantChatItem,
  ChatEffortSetting,
  ChatItem,
  ChatPermissionMode,
  ChatQuestion,
  ChatSession,
  DiffLine,
  EditDecision,
  QuestionOption,
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
  /** true si la lista de conversaciones (REST) falló; se reintenta sola (backoff). */
  sessionsError: boolean
  /**
   * Workspace activo (WorkspaceProvider), sincronizado por la vista. Es la
   * carpeta que HEREDA una conversación todavía sin anclar (`session.cwd` null):
   * lo que se pinta en el chip y lo que se fija como ancla al primer mensaje.
   */
  defaultCwd: string | null
}

// --- Timings de conexión (móvil: background, cambio de red, socket zombi) ---

/** Reconexión: backoff exponencial con jitter, desde 500ms hasta 15s. */
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 15_000
/** Silencio del socket que lo hace sospechoso al volver a primer plano. */
const STALE_MS = 20_000
/** Un CONNECTING colgado más de esto se descarta y se abre un socket nuevo. */
const CONNECTING_TIMEOUT_MS = 10_000
/** Cadencia del watchdog (ping + detección de socket mudo con turno vivo). */
const WATCHDOG_MS = 15_000
/** Ping de aplicación (el server ignora los tipos que no conoce). */
const HEARTBEAT_MS = 30_000
/** Silencio CON turno vivo que dispara el probe (el turno debería emitir). */
const STREAM_STALE_MS = 45_000
/** Espera de respuesta del probe antes de dar el socket por muerto. */
const PROBE_MS = 6_000
/** Reintento de la lista de conversaciones (REST) con backoff. */
const SESSIONS_RETRY_BASE_MS = 1_000
const SESSIONS_RETRY_MAX_MS = 15_000
/** Tope de la cola de salida (si la red no vuelve, no crecer sin fin). */
const QUEUE_MAX = 100
/** Reenvíos de un mismo mensaje antes de darlo por no entregado. */
const PENDING_MAX_ATTEMPTS = 3
/** Antigüedad máxima de un envío sin `ack` (con conexión) antes de darlo por
 *  no entregado. El `ack` del server es inmediato, así que no hace falta más. */
const PENDING_TTL_MS = 2 * 60_000
/** Espera del `ack` de un `message`: sin él, el socket miente (zombi). */
const ACK_TIMEOUT_MS = 4_000

/** Tramas que NO se encolan: se regeneran solas al reconectar o caducan. */
const NON_QUEUEABLE = new Set(['attach', 'detach', 'ping'])

/** Backoff exponencial con jitter (±25%) acotado a `max`. */
function backoffDelay(attempt: number, base: number, max: number): number {
  const exp = Math.min(base * 2 ** attempt, max)
  const jitter = exp * 0.25 * (Math.random() * 2 - 1)
  return Math.max(base, Math.round(exp + jitter))
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

/**
 * Normaliza el input de `AskUserQuestion` (el tool_use llega ANTES que el
 * `question_request`, así que la card se pinta ya con sus opciones). Devuelve
 * null si no tiene la forma esperada → card genérica, como cualquier otra tool.
 */
function parseQuestions(input: unknown): ChatQuestion[] | null {
  const raw = (input as { questions?: unknown } | null)?.questions
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: ChatQuestion[] = []
  for (const item of raw) {
    const q = item as Partial<ChatQuestion> | null
    if (!q || typeof q.question !== 'string' || !q.question || !Array.isArray(q.options)) return null
    const options: QuestionOption[] = []
    for (const o of q.options) {
      const opt = o as Partial<QuestionOption> | null
      if (!opt || typeof opt.label !== 'string' || !opt.label) return null
      options.push({
        label: opt.label,
        ...(typeof opt.description === 'string' && opt.description
          ? { description: opt.description }
          : {}),
      })
    }
    if (options.length === 0) return null
    out.push({
      question: q.question,
      header: typeof q.header === 'string' && q.header ? q.header : 'Question',
      multiSelect: q.multiSelect === true,
      options,
    })
  }
  return out
}

/** Mapea un tool_use a su bloque de UI (Read / Edit / Bash / pregunta / genérico). */
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
  if (name === 'AskUserQuestion') {
    const questions = parseQuestions(input)
    if (questions) return { type: 'question', id, questions, decision: 'pending' }
  }
  return { type: 'tool', id, name, meta: shortInput(input), decision: 'pending' }
}

/**
 * ¿La conversación ya arrancó? Es la condición que CONGELA su carpeta de
 * proyecto (el ancla `cwd`): con un solo mensaje en el hilo —o un turno vivo, o
 * un `claudeSessionId` del engine— cambiarla partiría el historial y el `resume`.
 * Vive aquí (y no en la vista) para que store y UI usen la MISMA definición.
 */
export function isChatStarted(session: ChatSession): boolean {
  return session.items.length > 0 || session.streaming === true || Boolean(session.claudeSessionId)
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
  | { type: 'question_request'; requestId: string; questions: ChatQuestion[] }
  | {
      type: 'permission_resolved'
      requestId: string
      decision: 'allow' | 'deny'
      /** 'interrupted' = se cerró sin decisión del usuario (turno abortado). */
      reason?: 'user' | 'interrupted'
    }
  | { type: 'question_answered'; requestId: string; answers: Record<string, string> }
  | { type: 'assistant_done' }
  | { type: 'result'; subtype: string }
  | { type: 'error'; message: string }

interface Assembler {
  items: ChatItem[]
  /** id del mensaje del asistente "abierto" (recibe los bloques del turno en curso). */
  openId: string | null
  thinkingOpen: boolean
  /**
   * Índice del evento del log que se está aplicando. Los ids de los mensajes del
   * asistente se derivan de él (`a-<seq>`): reaplicar el MISMO snapshot produce
   * las MISMAS identidades → React no remonta el hilo al reconectar (y el
   * auto-scroll de ChatThread no salta). Antes se usaba `uid('a')` (aleatorio).
   */
  seq: number
}

function openAssistant(acc: Assembler, suffix = ''): void {
  const id = `a-${acc.seq}${suffix}`
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

/**
 * Marca la card de preguntas como pendiente de responder (el `question_request`
 * trae el requestId con el que se contesta). Si el tool_use aún no llegó, crea
 * la card con las preguntas del propio evento.
 */
function markQuestion(
  blocks: AssistantBlock[],
  requestId: string,
  questions: ChatQuestion[]
): AssistantBlock[] {
  const idx = blocks.findIndex((b) => 'id' in b && b.id === requestId)
  if (idx >= 0) {
    return blocks.map((b, i) => {
      if (i !== idx) return b
      if (b.type === 'question') return { ...b, requestId, decision: 'pending' as EditDecision }
      // El tool_use se pintó como card genérica (el input no parseó en el
      // cliente): se REEMPLAZA por la card de preguntas del server, que sí trae
      // las opciones. Devolverlo intacto dejaba una card imposible de responder
      // y el turno colgado esperando una respuesta que no podía darse.
      return { type: 'question', id: requestId, requestId, questions, decision: 'pending' }
    })
  }
  return [...blocks, { type: 'question', id: requestId, requestId, questions, decision: 'pending' }]
}

/** Fija la decisión de la card cuyo `requestId` coincide (resolución del server). */
function applyResolution(
  blocks: AssistantBlock[],
  requestId: string,
  decision: EditDecision,
  answers?: Record<string, string>
): AssistantBlock[] {
  return blocks.map((b) => {
    if (!('requestId' in b) || b.requestId !== requestId) return b
    if (b.type === 'question') return { ...b, decision, ...(answers ? { answers } : {}) }
    return { ...b, decision }
  })
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
      case 'question':
        // Ya respondida (o descartada) → se respeta; si el turno acabó sin
        // decisión nuestra, deja de pedirla.
        return b.decision === 'pending' ? { ...b, decision: 'auto' as EditDecision } : b
      default:
        return b
    }
  })
}

/**
 * Normaliza la cola que viaja en `snapshot`/`status` (server → burbujas).
 * `null` = el frame no la trae (server viejo / trama incompleta): se CONSERVA la
 * cola que ya se pintaba, en vez de borrarla y hacer desaparecer mensajes que el
 * server sigue teniendo. Array vacío sí significa "cola vacía".
 */
function parseQueue(raw: unknown): { localId: string; text: string }[] | null {
  if (!Array.isArray(raw)) return null
  const out: { localId: string; text: string }[] = []
  for (const item of raw) {
    const q = item as { localId?: unknown; text?: unknown } | null
    if (!q || typeof q.localId !== 'string' || typeof q.text !== 'string') continue
    out.push({ localId: q.localId, text: q.text })
  }
  return out
}

/** Busca la card con ese `requestId` en TODO el hilo y le fija la decisión. */
function resolveInItems(
  acc: Assembler,
  requestId: string,
  decision: EditDecision,
  answers?: Record<string, string>
): void {
  for (let i = acc.items.length - 1; i >= 0; i -= 1) {
    const it = acc.items[i]
    if (!it || it.kind !== 'assistant') continue
    if (!it.blocks.some((b) => 'requestId' in b && b.requestId === requestId)) continue
    acc.items[i] = { ...it, blocks: applyResolution(it.blocks, requestId, decision, answers) }
    return
  }
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
    case 'question_request':
      mutateBlocks(acc, (b) => markQuestion(b, ev.requestId, ev.questions))
      return
    // Las resoluciones pueden llegar con el turno YA cerrado (al interrumpir se
    // deniega lo que colgaba), así que se aplican sobre el item que contiene esa
    // card —nunca con `mutateBlocks`, que abriría un mensaje vacío al final—.
    case 'permission_resolved':
      resolveInItems(
        acc,
        ev.requestId,
        ev.decision === 'allow'
          ? 'applied'
          : ev.reason === 'interrupted'
            ? 'interrupted'
            : 'rejected'
      )
      return
    case 'question_answered':
      resolveInItems(acc, ev.requestId, 'applied', ev.answers)
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

/** Envío del usuario aún no confirmado por el server (dedupe: localId). */
interface PendingSend {
  localId: string
  sessionId: string
  text: string
  /** Trama `message` tal cual, lista para reenviar sin recomponerla. */
  frame: Record<string, unknown>
  firstSentAt: number
  sentAt: number
  /**
   * Nº de conexión por la que salió la última vez. Solo se reenvía lo enviado
   * por una conexión ANTERIOR: si salió por la actual, o llega su `ack`, o el
   * socket muere y habrá otra conexión. Sin esto habría una carrera (snapshot
   * en vuelo mientras el `message` va de camino) que duplicaría el turno.
   */
  sentOnConn: number
  attempts: number
  /**
   * true = el server confirmó la RECEPCIÓN (`ack`). No implica que su burbuja
   * esté ya en el log (se registra al arrancar el turno, que puede esperar slot
   * de concurrencia): el pendiente sigue pintando la burbuja, pero ya no se
   * reenvía ni caduca.
   */
  acked: boolean
  /** true = agotados los reintentos; la UI lo marca como no entregado. */
  failed: boolean
}

class ChatStore {
  private state: StoreSnapshot = {
    sessions: [],
    activeId: '',
    model: initialModel(),
    permissionMode: initialPermission(),
    effort: initialEffort(),
    connStatus: 'closed',
    loading: true,
    sessionsError: false,
    defaultCwd: null,
  }

  private listeners = new Set<() => void>()
  private ws: WebSocket | null = null
  /** Cola de salida (objetos, no strings: se filtra por `type` al purgar). */
  private queue: Record<string, unknown>[] = []
  private started = false
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  /** Nº de la conexión actual (identifica por qué socket salió cada envío). */
  private connId = 0
  /** Instante de la última trama RECIBIDA (detector de socket zombi). */
  private lastFrameAt = 0
  /** Instante en que se abrió el socket actual (para el CONNECTING colgado). */
  private connectStartedAt = 0
  private lastPingAt = 0
  private watchdogTimer: number | null = null
  private probeTimer: number | null = null
  private lifecycleBound = false
  /** Estado del fetch de la lista de conversaciones (evita solapar reintentos). */
  private sessionsLoading = false
  private sessionsAttempt = 0
  private sessionsRetryTimer: number | null = null

  /** Cursor de ensamblado por sesión (openId + thinkingOpen del hilo). */
  private cursors = new Map<string, { openId: string | null; thinkingOpen: boolean }>()
  /** Hilo del SERVER por sesión (sin burbujas locales): base de `applyLive`. */
  private threads = new Map<string, ChatItem[]>()
  /** Nº de eventos del log ya aplicados por sesión (ids deterministas en vivo). */
  private eventCounts = new Map<string, number>()
  /** Envíos sin confirmar, por `localId` (orden de inserción = orden de envío). */
  private pending = new Map<string, PendingSend>()
  /** Sesiones cuyo próximo snapshot decide si hay que reenviar pendientes. */
  private resendAfterSnapshot = new Set<string>()
  /**
   * Mensajes EN COLA en el server, por sesión (los manda en `snapshot`/`status`).
   * Es el server quien manda: así la cola se ve igual tras recargar la PWA o
   * desde otro dispositivo, y se puede cancelar lo que aún no ha arrancado.
   */
  private serverQueue = new Map<string, { localId: string; text: string }[]>()
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
    this.bindLifecycle()
    this.startWatchdog()
    this.connect()
    this.loadSessions()
  }

  /**
   * Carga la tira de pestañas (scope=open). Si falla, NO fabrica una sesión
   * fantasma (el usuario creería que perdió su conversación): marca
   * `sessionsError` y reintenta con backoff (también al reconectar el WS).
   * La sesión vacía solo nace si el server responde OK con lista vacía.
   */
  private loadSessions(): void {
    if (this.sessionsLoading) return
    this.sessionsLoading = true
    this.clearSessionsRetry()
    // scope=open → pestañas abiertas (la tira). El HILO no viene aquí: llega por el
    // `snapshot` de cada `attach` (el server es autoritativo del hilo).
    fetch('/api/chat/sessions?scope=open', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((data: { sessions?: { id: string; title: string; claudeSessionId?: string | null; cwd?: string | null }[] }) => {
        const list = Array.isArray(data.sessions) ? data.sessions : []
        const sessions: ChatSession[] = list.map((d) => ({
          id: d.id,
          name: d.title,
          items: [],
          open: true,
          ...(d.claudeSessionId ? { claudeSessionId: d.claudeSessionId } : {}),
          // Ancla de proyecto persistida (null = la conversación aún no arrancó).
          cwd: d.cwd ?? null,
        }))
        // Conserva las pestañas locales que el server aún no conoce (creadas
        // mientras la lista no había cargado): no se pisan con la respuesta.
        const known = new Set(sessions.map((s) => s.id))
        for (const s of this.state.sessions) if (!known.has(s.id)) sessions.push(s)
        if (sessions.length === 0) sessions.push(this.newLocalSession())

        const stored = lsGet(LS_ACTIVE)
        const current = this.state.activeId
        const activeId = sessions.some((s) => s.id === current)
          ? current
          : stored && sessions.some((s) => s.id === stored)
            ? stored
            : sessions[0]!.id

        this.sessionsLoading = false
        this.sessionsAttempt = 0
        this.setState({ sessions, activeId, loading: false, sessionsError: false })
        this.attachAll()
      })
      .catch(() => {
        this.sessionsLoading = false
        this.setState({ loading: false, sessionsError: true })
        this.scheduleSessionsRetry()
      })
  }

  private clearSessionsRetry(): void {
    if (this.sessionsRetryTimer === null) return
    window.clearTimeout(this.sessionsRetryTimer)
    this.sessionsRetryTimer = null
  }

  private scheduleSessionsRetry(): void {
    if (this.sessionsRetryTimer !== null) return
    const delay = backoffDelay(this.sessionsAttempt, SESSIONS_RETRY_BASE_MS, SESSIONS_RETRY_MAX_MS)
    this.sessionsAttempt += 1
    this.sessionsRetryTimer = window.setTimeout(() => {
      this.sessionsRetryTimer = null
      this.loadSessions()
    }, delay)
  }

  /**
   * Pestaña nueva SIN anclar (`cwd: null`): hereda el workspace activo hasta que
   * se envía el primer mensaje (o el usuario elige otra carpeta desde el chip).
   */
  private newLocalSession(): ChatSession {
    return { id: newSessionId(), name: 'new chat', items: [], open: true, cwd: null }
  }

  // ---- Ciclo de vida (background ⇄ primer plano) --------------------------

  /**
   * En móvil el socket queda **zombi en OPEN** (pantalla bloqueada, cambio
   * WiFi↔datos): `onclose` puede tardar minutos, así que sin esto el hilo
   * simplemente deja de crecer y el chat parece parado. Al volver a primer
   * plano NO nos fiamos de `readyState`: lo contrastamos con `lastFrameAt` (la
   * última trama recibida). Los listeners no se retiran (el store es un
   * singleton que vive lo que la app).
   */
  private bindLifecycle(): void {
    if (this.lifecycleBound || typeof window === 'undefined') return
    this.lifecycleBound = true
    const wake = (): void => this.handleForeground()
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) wake()
    })
    window.addEventListener('pageshow', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)

    // Deep-link desde una notificación push: el Service Worker enfoca la app y
    // PushNavigation emite este evento con la sesión avisada. Si la app ya
    // estaba abierta hay que SELECCIONAR esa pestaña; sin esto aterrizarías en
    // el Chat pero en la conversación equivocada.
    window.addEventListener('portaide:open-chat-session', (ev) => {
      const id = (ev as CustomEvent<{ sessionId?: string }>).detail?.sessionId
      if (typeof id === 'string' && id) this.selectSession(id)
    })
  }

  private handleForeground(): void {
    if (typeof document !== 'undefined' && document.hidden) return
    const ws = this.ws
    const silent = Date.now() - this.lastFrameAt

    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      this.reconnectNow() // sin esperar al backoff: el usuario está mirando
    } else if (ws.readyState === WebSocket.CONNECTING) {
      if (Date.now() - this.connectStartedAt > CONNECTING_TIMEOUT_MS) this.forceReconnect()
    } else if (silent > STALE_MS) {
      // OPEN pero mudo demasiado tiempo → sospechoso. Reconectar es barato (el
      // turno vive en el server y cada `attach` devuelve el snapshot completo).
      this.forceReconnect()
    }

    if (this.state.sessionsError) this.loadSessions()
  }

  /** Watchdog: ping de aplicación + socket mudo mientras hay un turno vivo. */
  private startWatchdog(): void {
    if (this.watchdogTimer !== null || typeof window === 'undefined') return
    this.watchdogTimer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      this.sweepPending()
      if (this.ws?.readyState !== WebSocket.OPEN) return
      const now = Date.now()
      if (now - this.lastPingAt >= HEARTBEAT_MS) {
        this.lastPingAt = now
        // Ping de APLICACIÓN: el server ignora los tipos que no conoce, así que
        // es inofensivo. No espera respuesta; sirve para que un socket con el
        // TCP roto acabe fallando el `send` y dispare `onclose` cuanto antes.
        this.sendNow({ type: 'ping' })
      }
      // Con turno vivo el server emite constantemente: un silencio largo es
      // señal fuerte de socket muerto → probe (no cortamos a ciegas).
      const busy = this.state.sessions.some((s) => s.streaming)
      if (busy && now - this.lastFrameAt > STREAM_STALE_MS) this.probe()
    }, WATCHDOG_MS)
  }

  /**
   * Tras enviar algo que el server SIEMPRE contesta (un `message` responde con
   * status/eventos), comprueba que hubo respuesta. Cubre el peor caso: socket
   * zombi en OPEN → `send()` se pierde en silencio y el composer se quedaría
   * bloqueado en "streaming" para siempre. Al reconectar, el snapshot del server
   * (autoritativo) corrige el estado y el usuario ve la verdad.
   */
  private armSendWatchdog(): void {
    const mark = this.lastFrameAt
    window.setTimeout(() => {
      if (this.lastFrameAt === mark && this.ws?.readyState === WebSocket.OPEN) this.probe()
    }, PROBE_MS)
  }

  /**
   * Comprueba de verdad si el socket responde: un `attach` siempre contesta con
   * `snapshot`. Si no llega NADA en PROBE_MS, el socket está muerto aunque
   * `readyState` diga OPEN.
   */
  private probe(): void {
    if (this.probeTimer !== null) return
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.forceReconnect()
      return
    }
    const id = this.state.activeId
    if (!id) return
    this.sendNow({ type: 'attach', sessionId: id })
    const mark = this.lastFrameAt
    this.probeTimer = window.setTimeout(() => {
      this.probeTimer = null
      if (this.lastFrameAt === mark) this.forceReconnect()
    }, PROBE_MS)
  }

  // ---- WebSocket ---------------------------------------------------------

  private connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.setState({ connStatus: 'connecting' })
    this.connectStartedAt = Date.now()
    this.lastFrameAt = Date.now() // sin esto el 1er foreground lo daría por zombi
    this.connId += 1
    const ws = new WebSocket(chatWsUrl())
    this.ws = ws

    ws.onopen = () => {
      if (this.ws !== ws) return // socket ya descartado (forceReconnect)
      this.reconnectAttempt = 0
      this.lastFrameAt = Date.now()
      this.lastPingAt = Date.now()
      this.setState({ connStatus: 'open' })
      // Reenvío at-least-once: NO se reenvía a ciegas aquí. Se marcan las
      // sesiones con envíos sin confirmar y se decide al recibir su snapshot
      // (que dice qué llegó al log y cuántos hay en cola) → cero duplicados.
      for (const p of this.pending.values()) this.resendAfterSnapshot.add(p.sessionId)
      // (Re)suscribe a todas las pestañas abiertas → snapshot autoritativo de
      // cada una. Va ANTES de drenar la cola: los `message` pendientes llegan
      // con la suscripción ya hecha.
      this.attachAll()
      // Pendientes de una sesión que ya no está en la tira: no habrá snapshot.
      for (const id of [...this.resendAfterSnapshot]) {
        if (!this.getSession(id)) this.resendAfterSnapshot.delete(id)
      }
      const queued = this.queue
      this.queue = []
      for (const m of queued) {
        this.sendNow(m)
        // El envío sale AHORA, por ESTA conexión: se marca para que su snapshot
        // (que va por delante) no lo reenvíe, y se espera su `ack`.
        const p = typeof m.localId === 'string' ? this.pending.get(m.localId) : undefined
        if (p) {
          p.sentAt = Date.now()
          p.sentOnConn = this.connId
          this.armAckWatchdog(p.localId)
        }
      }
      // La lista pudo fallar mientras no había red: se reintenta al volver.
      if (this.state.sessionsError) this.loadSessions()
    }

    ws.onmessage = (e) => {
      this.lastFrameAt = Date.now()
      try {
        this.handleFrame(JSON.parse(String(e.data)) as Record<string, unknown>)
      } catch {
        /* trama no-JSON: se ignora */
      }
    }

    ws.onclose = () => {
      if (this.ws !== ws) return // ya reemplazado: no pisar el socket nuevo
      this.ws = null
      this.setState({ connStatus: 'closed' })
      // Las suscripciones del server se pierden con el socket: re-attach al
      // reconectar (attachAll), así que las de la cola sobran → purga.
      this.attached.clear()
      this.purgeQueue()
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

  /** Reconexión con backoff exponencial + jitter (500ms → 15s). */
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return
    const delay = backoffDelay(this.reconnectAttempt, RECONNECT_BASE_MS, RECONNECT_MAX_MS)
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  /** Reconecta YA (resetea el backoff): foreground o acción del usuario. */
  private reconnectNow(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempt = 0
    this.connect()
  }

  /** Descarta el socket actual (aunque diga OPEN) y abre uno nuevo de inmediato. */
  private forceReconnect(): void {
    const old = this.ws
    this.ws = null
    this.attached.clear()
    if (this.probeTimer !== null) {
      window.clearTimeout(this.probeTimer)
      this.probeTimer = null
    }
    if (old) {
      // Handlers fuera: el `onclose` tardío del zombi no debe pisar al nuevo.
      old.onopen = null
      old.onmessage = null
      old.onclose = null
      old.onerror = null
      try {
        old.close()
      } catch {
        /* noop */
      }
    }
    this.purgeQueue()
    this.setState({ connStatus: 'connecting' })
    this.reconnectNow()
  }

  /** Quita de la cola lo que se regenera solo al reconectar (attach/detach/ping). */
  private purgeQueue(): void {
    this.queue = this.queue.filter((m) => !NON_QUEUEABLE.has(String(m.type)))
  }

  /** Envía sin encolar (el llamante ya sabe que el socket está OPEN). */
  private sendNow(obj: Record<string, unknown>): void {
    try {
      this.ws?.send(JSON.stringify(obj))
    } catch {
      /* socket muerto: `onclose`/watchdog se encargan de reconectar */
    }
  }

  /**
   * Envía o ENCOLA. Nada de `send()` a ciegas: sobre un socket zombi el mensaje
   * se pierde en silencio. Las tramas que se regeneran al reconectar no entran
   * en la cola (evita el `attach` duplicado).
   */
  private raw(obj: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendNow(obj)
      return
    }
    if (!NON_QUEUEABLE.has(String(obj.type))) {
      this.queue.push(obj)
      if (this.queue.length > QUEUE_MAX) this.queue.splice(0, this.queue.length - QUEUE_MAX)
    }
    this.connect()
  }

  /**
   * Suscribe (attach) a una sesión. `attached` solo registra lo REALMENTE
   * enviado por ESTE socket: si no está abierto, el attach lo hará `attachAll()`
   * en el `onopen` (no se encola: se duplicaría).
   */
  private attach(id: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.connect()
      return
    }
    if (this.attached.has(id)) return
    this.attached.add(id)
    this.sendNow({ type: 'attach', sessionId: id })
  }

  private detach(id: string): void {
    if (!this.attached.delete(id)) return
    if (this.ws?.readyState === WebSocket.OPEN) this.sendNow({ type: 'detach', sessionId: id })
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
        this.setServerQueue(sessionId, frame.queue)
        this.applySnapshot(
          sessionId,
          Array.isArray(frame.events) ? (frame.events as LogEvent[]) : [],
          typeof frame.status === 'string' ? (frame.status as TurnStatus) : 'idle',
          typeof frame.claudeSessionId === 'string' ? frame.claudeSessionId : null,
          typeof frame.queueLength === 'number' ? frame.queueLength : 0,
          typeof frame.cwd === 'string' ? frame.cwd : null
        )
        return
      case 'event':
        if (frame.event && typeof frame.event === 'object') {
          this.applyLive(sessionId, frame.event as LogEvent)
        }
        return
      case 'status': {
        this.setServerQueue(sessionId, frame.queue)
        this.updateSession(sessionId, (s) => ({
          ...s,
          streaming: frame.status === 'running' || frame.status === 'queued',
          queued: typeof frame.queueLength === 'number' ? frame.queueLength : s.queued,
        }))
        // La cola cambió (entró, arrancó o se canceló uno): repinta las burbujas.
        this.refreshPending(sessionId)
        return
      }
      case 'ack': {
        // Confirmación AUTORITATIVA de RECEPCIÓN (el server ya lo aceptó). NO
        // retira la burbuja local: el evento `user` del log se registra al
        // ARRANCAR el turno, y con los slots de concurrencia ocupados eso puede
        // tardar minutos. Borrarla aquí hacía DESAPARECER de la pantalla el
        // mensaje recién enviado (hilo vacío + composer bloqueado). El pendiente
        // se marca `acked`: deja de reenviarse y de caducar, y su burbuja se
        // mantiene hasta que llegue su evento `user` (mismo id → relevo limpio).
        const localId = typeof frame.localId === 'string' ? frame.localId : ''
        const p = localId ? this.pending.get(localId) : undefined
        if (p && !p.acked) {
          p.acked = true
          // Si se había dado por no entregado (reintento manual), el ack lo
          // desmiente: vuelve a "enviando".
          if (p.failed) {
            p.failed = false
            this.refreshPending(p.sessionId)
          }
        }
        return
      }
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
    queueLength: number,
    /** Ancla de proyecto que ya fijó el server (null = sin fijar). */
    cwd: string | null
  ): void {
    if (!this.getSession(sessionId)) return // snapshot de una sesión ya cerrada
    const acc: Assembler = { items: [], openId: null, thinkingOpen: false, seq: 0 }
    events.forEach((ev, i) => {
      if (!ev || !ev.type) return
      acc.seq = i // id determinista del assistant que abra este evento
      reduceEvent(acc, ev)
      // Registra aprobaciones pendientes del snapshot para enrutar el decide.
      if (ev.type === 'permission_request' || ev.type === 'question_request') {
        this.pendingPerm.set(ev.requestId, sessionId)
      }
      // El log del server es la confirmación de entrega de nuestros envíos.
      if (ev.type === 'user') this.pending.delete(ev.id)
    })
    const running = status === 'running' || status === 'queued'
    // Si el turno NO está vivo, cierra el assistant abierto (no dejar typing fantasma).
    if (!running) closeAssistant(acc)
    // Y al revés: si el turno SÍ sigue vivo pero el log ya cerró el último
    // mensaje (p.ej. termina en `result` y hay otro mensaje en cola), abre uno
    // vacío para que se pinte el typing: el usuario debe VER que sigue trabajando.
    else if (acc.openId === null) {
      acc.seq = events.length // fuera del rango del log → id propio, sin colisión
      openAssistant(acc, '-pending')
    }
    this.cursors.set(sessionId, { openId: acc.openId, thinkingOpen: acc.thinkingOpen })
    this.eventCounts.set(sessionId, events.length)
    this.reconcileAcked(sessionId, status, queueLength)
    this.commitThread(sessionId, acc.items, {
      streaming: running,
      queued: queueLength,
      ...(claudeSessionId ? { claudeSessionId } : {}),
      // El ancla del server MANDA (la fijó el primer turno, puede venir de otro
      // dispositivo). Si aún no la ha fijado, no se pisa la elección local.
      ...(cwd ? { cwd } : {}),
    })
    // Reenvío at-least-once: el snapshot ya dijo qué llegó y qué no.
    if (this.resendAfterSnapshot.delete(sessionId)) this.resendPending(sessionId)
  }

  /** Aplica un evento en vivo sobre el estado actual de la sesión. */
  private applyLive(sessionId: string, ev: LogEvent): void {
    const session = this.getSession(sessionId)
    if (!session || !ev.type) return
    // Cuenta TODOS los eventos entregados (también los que no tocan el hilo):
    // así el índice en vivo sigue la misma numeración que el log del snapshot.
    const seq = this.eventCounts.get(sessionId) ?? 0
    this.eventCounts.set(sessionId, seq + 1)

    // 'session' solo actualiza el claudeSessionId (para reanudar); no toca el hilo.
    if (ev.type === 'session') {
      this.updateSession(sessionId, (s) => ({ ...s, claudeSessionId: ev.sessionId }))
      return
    }
    if (ev.type === 'permission_request' || ev.type === 'question_request') {
      this.pendingPerm.set(ev.requestId, sessionId)
    }
    // El server ya tiene la burbuja: deja de ser un envío pendiente (mismo id →
    // la burbuja local se sustituye por la del log SIN parpadeo ni duplicado).
    if (ev.type === 'user') this.pending.delete(ev.id)

    const cur = this.cursors.get(sessionId) ?? { openId: null, thinkingOpen: false }
    const acc: Assembler = {
      items: [...(this.threads.get(sessionId) ?? [])],
      openId: cur.openId,
      thinkingOpen: cur.thinkingOpen,
      seq,
    }
    reduceEvent(acc, ev)
    this.cursors.set(sessionId, { openId: acc.openId, thinkingOpen: acc.thinkingOpen })
    this.commitThread(sessionId, acc.items)
  }

  // ---- Envíos pendientes (at-least-once con dedupe por localId) -----------

  /**
   * Publica el hilo de una sesión = log del server + burbujas locales aún no
   * confirmadas. El hilo del server se guarda aparte (`threads`) para que
   * `applyLive` nunca parta de un hilo con burbujas locales mezcladas.
   */
  private commitThread(
    sessionId: string,
    serverItems: ChatItem[],
    patch: Partial<ChatSession> = {}
  ): void {
    this.threads.set(sessionId, serverItems)
    const extra = this.pendingItems(sessionId)
    this.updateSession(sessionId, (s) => ({
      ...s,
      ...patch,
      items: extra.length > 0 ? [...serverItems, ...extra] : serverItems,
    }))
  }

  /** Recompone el hilo publicado tras cambiar los pendientes (sin tocar el log). */
  private refreshPending(sessionId: string): void {
    this.commitThread(sessionId, this.threads.get(sessionId) ?? [])
  }

  /**
   * Envíos con `ack` que el server YA NO tiene. Solo se puede concluir con el
   * server EN REPOSO (el mensaje no está en el log, ni en la cola, ni hay turno
   * vivo) y si el `ack` vino de una conexión ANTERIOR: en la conexión actual un
   * mensaje aceptado puede estar simplemente esperando slot de concurrencia
   * (status 'queued'), que es correcto y NO es un fallo. Cuando se cumplen las
   * dos condiciones el mensaje se perdió de verdad (server reiniciado con el
   * turno sin arrancar): se marca NO ENTREGADO, con reintento manual, en vez de
   * dejar la burbuja "enviando" para siempre. Nunca se reenvía solo: duplicaría
   * el turno. (Lo publica el `commitThread` que viene justo después.)
   */
  private reconcileAcked(sessionId: string, status: TurnStatus, queueLength: number): void {
    if (status === 'running' || status === 'queued' || queueLength > 0) return
    for (const p of this.pending.values()) {
      if (p.sessionId !== sessionId || !p.acked || p.failed) continue
      if (p.sentOnConn === this.connId) continue // ack de ESTA conexión: en curso
      p.failed = true
    }
  }

  /** Guarda la cola del server de una sesión; un frame sin `queue` no la borra. */
  private setServerQueue(sessionId: string, raw: unknown): void {
    const queue = parseQueue(raw)
    if (queue) this.serverQueue.set(sessionId, queue)
  }

  /**
   * Burbujas que van DESPUÉS del log del server: primero lo que el server tiene
   * EN COLA (confirmado, cancelable) y luego lo que aún no ha confirmado. Un
   * mismo `localId` puede estar en ambos sitios (el pendiente vive hasta que su
   * evento `user` entra en el log): gana la cola del server, que es la verdad.
   */
  private pendingItems(sessionId: string): ChatItem[] {
    const out: ChatItem[] = []
    const queued = this.serverQueue.get(sessionId) ?? []
    const inQueue = new Set(queued.map((q) => q.localId))
    for (const q of queued) {
      out.push({ kind: 'user', id: q.localId, text: q.text, delivery: 'queued' })
    }
    for (const p of this.pending.values()) {
      if (p.sessionId !== sessionId || inQueue.has(p.localId)) continue
      // Con `ack` el mensaje está aceptado pero aún no en el hilo (espera slot o
      // turno): sigue siendo 'sending' — no ha empezado a responderse.
      out.push({
        kind: 'user',
        id: p.localId,
        text: p.text,
        delivery: p.failed ? 'failed' : 'sending',
      })
    }
    return out
  }

  /** Envía (o encola) un pendiente y arranca la espera de su `ack`. */
  private dispatchPending(p: PendingSend): void {
    p.sentAt = Date.now()
    p.sentOnConn = this.connId
    this.raw(p.frame)
    this.armAckWatchdog(p.localId)
  }

  /**
   * Un `message` enviado sin `ack` en unos segundos = socket zombi (dice OPEN
   * pero el `send` se perdió). Se corta y se reconecta: el snapshot del nuevo
   * socket dirá si llegó y, si no, `resendPending` lo reenvía.
   */
  private armAckWatchdog(localId: string): void {
    const conn = this.connId
    window.setTimeout(() => {
      const p = this.pending.get(localId)
      if (!p || p.acked || p.failed) return // confirmado (ack/log) o ya descartado
      if (p.sentOnConn !== conn) return // ya volvió a salir por otra conexión
      if (this.connId !== conn) return // la conexión ya cambió: nada que cortar
      if (this.ws?.readyState !== WebSocket.OPEN) return // ya lo gestiona onclose
      this.forceReconnect()
    }, ACK_TIMEOUT_MS)
  }

  /**
   * Reenvía los envíos de una sesión que el snapshot NO confirma. Reglas
   * exactas (nada de heurísticas): un envío está confirmado si llegó su `ack` o
   * si su `localId` aparece en el log; y solo se reenvía lo que salió por una
   * conexión ANTERIOR (lo enviado por la actual sigue en vuelo con su ack).
   */
  private resendPending(sessionId: string): void {
    let changed = false
    for (const p of this.pending.values()) {
      if (p.sessionId !== sessionId || p.failed) continue
      if (p.acked) continue // el server ya lo aceptó: reenviarlo sobra
      if (p.sentOnConn === this.connId) continue // en vuelo por esta conexión
      if (p.attempts >= PENDING_MAX_ATTEMPTS || Date.now() - p.firstSentAt > PENDING_TTL_MS) {
        // Se acabaron los intentos: mejor decir la verdad que fingir el envío.
        p.failed = true
        changed = true
        continue
      }
      p.attempts += 1
      this.dispatchPending(p)
      changed = true
    }
    if (changed) this.refreshPending(sessionId)
  }

  /**
   * Barrido periódico (red de seguridad): pide snapshot de las sesiones con
   * envíos que salieron por una conexión anterior y siguen sin confirmar —
   * decide `applySnapshot` — y marca como no entregado lo que pasó del TTL
   * TENIENDO conexión (sin red no se acusa al mensaje: la tira ya lo explica).
   * Los que YA tienen `ack` quedan fuera del barrido: están aceptados por el
   * server y pueden tardar lo que tarde su slot de concurrencia; caducarlos
   * sería mentir ("No entregado" sobre algo entregado).
   */
  private sweepPending(): void {
    if (this.pending.size === 0) return
    const online = this.ws?.readyState === WebSocket.OPEN
    const now = Date.now()
    const touched = new Set<string>()

    for (const p of this.pending.values()) {
      if (p.failed || p.acked || p.sentOnConn === this.connId || !online) continue
      if (!this.getSession(p.sessionId)) continue
      if (now - p.firstSentAt > PENDING_TTL_MS) {
        p.failed = true
        touched.add(p.sessionId)
        continue
      }
      this.resendAfterSnapshot.add(p.sessionId)
      this.sendNow({ type: 'attach', sessionId: p.sessionId })
    }
    for (const id of touched) this.refreshPending(id)
  }

  // ---- Acciones públicas (fachada del hook) ------------------------------

  /**
   * Activa una pestaña de la tira. Si el id NO está en la tira (caso real: el
   * deep-link de una notificación push apunta a una conversación que no está
   * abierta), activarlo dejaría un `activeId` FANTASMA: `applySnapshot` hace
   * early-return para sesiones que no están en `sessions`, así que el usuario
   * aterrizaría en un chat vacío para siempre. En ese caso se reabre con su meta
   * del historial y, si no se encuentra, se ignora la selección (el usuario se
   * queda donde estaba, que es mejor que un hilo fantasma).
   */
  selectSession = (id: string): void => {
    if (!id) return
    if (!this.getSession(id)) {
      void this.fetchHistory().then((list) => {
        const meta = list.find((s) => s.id === id)
        if (meta) this.reopenSession({ id: meta.id, title: meta.title, cwd: meta.cwd })
      })
      return
    }
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
  reopenSession = (meta: {
    id: string
    title: string
    claudeSessionId?: string | null
    cwd?: string | null
  }): void => {
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
        // El `snapshot` del attach la reconfirma; esto evita el parpadeo del chip.
        cwd: meta.cwd ?? null,
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

  /** Historial completo (scope=all) para el panel. NO entra en el snapshot; lo consume la UI.
   *  Incluye `claudeSessionId` (dedup contra el engine) y `cwd` (proyecto de cada una). */
  fetchHistory = async (): Promise<
    Array<{
      id: string
      title: string
      updatedAt: string
      open: boolean
      claudeSessionId?: string | null
      cwd?: string | null
    }>
  > => {
    try {
      const r = await fetch('/api/chat/sessions?scope=all', { credentials: 'include' })
      if (!r.ok) return []
      const data: {
        sessions?: Array<{
          id: string
          title: string
          updatedAt: string
          open: boolean
          claudeSessionId?: string | null
          cwd?: string | null
        }>
      } = await r.json()
      return Array.isArray(data.sessions) ? data.sessions : []
    } catch {
      return []
    }
  }

  /**
   * Historial REAL del ENGINE (Claude Code / CLI): las conversaciones del proyecto
   * abierto que viven como transcripts `.jsonl` en ~/.claude/projects (incluidas las
   * de VS Code). Es POR PROYECTO, así que necesita el cwd del workspace activo; sin
   * cwd devuelve []. Solo lectura; lo consume el panel de historial.
   */
  fetchEngineHistory = async (
    cwd: string | null,
  ): Promise<Array<{ id: string; title: string; updatedAt: string; gitBranch: string | null; messageCount: number }>> => {
    if (!cwd) return []
    try {
      const r = await fetch(`/api/chat/engine/sessions?cwd=${encodeURIComponent(cwd)}`, {
        credentials: 'include',
      })
      if (!r.ok) return []
      const data: {
        sessions?: Array<{ id: string; title: string; updatedAt: string; gitBranch: string | null; messageCount: number }>
      } = await r.json()
      return Array.isArray(data.sessions) ? data.sessions : []
    } catch {
      return []
    }
  }

  /**
   * Abre una conversación del ENGINE (transcript `.jsonl` de ~/.claude/projects; p.ej.
   * una de VS Code) como pestaña. El SERVER convierte el transcript y lo MATERIALIZA
   * (SQLite + runtime, reusando el sessionId del engine como id de pestaña → dedup
   * natural); aquí solo se espera a que termine y se hace attach → el hilo llega en el
   * snapshot. Antes el cliente descargaba el hilo y lo reenviaba en un PATCH: con
   * transcripts >1 MB nginx respondía 413 y la pestaña se abría vacía sin aviso.
   * Siempre se pide (también si la pestaña ya está en la tira): es idempotente y repara
   * una pestaña vacía de un intento anterior. Reanuda con `resume`.
   */
  openEngineSession = async (meta: { id: string; cwd: string | null }): Promise<void> => {
    const { cwd } = meta
    if (!cwd) return
    let session: { id: string; title: string; claudeSessionId: string | null }
    try {
      const r = await fetch(`/api/chat/engine/sessions/${encodeURIComponent(meta.id)}/open`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Nació en ESTE proyecto (su transcript vive bajo ~/.claude/projects/<cwd>):
        // se ancla desde el minuto uno, ya viene con hilo y no se puede mover.
        body: JSON.stringify({ cwd }),
      })
      if (!r.ok) return
      const data = (await r.json()) as {
        session?: { id: string; title: string; claudeSessionId: string | null }
      }
      if (!data.session) return
      session = data.session
    } catch {
      return
    }
    if (!this.getSession(session.id)) {
      const s: ChatSession = {
        id: session.id,
        name: session.title,
        items: [],
        open: true,
        ...(session.claudeSessionId ? { claudeSessionId: session.claudeSessionId } : {}),
        cwd,
      }
      this.setState({ sessions: [...this.state.sessions, s] })
    }
    this.setActive(session.id)
    this.attach(session.id)
  }

  /** Quita una pestaña de la tira, activa un vecino y nunca deja 0 pestañas. */
  private removeFromStrip(id: string, idx: number): void {
    this.cursors.delete(id)
    this.threads.delete(id)
    this.eventCounts.delete(id)
    this.serverQueue.delete(id)
    // Envíos pendientes de una pestaña cerrada: no tiene sentido reenviarlos.
    for (const [localId, p] of this.pending) if (p.sessionId === id) this.pending.delete(localId)
    // Ni sus permisos/preguntas pendientes (el mapa se repuebla con el snapshot
    // si la pestaña se reabre; sin esto crecía sin fin durante toda la sesión).
    for (const [requestId, sid] of this.pendingPerm) {
      if (sid === id) this.pendingPerm.delete(requestId)
    }
    this.resendAfterSnapshot.delete(id)
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

  /**
   * Fija el ancla de proyecto de una conversación: estado local (para que el chip
   * lo refleje ya) + PATCH best-effort. El server la fija por su cuenta al
   * arrancar el primer turno; esto la deja escrita también cuando el turno tarda
   * en arrancar (cola de concurrencia) o cuando se elige a mano antes de enviar.
   */
  private anchorCwd(sessionId: string, cwd: string): void {
    this.updateSession(sessionId, (s) => ({ ...s, cwd }))
    fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd }),
    }).catch(() => {
      /* sin persistencia: el ancla vive en memoria hasta el primer turno */
    })
  }

  /**
   * Cambia la carpeta (proyecto) de una conversación TODAVÍA NO INICIADA. Con el
   * hilo empezado no hace nada: el engine indexa sus transcripts por proyecto, y
   * mover el cwd a mitad partiría el historial y el `resume`. La UI ya oculta el
   * botón en ese caso; esto es el guard.
   */
  setSessionCwd = (id: string, cwd: string): void => {
    const session = this.getSession(id)
    if (!session || isChatStarted(session)) return
    this.anchorCwd(id, cwd)
  }

  /** Sincroniza el workspace activo (lo llama la vista desde WorkspaceProvider). */
  setDefaultCwd = (cwd: string | null): void => {
    if (this.state.defaultCwd === cwd) return
    this.setState({ defaultCwd: cwd })
  }

  sendMessage = (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    const sessionId = this.state.activeId
    const session = this.getSession(sessionId)
    if (!session) return

    // Carpeta del turno = ancla de la conversación; si aún no la tiene (chat sin
    // estrenar), el workspace activo — y este primer mensaje la deja fijada.
    const cwd = session.cwd ?? this.state.defaultCwd

    // Escribir con un turno vivo NO se bloquea: el runtime del server ENCOLA y
    // lo procesa al terminar (como Claude Code). La burbuja se pinta ya como
    // pendiente y pasa a 'queued' en cuanto el server confirma su cola.
    // `streaming` optimista = hay trabajo en marcha (botón ■ con el campo vacío).
    this.updateSession(sessionId, (s) => ({ ...s, streaming: true }))
    if (!session.cwd && cwd) this.anchorCwd(sessionId, cwd)
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

    const localId = uid('u')
    const frame: Record<string, unknown> = {
      type: 'message',
      sessionId,
      localId,
      text: trimmed,
      ...(cwd ? { cwd } : {}),
      ...(this.state.model ? { model: this.state.model } : {}),
      mode: this.state.permissionMode,
      ...effortPayload,
    }
    // Pendiente hasta que su burbuja aparezca en el LOG del server (el `ack` solo
    // confirma la recepción). La burbuja se pinta YA desde aquí y se sustituye
    // sin parpadeo por la del log (mismo id); si el envío se pierde, se reenvía
    // o se marca no entregado.
    const now = Date.now()
    const p: PendingSend = {
      localId,
      sessionId,
      text: trimmed,
      frame,
      firstSentAt: now,
      sentAt: now,
      sentOnConn: this.connId,
      attempts: 1,
      acked: false,
      failed: false,
    }
    this.pending.set(localId, p)
    this.refreshPending(sessionId)
    this.dispatchPending(p)
  }

  /** Reintento manual de un mensaje marcado como no entregado (burbuja fallida). */
  retryMessage = (localId: string): void => {
    const p = this.pending.get(localId)
    if (!p) return
    p.failed = false
    // Reintento = envío nuevo: el `ack` anterior ya no vale como confirmación
    // (el server que lo aceptó pudo reiniciarse). El nuevo `ack` lo re-confirma.
    p.acked = false
    p.attempts = 1
    p.firstSentAt = Date.now()
    this.refreshPending(p.sessionId)
    this.attach(p.sessionId)
    this.dispatchPending(p)
  }

  /**
   * Retira de la cola un mensaje que aún no ha arrancado. No se toca el hilo a
   * mano: el server responde con su `status` (cola nueva) y de ahí se repinta.
   * Si ya había arrancado, la cancelación no aplica y su burbuja pasa a mensaje
   * normal — nunca se finge que se canceló.
   */
  cancelQueued = (localId: string): void => {
    const p = this.pending.get(localId)
    const sessionId = p?.sessionId ?? this.state.activeId
    // Si seguía sin confirmar, deja de reenviarse (ya no lo queremos).
    if (p) this.pending.delete(localId)
    this.raw({ type: 'cancel', sessionId, localId })
    this.armSendWatchdog()
    this.refreshPending(sessionId)
  }

  /** Responde una pregunta de Claude (`AskUserQuestion`): {pregunta: respuesta}. */
  answerQuestion = (requestId: string, answers: Record<string, string>): void => {
    const sessionId = this.pendingPerm.get(requestId) ?? this.state.activeId
    this.pendingPerm.delete(requestId)
    this.raw({ type: 'answer', sessionId, requestId, answers })
    this.armSendWatchdog() // responder siempre mueve el hilo
    // Refleja la respuesta en la card sin esperar (el `question_answered` del
    // server la confirmará y es el que sobrevive al reattach).
    const items = (this.threads.get(sessionId) ?? []).map((it) =>
      it.kind === 'assistant'
        ? { ...it, blocks: applyResolution(it.blocks, requestId, 'applied', answers) }
        : it
    )
    this.commitThread(sessionId, items)
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
    this.armSendWatchdog() // resolver un permiso siempre mueve el hilo
    // Refleja la decisión en la card de inmediato (el tool_result confirmará
    // luego). Va sobre el hilo del server para que no la pise el próximo evento.
    const items = (this.threads.get(sessionId) ?? []).map((it) =>
      it.kind === 'assistant'
        ? {
            ...it,
            blocks: it.blocks.map((b) =>
              'requestId' in b && b.requestId === requestId ? { ...b, decision } : b
            ),
          }
        : it
    )
    this.commitThread(sessionId, items)
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
    const sessionId = this.state.activeId
    this.raw({ type: 'stop', sessionId })
    this.armSendWatchdog() // el stop responde con `status`
    // El `stop` DESCARTA en el server lo aceptado que aún no arrancó (la cola y
    // lo que esperaba slot): su evento `user` no llegará nunca al log, así que
    // sus burbujas se marcan NO ENTREGADO (con reintento) en vez de quedarse
    // "enviando" para siempre. Si alguna sí había arrancado, su evento `user`
    // llega igual y retira el pendiente: la marca se corrige sola.
    // Los envíos SIN `ack` no se tocan: pueden llegar después del stop y arrancar
    // un turno legítimo.
    let changed = false
    for (const p of this.pending.values()) {
      if (p.sessionId !== sessionId || !p.acked || p.failed) continue
      p.failed = true
      changed = true
    }
    if (changed) this.refreshPending(sessionId)
  }

  /** Reintento manual desde la UI (tira de estado): socket + lista de pestañas. */
  retryConnection = (): void => {
    this.sessionsAttempt = 0
    this.clearSessionsRetry()
    if (this.state.sessionsError || this.state.sessions.length === 0) this.loadSessions()
    if (this.ws?.readyState === WebSocket.OPEN) this.probe()
    else this.reconnectNow()
  }
}

/** Instancia única compartida por toda la app (sobrevive al remontaje de la vista). */
export const chatStore = new ChatStore()
