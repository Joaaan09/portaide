// Tool-cards del chat (DESIGN.md §6): render de las herramientas de Claude
// Code — Read (fila), Edit (card con diff + Approve/Reject) y Bash (terminal).
// Familia de componentes pequeños que comparten estilos de card.
import type { BashToolBlock, EditToolBlock, ReadToolBlock, UserEditDecision } from './types'
import styles from './ToolCards.module.css'

/* ---------- Read: fila con ◉ --blue + ruta en mono + meta ---------- */

export function ReadCard({ block }: { block: ReadToolBlock }) {
  return (
    <div className={styles.read}>
      <span className={styles.readIcon} aria-hidden="true">
        ◉
      </span>
      <span className={styles.toolLabel}>
        Read <span className={styles.toolFile}>{block.file}</span>
      </span>
      <span className={styles.toolMeta}>{block.meta}</span>
    </div>
  )
}

/* ---------- Edit: cabecera + diff + Approve/Reject o estado ---------- */

const DECISION_LABEL: Record<Exclude<EditToolBlock['decision'], 'pending'>, string> = {
  applied: '✓ Applied to file',
  rejected: '✕ Rejected',
  auto: '✓ Auto-applied',
}

interface EditCardProps {
  block: EditToolBlock
  onDecide: (blockId: string, decision: UserEditDecision) => void
}

export function EditCard({ block, onDecide }: EditCardProps) {
  // Como en el mockup, la cabecera muestra solo el nombre del archivo
  const fileName = block.file.split('/').pop() ?? block.file

  return (
    <div className={styles.edit}>
      <div className={styles.editHeader}>
        <span className={styles.editIcon} aria-hidden="true">
          ✎
        </span>
        <span className={styles.toolLabel}>
          Edit <span className={styles.toolFile}>{fileName}</span>
        </span>
        <span className={styles.editAdd}>+{block.additions}</span>
        <span className={styles.editDel}>−{block.deletions}</span>
      </div>

      <div className={styles.diff}>
        {block.diff.map((line, i) => (
          <div
            key={i}
            className={
              line.kind === 'add'
                ? `${styles.diffLine} ${styles.diffAdd}`
                : line.kind === 'del'
                  ? `${styles.diffLine} ${styles.diffDel}`
                  : styles.diffLine
            }
          >
            <span className={styles.diffSign} aria-hidden="true">
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
            </span>
            <span className={styles.diffText}>{line.text}</span>
          </div>
        ))}
      </div>

      {block.decision === 'pending' ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.approve}
            onClick={() => onDecide(block.id, 'applied')}
          >
            ✓ Approve
          </button>
          <button
            type="button"
            className={styles.reject}
            onClick={() => onDecide(block.id, 'rejected')}
          >
            ✕ Reject
          </button>
        </div>
      ) : (
        <p
          className={
            block.decision === 'rejected'
              ? `${styles.status} ${styles.statusRejected}`
              : `${styles.status} ${styles.statusApplied}`
          }
          role="status"
        >
          {DECISION_LABEL[block.decision]}
        </p>
      )}
    </div>
  )
}

/* ---------- Bash: card de terminal con $ comando + salida ---------- */

export function BashCard({ block }: { block: BashToolBlock }) {
  return (
    <div className={styles.bash}>
      <div className={styles.bashHeader}>
        <span className={styles.bashPrompt} aria-hidden="true">
          $
        </span>
        <span className={styles.bashCommand}>{block.command}</span>
      </div>
      <div className={styles.bashOutput}>
        {block.output.map((line, i) => (
          <div key={i} className={line.ok ? `${styles.bashLine} ${styles.bashLineOk}` : styles.bashLine}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  )
}
