// Panel Source Control (DESIGN.md §8.1) — hoja inferior que se abre desde el
// chip de rama de Files. Hace lo esencial de git SIN terminal: preparar/quitar
// archivos, commit, subir (push), bajar (pull --ff-only) y cambiar de rama.
//
// Nada destructivo por diseño (ADR 2026-08-04): ni force, ni descartar cambios,
// ni resolver conflictos. Si git dice que hace falta, el panel remite a la
// Terminal en vez de inventarse una solución peligrosa en una pantalla de 6".
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError } from '../../api/client'
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitFetch,
  gitPull,
  gitPush,
  gitStage,
  gitUnstage,
  type GitFile,
  type GitRepoStatus,
} from '../../api/git'
import styles from './SourceControl.module.css'

interface SourceControlProps {
  /** Carpeta de trabajo activa (la que se manda al backend). */
  workspace: string
  /** Estado actual del repo (lo mantiene FilesView). */
  repo: GitRepoStatus
  /** Publica hacia arriba el estado que devuelve cada operación. */
  onStatus: (status: GitRepoStatus) => void
  onClose: () => void
}

/** Operación en curso (bloquea el resto del panel). */
type Busy = 'stage' | 'unstage' | 'commit' | 'push' | 'pull' | 'checkout' | null

interface Result {
  ok: boolean
  text: string
}

/** Nombre en palabras de cada letra de estado (para los `aria-label`). */
const LETTER_WORD: Record<string, string> = {
  M: 'modificado',
  A: 'añadido',
  D: 'borrado',
  R: 'renombrado',
  C: 'copiado',
  T: 'tipo cambiado',
  '?': 'sin seguimiento',
  '!': 'en conflicto',
}

/** Clase de color de la letra (DESIGN.md §3 · §8.1). */
const LETTER_CLASS: Record<string, string> = {
  M: styles.letterM,
  A: styles.letterA,
  D: styles.letterD,
  R: styles.letterR,
  C: styles.letterR,
  T: styles.letterM,
  '?': styles.letterU,
  '!': styles.letterConflict,
}

/**
 * Parte una ruta relativa en carpeta + nombre. git reporta una carpeta entera
 * sin seguimiento con barra final (`client/src/hooks/`): se conserva en el
 * nombre para que se vea que es una carpeta, no un archivo.
 */
function splitPath(p: string): { dir: string; name: string } {
  const isDir = p.endsWith('/')
  const clean = isDir ? p.slice(0, -1) : p
  const idx = clean.lastIndexOf('/')
  const name = idx < 0 ? clean : clean.slice(idx + 1)
  return { dir: idx < 0 ? '' : clean.slice(0, idx), name: isDir ? `${name}/` : name }
}

/** Texto de error: el `detail` real del backend, o un fallback por código. */
function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.detail) return err.detail
    if (err.code === 'not_a_repo') return 'Esta carpeta ya no es un repositorio git.'
    return `Ha fallado la operación (${err.code}).`
  }
  return 'No se ha podido contactar con el servidor.'
}

