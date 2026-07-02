// Modelo de datos UI-first de la vista Chat (CLAUDE.md §4, DESIGN.md §6).
// OJO: esto modela lo que PINTA la vista, NO el protocolo stream-json del
// CLI `claude` (el puente está por decidir — ver .progreso/decisiones.md).
// Cuando exista el puente, sus eventos se mapearán a estas estructuras.

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
  file: string
  /** Meta a la derecha de la fila, p.ej. "142 lines" */
  meta: string
}

/** Tool-card Edit: propuesta de edición con diff + Approve/Reject */
export interface EditToolBlock {
  type: 'edit'
  /** Identificador estable del bloque (para mutar su decisión desde la UI) */
  id: string
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

/** Tool-card Bash: comando + salida */
export interface BashToolBlock {
  type: 'bash'
  command: string
  output: BashOutputLine[]
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
  | TextBlock

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
}

/** Indicador "Claude está escribiendo" (tres puntos --accent) */
export interface TypingChatItem {
  kind: 'typing'
  id: string
}

/** Item del hilo: unión discriminada por `kind` */
export type ChatItem = UserChatItem | AssistantChatItem | TypingChatItem

/** Una conversación = una pestaña de la cabecera del chat */
export interface ChatSession {
  id: string
  name: string
  items: ChatItem[]
}
