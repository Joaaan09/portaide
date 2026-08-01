// Selector de carpeta estilo "Open Folder" de VS Code (decisiones.md 2026-07-02).
// Navega el filesystem desde la raíz (GET /api/fs/list, solo carpetas), permite
// entrar/salir y "Open this folder" fija el workspace (WorkspaceProvider).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { listDir, type FsEntry, ApiError } from '../../api/client'
import styles from './FilesView.module.css'

interface FolderPickerProps {
  /** Raíz navegable: no se puede subir por encima de ella. */
  root: string
  /** Carpeta donde arranca la navegación (el workspace actual). */
  initialPath: string
  onClose: () => void
  /** Confirma la carpeta elegida (fija el workspace). */
  onOpen: (path: string) => void
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

export default function FolderPicker({ root, initialPath, onClose, onOpen }: FolderPickerProps) {
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
  // footer con el botón "Open this folder" queda tapado por la barra en móvil.
  return createPortal(
    <div
      className={styles.pickerOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="Open folder"
    >
      <button
        type="button"
        className={styles.pickerScrim}
        aria-label="Cerrar selector"
        onClick={onClose}
      />

      <div className={styles.pickerSheet}>
        <div className={styles.pickerHeader}>
          <h2 className={styles.pickerTitle}>Open folder</h2>
          <button
            type="button"
            className={styles.pickerClose}
            aria-label="Cerrar"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p className={styles.pickerPath}>{current}</p>

        <ul className={styles.pickerList}>
          {parent !== null && (
            <li>
              <button
                type="button"
                className={styles.pickerRow}
                onClick={() => setCurrent(parent)}
              >
                <span className={styles.pickerRowGlyph} aria-hidden="true">
                  ..
                </span>
                <span className={styles.pickerRowName}>subir un nivel</span>
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
                className={styles.pickerRow}
                onClick={() => setCurrent(joinPath(current, d.name))}
              >
                <span className={styles.pickerRowGlyph} aria-hidden="true">
                  ▸
                </span>
                <span className={styles.pickerRowName}>{d.name}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className={styles.pickerFooter}>
          <button type="button" className={styles.pickerOpen} onClick={() => onOpen(current)}>
            Open this folder
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
