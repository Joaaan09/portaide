// Modelo de datos de la vista Chat (CLAUDE.md §4, DESIGN.md §6). Es lo que PINTA
// la vista; los eventos del puente real (/ws/chat, Agent SDK) se mapean a estas
// estructuras en chatStore.ts (thinking → texto → tarjetas de tool → done).

/** Modos de permiso que expone la UI (Ask / Plan / Auto-edits / Bypass). */
export type ChatPermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

/** Niveles de esfuerzo del engine (SDK `options.effort`). */
export type ChatEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Ajuste de esfuerzo del composer: un nivel, 'auto' (= no enviar, default del
 * engine) o 'ultracode'. 'ultracode' NO es un nivel de effort: es un tope
 * superior del slider que activa los workflows multiagente del SDK
 * (`settings.enableWorkflows`) y, además, fija el effort en 'max'.
 */
export type ChatEffortSetting = ChatEffort | 'auto' | 'ultracode'

/** Línea de un diff dentro de una tool-card Edit (colores en DESIGN.md §3) */
export interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  text: string
}

/**
 * Estado de una edición/tool propuesta: pendiente de decisión o ya resuelta.
 * 'interrupted' = se cerró sin decisión del usuario (turno abortado, o un
 * mensaje nuevo que cortó el paso en curso). NO es un rechazo: decir "Rejected"
 * de algo que el usuario no rechazó sería mentirle.
 */
export type EditDecision = 'pending' | 'applied' | 'rejected' | 'auto' | 'interrupted'

/** Decisiones que puede tomar el usuario desde la card (auto la pone el sistema) */
export type UserEditDecision = Extract<EditDecision, 'applied' | 'rejected'>

/** Bloque de razonamiento colapsable ("Thought for a moment") */
export interface ThinkingBlock {
  type: 'thinking'
  text: string
}

/** Tool-card Read: lectura de un archivo */
export interface ReadToolBlock {
  type: 'read'
  /** id del tool_use (para casar el tool_result que trae la meta) */
  id: string
  file: string
  /** Meta a la derecha de la fila, p.ej. "142 lines" (se rellena al resolver) */
  meta: string
}

/** Tool-card Edit: propuesta de edición con diff + Approve/Reject */
export interface EditToolBlock {
  type: 'edit'
  /** id del tool_use — casa el permission_request (requestId = toolUseID) */
  id: string
  /** requestId de la aprobación pendiente; presente ⇒ se muestran los botones */
  requestId?: string
  file: string
  additions: number
  deletions: number
  diff: DiffLine[]
  decision: EditDecision
}

/** Línea de salida de una tool-card Bash (`ok` la pinta en --green: PASS/✓) */
export interface BashOutputLine {
  text: string
  ok?: boolean
}

/** Tool-card Bash: comando + salida (+ estado de aprobación real) */
export interface BashToolBlock {
  type: 'bash'
  id: string
  requestId?: string
  command: string
  output: BashOutputLine[]
  decision: EditDecision
  /** Resultado de la ejecución (lo fija el tool_result). */
  ok?: boolean
}

/** Tool-card genérica: cualquier otra herramienta (WebFetch, Grep, …) */
export interface GenericToolBlock {
  type: 'tool'
  id: string
  requestId?: string
  name: string
  meta: string
  decision: EditDecision
  ok?: boolean
}

/** Una opción de respuesta de una pregunta de Claude (`AskUserQuestion`) */
export interface QuestionOption {
  label: string
  description?: string
}

/** Una pregunta de Claude: rótulo corto, enunciado, opciones y si admite varias */
export interface ChatQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: QuestionOption[]
}

/**
 * Tool-card de preguntas (`AskUserQuestion`, DESIGN.md §6.5): de 1 a 4 preguntas
 * con opciones. NO es un Approve/Reject: hay que ELEGIR y devolver las
 * respuestas, así que tiene su propia card.
 */
export interface QuestionToolBlock {
  type: 'question'
  /** id del tool_use (casa el question_request y el tool_result) */
  id: string
  /** requestId de la pregunta pendiente; presente ⇒ se puede responder */
  requestId?: string
  questions: ChatQuestion[]
  /** Respuestas enviadas (enunciado → respuesta); presente una vez resuelta */
  answers?: Record<string, string>
  decision: EditDecision
}

/** Texto plano del asistente (markdown-plano por ahora) */
export interface TextBlock {
  type: 'text'
  text: string
}

/** Bloques que componen un mensaje del asistente, en orden de render */
export type AssistantBlock =
  | ThinkingBlock
  | ReadToolBlock
  | EditToolBlock
  | BashToolBlock
  | GenericToolBlock
  | QuestionToolBlock
  | TextBlock

/** Bloques de tool con estado de aprobación (Edit / Bash / genérico) */
export type ApprovableBlock = EditToolBlock | BashToolBlock | GenericToolBlock

/** Burbuja del usuario (derecha, fondo --accent) */
export interface UserChatItem {
  kind: 'user'
  /** id del evento `user` del log del server = `localId` del envío (dedupe). */
  id: string
  text: string
  /**
   * Estado de ENTREGA (el hilo del server no lo tiene):
   * 'sending' = enviado, aún sin confirmar por el server · 'queued' = el server
   * lo tiene EN COLA (Claude sigue con el mensaje anterior; se puede cancelar) ·
   * 'failed' = no entregado tras los reintentos (la UI ofrece reintentar).
   * Sin valor = está en el log autoritativo del server.
   */
  delivery?: 'sending' | 'queued' | 'failed'
}

/** Mensaje del asistente (cabecerita "Claude Code" + bloques) */
export interface AssistantChatItem {
  kind: 'assistant'
  id: string
  blocks: AssistantBlock[]
  /** true mientras el turno sigue llegando (muestra el indicador de typing) */
  streaming?: boolean
}

/** Item del hilo: unión discriminada por `kind` */
export type ChatItem = UserChatItem | AssistantChatItem

/** Una conversación = una pestaña de la cabecera del chat */
export interface ChatSession {
  /** id (UUID) compartido con el server desde el nacimiento (el PATCH upsert lo materializa). */
  id: string
  name: string
  items: ChatItem[]
  /** session_id de Claude para reanudar (`resume`); null hasta el 1er turno. */
  claudeSessionId?: string
  /**
   * Carpeta del proyecto al que pertenece la conversación (ancla; es el `cwd` de
   * sus turnos). `null`/ausente = aún sin anclar: la conversación no ha empezado
   * y hereda el workspace activo, que es lo que muestra el chip del composer.
   * Una vez arranca el hilo, el ancla queda FIJA (el engine indexa sus
   * transcripts por proyecto: moverla partiría el historial y el `resume`).
   */
  cwd?: string | null
  /** true mientras un turno de ESTA conversación está en curso (o en cola). */
  streaming?: boolean
  /** nº de mensajes en cola (escritos mientras trabajaba); 0/undefined = ninguno. */
  queued?: number
  /** true = es una pestaña abierta (visible en la tira); false/undefined = solo historial. */
  open?: boolean
  /** true una vez el hilo (items) se ha rehidratado desde el server (lazy). */
  hydrated?: boolean
}
