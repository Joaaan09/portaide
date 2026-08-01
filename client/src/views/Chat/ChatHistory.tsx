// ChatHistory — panel/drawer de historial de conversaciones (DESIGN.md §6.2).
// Overlay sobre el hilo (no pantalla completa), ancho del contenido de la app;
// entra con fade + translateY desde la cabecera (coherente con el panel de
// controles del composer, §11). Lista TODAS las conversaciones (abiertas +
// cerradas): tap abre/reabre, ✎ renombra inline y la papelera borra con confirmación.
// La lógica vive en el store (useChatSession); aquí sólo se consume.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import styles from './ChatHistory.module.css'

/** Fila del historial tal como la devuelve `fetchHistory` (scope=all). */
interface HistoryEntry {
  id: string
  title: string
  updatedAt: string
  open: boolean
  /** sessionId del engine asociado (si lo tiene): dedup contra el historial del servidor. */
  claudeSessionId?: string | null
}

/** Fila del historial del ENGINE (transcript .jsonl de ~/.claude/projects, incl. VS Code). */
interface EngineEntry {
  id: string
  title: string
  updatedAt: string
  gitBranch: string | null
  messageCount: number
}

interface ChatHistoryProps {
  open: boolean
  /** cwd del workspace activo: el historial del engine es POR PROYECTO. null = sin proyecto. */
  cwd: string | null
  onClose: () => void
  onOpen: (meta: { id: string; title: string }) => void
  /** Abre una conversación del engine (servidor) por su sessionId. */
  onOpenEngine: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  fetchHistory: () => Promise<HistoryEntry[]>
  fetchEngineHistory: (cwd: string | null) => Promise<EngineEntry[]>
}

// Formateador de fecha relativa en español ("hace 2 h", "ayer", "hace 3 d").
// numeric:'auto' habilita las palabras especiales (ayer/mañana); style:'short'
// da la forma abreviada del mockup.
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto', style: 'short' })

/** Fecha relativa desde un ISO; escala la unidad (segundos → años). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = then - Date.now() // negativo en el pasado
  const sec = Math.round(diffMs / 1000)
  if (Math.abs(sec) < 60) return rtf.format(sec, 'second')
  const min = Math.round(diffMs / 60000)
  if (Math.abs(min) < 60) return rtf.format(min, 'minute')
  const hr = Math.round(diffMs / 3600000)
  if (Math.abs(hr) < 24) return rtf.format(hr, 'hour')
  const day = Math.round(diffMs / 86400000)
  if (Math.abs(day) < 30) return rtf.format(day, 'day')
  const month = Math.round(day / 30)
  if (Math.abs(month) < 12) return rtf.format(month, 'month')
  return rtf.format(Math.round(day / 365), 'year')
}

/** Subtítulo técnico de una fila del engine: `rama · N msg` (mono, DESIGN §5). */
function engineSubtitle(e: EngineEntry): string {
  const parts: string[] = []
  if (e.gitBranch) parts.push(e.gitBranch)
  parts.push(`${e.messageCount} msg`)
  return parts.join(' · ')
}

