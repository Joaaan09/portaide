// Tool-cards del chat (DESIGN.md §6): render de las herramientas de Claude Code
// — Read (fila), Edit (card con diff + Approve/Reject), Bash (terminal + estado)
// y una card genérica para el resto (Grep, WebFetch…). Approve/Reject sólo
// aparecen cuando hay un `requestId` de permiso pendiente (aprobaciones REALES).
import { useEffect, useRef, useState } from 'react'
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

/* Techo por card (DESIGN.md §6.7): un diff real llega a cientos de líneas y el
   hilo entero no puede pintarlas todas. Líneas visibles antes de colapsar: */
const EDIT_DIFF_LIMIT = 24
const BASH_OUTPUT_LIMIT = 16

/* ---------- Piezas de estado compartidas ---------- */

function StatusLine({
  decision,
  ok,
}: {
  decision: 'applied' | 'rejected' | 'auto' | 'interrupted'
  ok?: boolean
}) {
  // Un fallo de ejecución manda sobre la decisión (rojo).
  const failed = ok === false
  // 'interrupted' NO es un rechazo: el turno se cortó (stop, o un mensaje nuevo
  // que interrumpió el paso en curso) sin que el usuario decidiera nada.
  const label = failed
    ? '✕ Failed'
    : decision === 'interrupted'
      ? '⚠ Interrumpido'
      : decision === 'rejected'
        ? '✕ Rejected'
        : decision === 'auto'
          ? '✓ Auto-approved'
          : '✓ Approved'
  const cls =
    decision === 'interrupted' && !failed
      ? styles.statusInterrupted
      : failed || decision === 'rejected'
        ? styles.statusRejected
        : styles.statusApplied
  return (
    <p className={`${styles.status} ${cls}`} role="status">
      {label}
    </p>
  )
}

/**
 * El botón `⋯ N líneas más` desaparece al pulsarlo, así que el foco caería a
 * <body> y quien navega por teclado perdería el sitio: lo recogemos en el bloque
 * recién expandido. `preventScroll` para que no salte la vista.
 */
function useExpandFocus(expanded: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (expanded) ref.current?.focus({ preventScroll: true })
  }, [expanded])
  return ref
}

/**
 * Fila-botón `⋯ N líneas más` que cierra un bloque recortado (DESIGN.md §6.7).
 * Al pulsar expande la card ENTERA y el botón desaparece: no hay "mostrar menos"
 * porque la expansión es efímera — al remontar la vista la card vuelve colapsada,
 * y ese olvido es justo lo que evita reconstruir el árbol gigante otra vez.
 */
function MoreLines({
  hidden,
  onExpand,
  className,
}: {
  hidden: number
  onExpand: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={className ? `${styles.moreLines} ${className}` : styles.moreLines}
      aria-expanded={false}
      onClick={onExpand}
    >
      ⋯ {hidden} {hidden === 1 ? 'línea' : 'líneas'} más
    </button>
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
  // Techo por card (DESIGN.md §6.7): estado local y NO persistente a propósito.
  const [expanded, setExpanded] = useState(false)
  const hiddenLines = expanded ? 0 : Math.max(0, block.diff.length - EDIT_DIFF_LIMIT)
  // El corte es por la cola, así que el índice de la porción == el índice original.
  const lines = hiddenLines > 0 ? block.diff.slice(0, EDIT_DIFF_LIMIT) : block.diff
  const diffRef = useExpandFocus(expanded)

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

      <div className={styles.diff} ref={diffRef} tabIndex={-1}>
        {lines.map((line, i) => (
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
        {hiddenLines > 0 && <MoreLines hidden={hiddenLines} onExpand={() => setExpanded(true)} />}
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
  // Techo por card (DESIGN.md §6.7): estado local y NO persistente a propósito.
  const [expanded, setExpanded] = useState(false)
  const hiddenLines = expanded ? 0 : Math.max(0, block.output.length - BASH_OUTPUT_LIMIT)
  // El corte es por la cola, así que el índice de la porción == el índice original.
  const lines = hiddenLines > 0 ? block.output.slice(0, BASH_OUTPUT_LIMIT) : block.output
  const outputRef = useExpandFocus(expanded)

  return (
    <div className={styles.bash}>
      <div className={styles.bashHeader}>
        <span className={styles.bashPrompt} aria-hidden="true">
          $
        </span>
        <span className={styles.bashCommand}>{block.command}</span>
      </div>
      {block.output.length > 0 && (
        <div className={styles.bashOutput} ref={outputRef} tabIndex={-1}>
          {lines.map((line, i) => (
            <div key={i} className={line.ok ? `${styles.bashLine} ${styles.bashLineOk}` : styles.bashLine}>
              {line.text}
            </div>
          ))}
          {hiddenLines > 0 && (
            <MoreLines
              hidden={hiddenLines}
              onExpand={() => setExpanded(true)}
              className={styles.moreLinesBash}
            />
          )}
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
