// AssistantMessage — mensaje del asistente (DESIGN.md §6): cabecerita
// (✦ en cuadradito + "Claude Code") y bloques en orden: thinking colapsable,
// tool-cards (Read/Edit/Bash) y texto final.
import { useState } from 'react'
import type { AssistantBlock, AssistantChatItem, ThinkingBlock, UserEditDecision } from './types'
import { BashCard, EditCard, ReadCard } from './ToolCards'
import styles from './AssistantMessage.module.css'

interface AssistantMessageProps {
  item: AssistantChatItem
  onDecideEdit: (blockId: string, decision: UserEditDecision) => void
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
  onDecideEdit: AssistantMessageProps['onDecideEdit'],
) {
  switch (block.type) {
    case 'thinking':
      return <ThinkingDisclosure key={index} block={block} />
    case 'read':
      return <ReadCard key={index} block={block} />
    case 'edit':
      return <EditCard key={block.id} block={block} onDecide={onDecideEdit} />
    case 'bash':
      return <BashCard key={index} block={block} />
    case 'text':
      return (
        <p key={index} className={styles.text}>
          {block.text}
        </p>
      )
  }
}

export default function AssistantMessage({ item, onDecideEdit }: AssistantMessageProps) {
  return (
    <div className={styles.message}>
      <div className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">
          ✦
        </span>
        <span className={styles.name}>Claude Code</span>
      </div>
      {item.blocks.map((block, i) => renderBlock(block, i, onDecideEdit))}
    </div>
  )
}
