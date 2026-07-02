// Tool-cards del chat (DESIGN.md §6): render de las herramientas de Claude Code
// — Read (fila), Edit (card con diff + Approve/Reject), Bash (terminal + estado)
// y una card genérica para el resto (Grep, WebFetch…). Approve/Reject sólo
// aparecen cuando hay un `requestId` de permiso pendiente (aprobaciones REALES).
import type {
  BashToolBlock,
  EditToolBlock,
  GenericToolBlock,
  ReadToolBlock,
  UserEditDecision,
} from './types'
import styles from './ToolCards.module.css'

/** Firma común para decidir un permiso pendiente (manda permission_decision). */
type DecideFn = (requestId: string, decision: UserEditDecision) => void

/* ---------- Piezas de estado compartidas ---------- */

function StatusLine({ decision, ok }: { decision: 'applied' | 'rejected' | 'auto'; ok?: boolean }) {
  // Un fallo de ejecución manda sobre la decisión (rojo).
  const failed = ok === false
  const label =
    failed ? '✕ Failed' : decision === 'rejected' ? '✕ Rejected' : decision === 'auto' ? '✓ Auto-approved' : '✓ Approved'
  const cls = failed || decision === 'rejected' ? styles.statusRejected : styles.statusApplied
  return (
    <p className={`${styles.status} ${cls}`} role="status">
      {label}
    </p>
  )
}

function ApproveReject({ requestId, onDecide }: { requestId: string; onDecide: DecideFn }) {
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.approve} onClick={() => onDecide(requestId, 'applied')}>
        ✓ Approve
      </button>
      <button type="button" className={styles.reject} onClick={() => onDecide(requestId, 'rejected')}>
        ✕ Reject
      </button>
    </div>
  )
}

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

export function EditCard({ block, onDecide }: { block: EditToolBlock; onDecide: DecideFn }) {
  // Como en el mockup, la cabecera muestra sólo el nombre del archivo.
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
        block.requestId ? (
          <ApproveReject requestId={block.requestId} onDecide={onDecide} />
        ) : null
      ) : (
        <StatusLine decision={block.decision} />
      )}
    </div>
  )
}

/* ---------- Bash: card de terminal con $ comando + salida + estado ---------- */

export function BashCard({ block, onDecide }: { block: BashToolBlock; onDecide: DecideFn }) {
  return (
    <div className={styles.bash}>
      <div className={styles.bashHeader}>
        <span className={styles.bashPrompt} aria-hidden="true">
          $
        </span>
        <span className={styles.bashCommand}>{block.command}</span>
      </div>
      {block.output.length > 0 && (
        <div className={styles.bashOutput}>
          {block.output.map((line, i) => (
            <div key={i} className={line.ok ? `${styles.bashLine} ${styles.bashLineOk}` : styles.bashLine}>
              {line.text}
            </div>
          ))}
        </div>
      )}
      {block.decision === 'pending' ? (
        block.requestId ? (
          <ApproveReject requestId={block.requestId} onDecide={onDecide} />
        ) : null
      ) : (
        <StatusLine decision={block.decision} ok={block.ok} />
      )}
    </div>
  )
}

/* ---------- Genérica: cualquier otra tool (Grep, WebFetch…) ---------- */

export function GenericToolCard({ block, onDecide }: { block: GenericToolBlock; onDecide: DecideFn }) {
  const pending = block.decision === 'pending' && block.requestId
  return (
    <div className={styles.edit}>
      <div className={styles.editHeader}>
        <span className={styles.genericIcon} aria-hidden="true">
          ◆
        </span>
        <span className={styles.toolLabel}>
          {block.name}
          {block.meta ? <span className={styles.toolFile}> {block.meta}</span> : null}
        </span>
      </div>
      {pending ? (
        <ApproveReject requestId={block.requestId!} onDecide={onDecide} />
      ) : block.decision !== 'pending' ? (
        <StatusLine decision={block.decision} ok={block.ok} />
      ) : null}
    </div>
  )
}