export default function SourceControl({ workspace, repo, onStatus, onClose }: SourceControlProps) {
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [branchesOpen, setBranchesOpen] = useState(false)
  const [branchList, setBranchList] = useState<string[] | null>(null)
  const [newBranch, setNewBranch] = useState('')
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const staged = repo.files.filter((f) => f.index)
  const changed = repo.files.filter((f) => f.work)
  const canCommit = staged.length > 0 && message.trim().length > 0

  // Cerrar con Esc (DESIGN §8.1: backdrop, Esc y ✕).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Foco inicial dentro de la hoja (a11y: diálogo modal).
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  /** Atrapa el Tab dentro de la hoja mientras está abierta (DESIGN §8.1 · §12). */
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !sheetRef.current) return
    const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled])'
    )
    if (focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // Al abrir: fetch silencioso para que ↑n ↓n sean reales y no la última foto
  // local. Si falla (sin token, sin red, sin remoto) se ignora: el resto del
  // panel funciona igual.
  useEffect(() => {
    let cancelled = false
    gitFetch(workspace)
      .then((status) => {
        if (!cancelled) onStatus(status)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // Solo al montar: un fetch por apertura del panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Ejecuta una operación bloqueando el panel y volcando el resultado a la tira. */
  const run = useCallback(
    async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
      if (busy) return
      setBusy(kind)
      setResult(null)
      try {
        await fn()
      } catch (err) {
        setResult({ ok: false, text: errorText(err) })
      } finally {
        setBusy(null)
      }
    },
    [busy]
  )

  const doStage = (files?: string[]) =>
    run('stage', async () => onStatus(await gitStage(workspace, files)))

  const doUnstage = (files?: string[]) =>
    run('unstage', async () => onStatus(await gitUnstage(workspace, files)))

  const doCommit = () =>
    run('commit', async () => {
      const res = await gitCommit(workspace, message)
      onStatus(res.status)
      setMessage('')
      setResult({ ok: true, text: `✓ guardado ${res.hash} · ${res.summary}` })
    })

  const doPush = () =>
    run('push', async () => {
      const res = await gitPush(workspace)
      onStatus(res.status)
      setResult({ ok: true, text: `✓ subido a ${res.status.upstream ?? 'origin'}` })
    })

  const doPull = () =>
    run('pull', async () => {
      const res = await gitPull(workspace)
      onStatus(res.status)
      const upToDate = /Already up to date|Ya está actualizado/i.test(res.output)
      setResult({ ok: true, text: upToDate ? '✓ ya estabas al día' : '✓ cambios bajados del servidor' })
    })

  const doCheckout = (branch: string, create: boolean) =>
    run('checkout', async () => {
      onStatus(await gitCheckout(workspace, branch, create))
      setBranchesOpen(false)
      setNewBranch('')
      setBranchList(null)
      setResult({ ok: true, text: create ? `✓ rama ${branch} creada` : `✓ ahora estás en ${branch}` })
    })

  /** Abre/cierra la lista de ramas, cargándola la primera vez. */
  const toggleBranches = () => {
    const next = !branchesOpen
    setBranchesOpen(next)
    if (next && branchList === null) {
      gitBranches(workspace)
        .then((res) => setBranchList(res.all))
        .catch(() => setBranchList([]))
    }
  }

  /** Fila de archivo. `mode` decide si el botón añade o quita del commit. */
  const fileRow = (file: GitFile, mode: 'staged' | 'changed') => {
    const letter = (mode === 'staged' ? file.index : file.work) ?? '?'
    const { dir, name } = splitPath(file.path)
    const word = LETTER_WORD[letter] ?? 'cambiado'
    // En un renombrado hay que operar también sobre la ruta original.
    const targets = file.origPath ? [file.path, file.origPath] : [file.path]
    return (
      <li key={`${mode}:${file.path}`} className={styles.fileRow}>
        <span className={`${styles.letter} ${LETTER_CLASS[letter] ?? ''}`} aria-hidden="true">
          {letter}
        </span>
        <span className={styles.fileMeta}>
          <span className={styles.fileName}>{name}</span>
          {dir && (
            <span className={styles.fileDir}>
              <bdi>{dir}</bdi>
            </span>
          )}
        </span>
        <button
          type="button"
          className={styles.rowAction}
          disabled={busy !== null}
          onClick={() => (mode === 'staged' ? doUnstage(targets) : doStage(targets))}
          aria-label={
            mode === 'staged'
              ? `Quitar ${file.path} (${word}) del commit`
              : `Añadir ${file.path} (${word}) al commit`
          }
        >
          {mode === 'staged' ? '−' : '+'}
        </button>
      </li>
    )
  }

  const netDisabled = busy !== null || !repo.tokenPresent

  return createPortal(
    <div className={styles.overlay}>
      <button type="button" className={styles.scrim} aria-label="Cerrar" onClick={onClose} />

      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-title"
        onKeyDown={trapTab}
      >
        <header className={styles.header}>
          <div className={styles.headerMeta}>
            <h2 id="sc-title" className={styles.title}>
              Source Control
            </h2>
            <span className={styles.repoPath}>
              <bdi>{repo.root}</bdi>
            </span>
          </div>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className={styles.body}>
          {/* --- Rama + contadores --- */}
          <div className={styles.branchRow}>
            <button
              type="button"
              className={styles.branchBtn}
              onClick={toggleBranches}
              disabled={busy !== null}
              aria-expanded={branchesOpen}
            >
              <span className={styles.branchIcon} aria-hidden="true">
                ⑂
              </span>
              <span className={styles.branchName}>{repo.branch ?? 'HEAD suelto'}</span>
              <span className={styles.caret} aria-hidden="true">
                ▾
              </span>
            </button>
            <span className={styles.counters}>
              {repo.upstream ? (
                <>
                  <span className={styles.ahead}>↑{repo.ahead}</span>
                  <span className={styles.behind}>↓{repo.behind}</span>
                </>
              ) : (
                <span className={styles.noUpstream}>sin subir aún</span>
              )}
            </span>
          </div>

          {branchesOpen && (
            <div className={styles.branchPanel}>
              {branchList === null && <p className={styles.hint}>cargando ramas…</p>}
              {branchList?.length === 0 && <p className={styles.hint}>todavía no hay ramas</p>}
              {branchList && branchList.length > 0 && (
                <ul className={styles.branchList}>
                  {branchList.map((b) => (
                    <li key={b}>
                      <button
                        type="button"
                        className={`${styles.branchItem} ${b === repo.branch ? styles.branchItemCurrent : ''}`}
                        disabled={busy !== null || b === repo.branch}
                        onClick={() => doCheckout(b, false)}
                      >
                        <span className={styles.branchDot} aria-hidden="true">
                          {b === repo.branch ? '●' : '○'}
                        </span>
                        {b}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.newBranch}>
                <input
                  className={styles.input}
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  placeholder="nombre de la rama nueva"
                  aria-label="Nombre de la rama nueva"
                  spellCheck={false}
                  autoCapitalize="none"
                />
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={busy !== null || newBranch.trim().length === 0}
                  onClick={() => doCheckout(newBranch.trim(), true)}
                >
                  crear
                </button>
              </div>
            </div>
          )}

          {/* --- Bajar / Subir --- */}
          <div className={styles.syncRow}>
            <button
              type="button"
              className={styles.syncBtn}
              onClick={doPull}
              disabled={netDisabled}
              aria-busy={busy === 'pull'}
            >
              {busy === 'pull' ? 'bajando…' : `↓ Bajar${repo.behind > 0 ? ` (${repo.behind})` : ''}`}
            </button>
            <button
              type="button"
              className={styles.syncBtn}
              onClick={doPush}
              disabled={netDisabled}
              aria-busy={busy === 'push'}
            >
              {busy === 'push' ? 'subiendo…' : `↑ Subir${repo.ahead > 0 ? ` (${repo.ahead})` : ''}`}
            </button>
          </div>
          {!repo.tokenPresent && (
            <p className={styles.tokenWarning}>
              Falta el token de GitHub en el servidor: subir y bajar están desactivados.
            </p>
          )}

          {/* --- Cambios --- */}
          {repo.files.length === 0 ? (
            <p className={styles.empty}>sin cambios</p>
          ) : (
            <>
              {staged.length > 0 && (
                <section className={styles.group}>
                  <div className={styles.groupHead}>
                    <span className={styles.eyebrow}>PREPARADOS {staged.length}</span>
                    <button
                      type="button"
                      className={styles.groupAction}
                      disabled={busy !== null}
                      onClick={() => doUnstage()}
                    >
                      quitar todo
                    </button>
                  </div>
                  <ul className={styles.fileList}>{staged.map((f) => fileRow(f, 'staged'))}</ul>
                </section>
              )}

              {changed.length > 0 && (
                <section className={styles.group}>
                  <div className={styles.groupHead}>
                    <span className={styles.eyebrow}>CAMBIOS {changed.length}</span>
                    <button
                      type="button"
                      className={styles.groupAction}
                      disabled={busy !== null}
                      onClick={() => doStage()}
                    >
                      añadir todo
                    </button>
                  </div>
                  <ul className={styles.fileList}>{changed.map((f) => fileRow(f, 'changed'))}</ul>
                </section>
              )}
            </>
          )}

          {/* --- Commit --- */}
          <div className={styles.commitBox}>
            <textarea
              className={styles.textarea}
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Mensaje del commit"
              aria-label="Mensaje del commit"
              disabled={busy !== null}
            />
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!canCommit || busy !== null}
              onClick={doCommit}
              aria-busy={busy === 'commit'}
            >
              {busy === 'commit' ? 'guardando…' : 'Guardar cambios'}
            </button>
          </div>

          {/* --- Resultado de la última operación --- */}
          <p
            className={`${styles.result} ${result ? (result.ok ? styles.resultOk : styles.resultErr) : styles.resultIdle}`}
            aria-live="polite"
          >
            {result?.text ?? ''}
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
