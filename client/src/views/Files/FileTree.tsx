// Árbol de archivos lazy (DESIGN.md §8): cada carpeta carga sus hijos al
// expandirse (GET /api/fs/list de UNA carpeta) y los cachea. Los archivos, al
// pulsarlos, se abren en el Editor vía useOpenFiles().openFile().
import { useEffect, useState } from 'react'
import { listDir, type FsEntry, ApiError } from '../../api/client'
import { useOpenFiles } from '../../openfiles/OpenFilesProvider'
import styles from './FilesView.module.css'

// Colores de badge por extensión: excepción documentada en DESIGN.md §3
// (literales fijos por tipo de archivo, texto oscuro #0a0a0f encima).
const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6',
  json: '#e5b95c',
  env: '#9484b8',
  dockerfile: '#3a8fd9',
  md: '#5a5a70',
}
const BADGE_TEXT = '#0a0a0f' // texto sobre el badge de color (DESIGN.md §3)

/** Extensión normalizada de un nombre de archivo (Dockerfile y dotfiles incl.). */
function fileExt(name: string): string {
  if (/^dockerfile(\..+)?$/i.test(name)) return 'dockerfile'
  const base = name.startsWith('.') ? name.slice(1) : name
  const dot = base.lastIndexOf('.')
  return (dot >= 0 ? base.slice(dot + 1) : base).toLowerCase()
}

/** Une una carpeta con el nombre de un hijo (rutas POSIX absolutas). */
function joinPath(parent: string, name: string): string {
  return parent.endsWith('/') ? parent + name : `${parent}/${name}`
}

/** Traduce el código de error de la API a un texto sobrio para el árbol. */
function errText(err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'request_failed'
  if (code === 'forbidden') return 'sin permisos'
  if (code === 'not_found') return 'no existe'
  return 'error al cargar'
}

// --- Badge de archivo -----------------------------------------------------

function FileBadge({ name }: { name: string }) {
  const ext = fileExt(name)
  const color = EXT_COLORS[ext]
  const label = ext.slice(0, 4)
  if (color) {
    return (
      <span className={styles.fileBadge} style={{ background: color, color: BADGE_TEXT }}>
        {label}
      </span>
    )
  }
  return <span className={`${styles.fileBadge} ${styles.fileBadgeNeutral}`}>{label}</span>
}

// --- Nodo del árbol -------------------------------------------------------

interface TreeNodeProps {
  entry: FsEntry
  parentPath: string
  depth: number
}

function TreeNode({ entry, parentPath, depth }: TreeNodeProps) {
  const { openFile, activePath } = useOpenFiles()
  const path = joinPath(parentPath, entry.name)
  const indent = { paddingLeft: `${depth * 14 + 10}px` }

  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Carga perezosa: solo al expandir por primera vez. `loading` NO va en las
  // deps a propósito: si estuviera, setLoading(true) re-dispararía el efecto y
  // su cleanup cancelaría el fetch en vuelo (los hijos nunca se pintarían).
  useEffect(() => {
    if (!expanded || children !== null) return
    let cancelled = false
    setLoading(true)
    setError(null)
    listDir(path)
      .then((res) => {
        if (!cancelled) setChildren(res.entries)
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
  }, [expanded, children, path])

  if (entry.type === 'file') {
    const isActive = activePath === path
    return (
      <li className={styles.li} role="treeitem" aria-selected={isActive}>
        <button
          type="button"
          className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
          style={indent}
          onClick={() => openFile(path)}
        >
          <span className={styles.chevron} aria-hidden="true" />
          <FileBadge name={entry.name} />
          <span className={styles.rowName}>{entry.name}</span>
        </button>
      </li>
    )
  }

  // Carpeta
  return (
    <li className={styles.li} role="treeitem" aria-expanded={expanded}>
      <button
        type="button"
        className={styles.row}
        style={indent}
        onClick={() => setExpanded((v) => !v)}
      >
        <span
          className={styles.chevron}
          aria-hidden="true"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
        >
          ▸
        </span>
        <span className={`${styles.rowName} ${styles.dirName}`}>{entry.name}</span>
      </button>

      {expanded && (
        <ul className={styles.group} role="group">
          {loading && <li className={styles.hint} style={indent}>cargando…</li>}
          {error && (
            <li className={`${styles.hint} ${styles.hintError}`} style={indent}>
              {error}
            </li>
          )}
          {children?.length === 0 && (
            <li className={styles.hint} style={indent}>
              vacío
            </li>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.name}
              entry={child}
              parentPath={path}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// --- Raíz del árbol -------------------------------------------------------

export default function FileTree({ rootPath }: { rootPath: string }) {
  const [entries, setEntries] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Recarga al cambiar el workspace.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setEntries(null)
    listDir(rootPath)
      .then((res) => {
        if (!cancelled) setEntries(res.entries)
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
  }, [rootPath])

  if (loading) {
    return (
      <div className={styles.centerState}>
        <span className={styles.spinner} aria-hidden="true" />
        <span>cargando explorer…</span>
      </div>
    )
  }
  if (error) {
    return <div className={`${styles.centerState} ${styles.hintError}`}>{error}</div>
  }
  if (!entries || entries.length === 0) {
    return <div className={styles.centerState}>carpeta vacía</div>
  }

  return (
    <ul className={styles.tree} role="tree" aria-label="Explorer">
      {entries.map((entry) => (
        <TreeNode key={entry.name} entry={entry} parentPath={rootPath} depth={0} />
      ))}
    </ul>
  )
}