export default function ChatHistory({
  open,
  cwd,
  onClose,
  onOpen,
  onOpenEngine,
  onDelete,
  onRename,
  fetchHistory,
  fetchEngineHistory,
}: ChatHistoryProps) {
  // null = cargando; array = lista resuelta (posiblemente vacía).
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  // Historial del engine (servidor): null = cargando; array = resuelto.
  const [engine, setEngine] = useState<EngineEntry[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const editRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => {
    fetchHistory()
      .then(setEntries)
      .catch(() => setEntries([]))
    fetchEngineHistory(cwd)
      .then(setEngine)
      .catch(() => setEngine([]))
  }, [fetchHistory, fetchEngineHistory, cwd])

  // Al abrir: reinicia estados efímeros y (re)carga ambas listas.
  useEffect(() => {
    if (!open) return
    setEntries(null)
    setEngine(null)
    setEditingId(null)
    setConfirmId(null)
    reload()
  }, [open, reload])

  // Escape cierra el panel (la edición inline gestiona su propio Escape).
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Foco inicial al panel (a11y §12); accesible por teclado desde ahí.
  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  // Al entrar en edición, enfoca y selecciona el título.
  useEffect(() => {
    if (editingId) {
      editRef.current?.focus()
      editRef.current?.select()
    }
  }, [editingId])

  if (!open) return null

  const handleOpen = (entry: HistoryEntry) => {
    onOpen({ id: entry.id, title: entry.title })
    onClose()
  }

  const handleOpenEngine = (id: string) => {
    onOpenEngine(id)
    onClose()
  }

  // Dedup: oculta del historial del servidor las conversaciones que YA figuran como
  // sesiones de PortaIDE (por id o por su claudeSessionId), para no listarlas dos veces.
  const taken = new Set<string>()
  for (const e of entries ?? []) {
    taken.add(e.id)
    if (e.claudeSessionId) taken.add(e.claudeSessionId)
  }
  const engineEntries = (engine ?? []).filter((e) => !taken.has(e.id))

  const startEdit = (event: MouseEvent, entry: HistoryEntry) => {
    event.stopPropagation()
    setConfirmId(null)
    setDraft(entry.title)
    setEditingId(entry.id)
  }

  const commitEdit = (id: string) => {
    const title = draft.trim()
    if (title) {
      // Optimista: refleja el nuevo título ya, y reconcilia con el re-fetch.
      setEntries((list) => list?.map((e) => (e.id === id ? { ...e, title } : e)) ?? list)
      onRename(id, title)
    }
    setEditingId(null)
    reload()
  }

  const cancelEdit = () => setEditingId(null)

  const handleEditKey = (event: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEdit(id)
    } else if (event.key === 'Escape') {
      // Corta la propagación para que el Escape no cierre además el panel.
      event.preventDefault()
      event.stopPropagation()
      cancelEdit()
    }
  }

  const askDelete = (event: MouseEvent, id: string) => {
    event.stopPropagation()
    setEditingId(null)
    setConfirmId(id)
  }

  const confirmDelete = (event: MouseEvent, id: string) => {
    event.stopPropagation()
    // Optimista: quítala de la lista ya; el re-fetch reconcilia.
    setEntries((list) => list?.filter((e) => e.id !== id) ?? list)
    setConfirmId(null)
    onDelete(id)
    reload()
  }

  const cancelDelete = (event: MouseEvent) => {
    event.stopPropagation()
    setConfirmId(null)
  }

  return (
    <div className={styles.overlay}>
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Cerrar historial"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Historial"
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Conversaciones</h2>
          <button
            type="button"
            className={styles.close}
            aria-label="Cerrar historial"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionLabel}>PortaIDE</h3>
            {entries === null ? (
              <p className={styles.hint}>cargando…</p>
            ) : entries.length === 0 ? (
              <p className={styles.sectionHint}>Sin conversaciones todavía</p>
            ) : (
              <ul className={styles.list}>
                {entries.map((entry) => {
              const isEditing = editingId === entry.id
              const isConfirming = confirmId === entry.id
              return (
                <li key={entry.id} className={styles.row}>
                  {isEditing ? (
                    <div className={styles.editRow}>
                      <input
                        ref={editRef}
                        className={styles.editInput}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => handleEditKey(e, entry.id)}
                        aria-label="Nuevo título"
                        enterKeyHint="done"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className={styles.editBtn}
                        aria-label="Confirmar título"
                        onClick={() => commitEdit(entry.id)}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className={styles.editBtn}
                        aria-label="Cancelar"
                        onClick={cancelEdit}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.rowMain}
                        onClick={() => handleOpen(entry)}
                      >
                        <span
                          className={entry.open ? styles.dot : styles.dotSpacer}
                          aria-hidden="true"
                        />
                        <span className={styles.rowTitle}>{entry.title}</span>
                        {entry.open && <span className={styles.srOnly}>(abierta)</span>}
                        <span className={styles.meta}>{relativeTime(entry.updatedAt)}</span>
                      </button>

                      {isConfirming ? (
                        <div className={styles.confirm}>
                          <span className={styles.confirmLabel}>¿Borrar?</span>
                          <button
                            type="button"
                            className={`${styles.confirmBtn} ${styles.confirmYes}`}
                            onClick={(e) => confirmDelete(e, entry.id)}
                          >
                            Sí
                          </button>
                          <button
                            type="button"
                            className={styles.confirmBtn}
                            onClick={cancelDelete}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.action}
                            aria-label={`Renombrar ${entry.title}`}
                            onClick={(e) => startEdit(e, entry)}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className={`${styles.action} ${styles.actionDanger}`}
                            aria-label={`Borrar ${entry.title}`}
                            onClick={(e) => askDelete(e, entry.id)}
                          >
                            {/* Papelera monocroma (SVG stroke=currentColor): respeta los
                                tokens de color, a diferencia del emoji 🗑 (DESIGN §5). */}
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                              <path d="M10 11v6M14 11v6" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
              </ul>
            )}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionLabel}>En el servidor · Claude Code</h3>
            {cwd === null ? (
              <p className={styles.sectionHint}>
                Abre un proyecto para ver sus conversaciones del servidor.
              </p>
            ) : engine === null ? (
              <p className={styles.hint}>cargando…</p>
            ) : engineEntries.length === 0 ? (
              <p className={styles.sectionHint}>
                No hay conversaciones del servidor en este proyecto.
              </p>
            ) : (
              <ul className={styles.list}>
                {engineEntries.map((entry) => (
                  <li key={entry.id} className={styles.row}>
                    <button
                      type="button"
                      className={styles.rowMain}
                      onClick={() => handleOpenEngine(entry.id)}
                    >
                      <span className={styles.dotSpacer} aria-hidden="true" />
                      <span className={styles.engineText}>
                        <span className={styles.engineTitle}>{entry.title}</span>
                        <span className={styles.rowSub}>{engineSubtitle(entry)}</span>
                      </span>
                      <span className={styles.meta}>{relativeTime(entry.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
