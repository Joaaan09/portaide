// Selector de carpeta estilo "Open Folder" de VS Code (decisiones.md 2026-07-02).
// Navega el filesystem desde la raíz (GET /api/fs/list, solo carpetas), permite
// entrar/salir y confirmar la carpeta elegida.
//
// Componente COMPARTIDO (antes vivía en views/Files): lo usan Files (fijar el
// workspace) y el Chat (anclar la conversación a un proyecto). Por eso el título
// y la etiqueta del botón son parametrizables.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { listDir, type FsEntry, ApiError } from '../../api/client'
import styles from './FolderPicker.module.css'

interface FolderPickerProps {
  /** Raíz navegable: no se puede subir por encima de ella. */
  root: string
  /** Carpeta donde arranca la navegación (el workspace actual). */
  initialPath: string
  onClose: () => void
  /** Confirma la carpeta elegida. */
  onOpen: (path: string) => void
  /** Título de la hoja (por defecto "Open folder"). */
  title?: string
  /** Etiqueta del botón de confirmación (por defecto "Open this folder"). */
  confirmLabel?: string
}

function joinPath(parent: string, name: string): string {
  return parent.endsWith('/') ? parent + name : `${parent}/${name}`
}

/** Carpeta padre de `p`, sin bajar de `root`. Null si ya estamos en la raíz. */
function parentOf(p: string, root: string): string | null {
  if (p === root) return null
  const idx = p.lastIndexOf('/')
  const parent = idx > 0 ? p.slice(0, idx) : root
  return parent.startsWith(root) ? parent : root
}

function errText(err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'request_failed'
  if (code === 'forbidden') return 'sin permisos para esta carpeta'
  if (code === 'not_found') return 'la carpeta ya no existe'
  return 'error al listar la carpeta'
}

export default function FolderPicker({
  root,
  initialPath,
  onClose,
  onOpen,
  title = 'Open folder',
  confirmLabel = 'Open this folder',
}: FolderPickerProps) {
  const [current, setCurrent] = useState(initialPath)
  const [dirs, setDirs] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Lista la carpeta actual (solo subcarpetas: el selector elige carpetas).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listDir(current)
      .then((res) => {
        if (!cancelled) setDirs(res.entries.filter((e) => e.type === 'dir'))
      })
      .catch((err) => {
        if (!cancelled) setError(errText(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [current])

  // Escape cierra el selector.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const parent = parentOf(current, root)

  // Portal a <body>: el overlay debe escapar del contexto de apilamiento de la
  // vista (.viewport z-index:10 dentro de .shell) para poder pintarse POR ENCIMA
  // de la barra inferior de navegación (z-index:50) y el drawer (60). Si no, el
  // footer con el botón de confirmación queda tapado por la barra en móvil.
  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className={styles.scrim}
        aria-label="Cerrar selector"
        onClick={onClose}
      />

      <div className={styles.sheet}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button type="button" className={styles.close} aria-label="Cerrar" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className={styles.path}>{current}</p>

        <ul className={styles.list}>
          {parent !== null && (
            <li>
              <button type="button" className={styles.row} onClick={() => setCurrent(parent)}>
                <span className={styles.rowGlyph} aria-hidden="true">
                  ..
                </span>
                <span className={styles.rowName}>subir un nivel</span>
              </button>
            </li>
          )}

          {loading && <li className={styles.hint}>cargando…</li>}
          {error && <li className={`${styles.hint} ${styles.hintError}`}>{error}</li>}
          {!loading && !error && dirs?.length === 0 && (
            <li className={styles.hint}>sin subcarpetas</li>
          )}

          {dirs?.map((d) => (
            <li key={d.name}>
              <button
                type="button"
                className={styles.row}
                onClick={() => setCurrent(joinPath(current, d.name))}
              >
                <span className={styles.rowGlyph} aria-hidden="true">
                  ▸
                </span>
                <span className={styles.rowName}>{d.name}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className={styles.footer}>
          <button type="button" className={styles.confirm} onClick={() => onOpen(current)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
