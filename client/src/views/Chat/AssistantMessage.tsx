// AssistantMessage — mensaje del asistente (DESIGN.md §6): cabecerita
// (✦ en cuadradito + "Claude Code") y bloques en orden: thinking colapsable,
// tool-cards (Read/Edit/Bash) y texto final.
import { memo, useState } from 'react'
import type { AssistantBlock, AssistantChatItem, ThinkingBlock, UserEditDecision } from './types'
import { BashCard, EditCard, GenericToolCard, ReadCard } from './ToolCards'
import QuestionCard from './QuestionCard'
import Markdown from './Markdown'
import styles from './AssistantMessage.module.css'

interface AssistantMessageProps {
  item: AssistantChatItem
  /**
   * Bloques del principio que NO se pintan: un turno entero es UN item y puede
   * traer cientos de bloques, así que la ventana del hilo recorta el primer
   * item visible por su cola (DESIGN.md §6.7). Solo lo recibe ese item.
   */
  skipBlocks?: number
  /** Approve/Reject de una tool pendiente: `requestId` = id del permiso. */
  onDecide: (requestId: string, decision: UserEditDecision) => void
  /** Respuestas a un `AskUserQuestion` pendiente (DESIGN.md §6.5). */
  onAnswer: (requestId: string, answers: Record<string, string>) => void
}

/* Thinking colapsable: "Thought for a moment" → bloque con borde izquierdo */
function ThinkingDisclosure({ block }: { block: ThinkingBlock }) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        type="button"
        className={styles.thinkingToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.thinkingChevron} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className={styles.thinkingLabel}>Thought for a moment</span>
      </button>
      {open && <p className={styles.thinkingBody}>{block.text}</p>}
    </div>
  )
}

function renderBlock(
  block: AssistantBlock,
  index: number,
  onDecide: AssistantMessageProps['onDecide'],
  onAnswer: AssistantMessageProps['onAnswer'],
) {
  switch (block.type) {
    case 'thinking':
      return <ThinkingDisclosure key={index} block={block} />
    case 'read':
      return <ReadCard key={block.id} block={block} />
    case 'edit':
      return <EditCard key={block.id} block={block} onDecide={onDecide} />
    case 'bash':
      return <BashCard key={block.id} block={block} onDecide={onDecide} />
    case 'tool':
      return <GenericToolCard key={block.id} block={block} onDecide={onDecide} />
    case 'question':
      return (
        <QuestionCard
          key={block.id}
          block={block}
          onAnswer={onAnswer}
          // Descartar una pregunta = denegar su permiso subyacente.
          onDiscard={(requestId) => onDecide(requestId, 'rejected')}
        />
      )
    case 'text':
      return <Markdown key={index}>{block.text}</Markdown>
  }
}

function AssistantMessageImpl({ item, skipBlocks = 0, onDecide, onAnswer }: AssistantMessageProps) {
  // El índice que se pasa a `renderBlock` es el ABSOLUTO (i + skipBlocks): así
  // las keys de thinking/texto no bailan cuando la ventana cambia el recorte.
  const blocks = skipBlocks > 0 ? item.blocks.slice(skipBlocks) : item.blocks
  return (
    <div className={styles.message}>
      <div className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">
          ✦
        </span>
        <span className={styles.name}>Claude Code</span>
      </div>
      {blocks.map((block, i) => renderBlock(block, i + skipBlocks, onDecide, onAnswer))}
    </div>
  )
}

// Memo válida: `onDecide`/`onAnswer` son propiedades-flecha del store singleton
// (identidad estable), así que solo se repinta el mensaje cuyo `item` cambia.
export default memo(AssistantMessageImpl)
