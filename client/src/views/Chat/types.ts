// Modelo de datos de la vista Chat (CLAUDE.md §4, DESIGN.md §6). Es lo que PINTA
// la vista; los eventos del puente real (/ws/chat, Agent SDK) se mapean a estas
// estructuras en chatStore.ts (thinking → texto → tarjetas de tool → done).

/** Modos de permiso que expone la UI (Ask / Plan / Auto-edits / Bypass). */
export type ChatPermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

/** Niveles de esfuerzo del engine (SDK `options.effort`). */
export type ChatEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Ajuste de esfuerzo del composer: un nivel o 'auto' (= no enviar, default del engine). */
export type ChatEffortSetting = ChatEffort | 'auto'

/** Línea de un diff dentro de una tool-card Edit (colores en DESIGN.md §3) */
export interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  text: string
}

/** Estado de una edición propuesta: pendiente de decisión o ya resuelta */
export type EditDecision = 'pending' | 'applied' | 'rejected' | 'auto'

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
  | TextBlock

/** Bloques de tool con estado de aprobación (Edit / Bash / genérico) */
export type ApprovableBlock = EditToolBlock | BashToolBlock | GenericToolBlock

/** Burbuja del usuario (derecha, fondo --accent) */
export interface UserChatItem {
  kind: 'user'
  id: string
  text: string
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
  /** id local de la pestaña (o el id del server si hay persistencia). */
  id: string
  name: string
  items: ChatItem[]
  /** session_id de Claude para reanudar (`resume`); null hasta el 1er turno. */
  claudeSessionId?: string
  /** true mientras un turno de ESTA conversación está en curso. */
  streaming?: boolean
}
