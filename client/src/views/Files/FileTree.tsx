// Árbol de archivos lazy (DESIGN.md §8): cada carpeta carga sus hijos al
// expandirse (GET /api/fs/list de UNA carpeta) y los cachea. Los archivos, al
// pulsarlos, se abren en el Editor vía useOpenFiles().openFile().
import { useEffect, useState } from 'react'
import { listDir, fsDownloadUrl, type FsEntry, ApiError } from '../../api/client'
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

// --- Marca de git (DESIGN.md §3 · §8.1) -----------------------------------

/** Clase de color por letra de estado. */
const GIT_MARK_CLASS: Record<string, string> = {
  M: styles.gitM,
  T: styles.gitM,
  A: styles.gitA,
  D: styles.gitD,
  R: styles.gitR,
  C: styles.gitR,
  '?': styles.gitU,
  '!': styles.gitD,
}

const GIT_MARK_WORD: Record<string, string> = {
  M: 'modificado',
  T: 'tipo cambiado',
  A: 'añadido',
  D: 'borrado',
  R: 'renombrado',
  C: 'copiado',
  '?': 'sin seguimiento',
  '!': 'en conflicto',
}

/** Marca informativa a la derecha de la fila (no es interactiva). */
function GitMark({ letter }: { letter: string }) {
  return (
    <span className={`${styles.gitMark} ${GIT_MARK_CLASS[letter] ?? styles.gitU}`}>
      <span aria-hidden="true">{letter}</span>
      <span className={styles.srOnly}> {GIT_MARK_WORD[letter] ?? 'con cambios'}</span>
    </span>
  )
}

// --- Acción de descarga (DESIGN.md §8) ------------------------------------

/** Botón de descarga al final de cada fila. Archivo → el archivo tal cual;
 *  carpeta → un .zip generado al vuelo por el backend. Es un <a download>: la
 *  cookie de sesión viaja sola (mismo origen). Va fuera del botón de la fila
 *  (hermano, no anidado) para no romper la semántica ni el toque de abrir. */
function DownloadAction({ path, name, type }: { path: string; name: string; type: 'dir' | 'file' }) {
  const label =
    type === 'dir' ? `Descargar la carpeta ${name} como zip` : `Descargar ${name}`
  return (
    <a
      className={styles.dlBtn}
      href={fsDownloadUrl(path)}
      download
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
    >
      <span aria-hidden="true">⤓</span>
    </a>
  )
}

/** true si alguna ruta con cambios cuelga de esta carpeta. */
function dirHasChanges(marks: Map<string, string> | undefined, dirPath: string): boolean {
  if (!marks || marks.size === 0) return false
  const prefix = `${dirPath}/`
  for (const key of marks.keys()) {
    if (key.startsWith(prefix)) return true
  }
  return false
}

// --- Nodo del árbol -------------------------------------------------------

interface TreeNodeProps {
  entry: FsEntry
  parentPath: string
  depth: number
  /** Mapa `ruta absoluta → letra de estado git` (DESIGN.md §8.1). */
  marks?: Map<string, string>
}

function TreeNode({ entry, parentPath, depth, marks }: TreeNodeProps) {
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
        <div className={styles.rowWrap}>
          <button
            type="button"
            className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
            style={indent}
            onClick={() => openFile(path)}
          >
            <span className={styles.chevron} aria-hidden="true" />
            <FileBadge name={entry.name} />
            <span className={styles.rowName}>{entry.name}</span>
            {marks?.get(path) && <GitMark letter={marks.get(path)!} />}
          </button>
          <DownloadAction path={path} name={entry.name} type="file" />
        </div>
      </li>
    )
  }

  // Carpeta
  return (
    <li className={styles.li} role="treeitem" aria-expanded={expanded}>
      <div className={styles.rowWrap}>
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
          {/* Una carpeta entera sin seguimiento tiene marca propia (git la reporta
              como un solo `?`). Si no, y está plegada, punto si hay cambios dentro
              (DESIGN.md §8.1); expandida sobra: las letras se ven en los hijos. */}
          {marks?.get(path) ? (
            <GitMark letter={marks.get(path)!} />
          ) : (
            !expanded &&
            dirHasChanges(marks, path) && (
              <span className={`${styles.gitMark} ${styles.gitDot}`}>
                <span aria-hidden="true">●</span>
                <span className={styles.srOnly}> contiene cambios</span>
              </span>
            )
          )}
        </button>
        <DownloadAction path={path} name={entry.name} type="dir" />
      </div>

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
              marks={marks}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// --- Raíz del árbol -------------------------------------------------------

export default function FileTree({
  rootPath,
  marks,
}: {
  rootPath: string
  /** Estado git por ruta absoluta (DESIGN.md §8.1). Opcional: sin repo, no hay marcas. */
  marks?: Map<string, string>
}) {
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
        <TreeNode key={entry.name} entry={entry} parentPath={rootPath} depth={0} marks={marks} />
      ))}
    </ul>
  )
}
