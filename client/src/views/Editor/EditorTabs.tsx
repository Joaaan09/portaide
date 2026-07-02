// Tira de pestañas del Editor (DESIGN.md §7): badge de extensión + nombre,
// activa subrayada en --accent, punto --accent si el archivo está modificado
// (dirty) y botón ✕ para cerrar. Consume la lista de useOpenFiles() (la vista
// pasa los datos por props).
import type { OpenFile } from '../../openfiles/OpenFilesProvider'
import styles from './EditorView.module.css'

// Colores de badge por extensión: excepción documentada en DESIGN.md §3
// (literales fijos por tipo de archivo, texto oscuro encima). Reproduce el
// conjunto de FilesView para coherencia visual entre Files y Editor.
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

function TabBadge({ name }: { name: string }) {
  const ext = fileExt(name)
  const color = EXT_COLORS[ext]
  const label = ext.slice(0, 4)
  if (color) {
    return (
      <span className={styles.badge} style={{ background: color, color: BADGE_TEXT }}>
        {label}
      </span>
    )
  }
  return <span className={`${styles.badge} ${styles.badgeNeutral}`}>{label}</span>
}

interface EditorTabsProps {
  files: readonly OpenFile[]
  activePath: string | null
  dirty: Record<string, boolean>
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

export default function EditorTabs({ files, activePath, dirty, onSelect, onClose }: EditorTabsProps) {
  return (
    <div className={styles.tabsBar} role="tablist" aria-label="Archivos abiertos">
      {files.map((file) => {
        const isActive = file.path === activePath
        const isDirty = !!dirty[file.path]
        return (
          <div
            key={file.path}
            className={isActive ? `${styles.tabItem} ${styles.tabItemActive}` : styles.tabItem}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={isDirty ? `${file.name}, sin guardar` : undefined}
              className={styles.tab}
              onClick={() => onSelect(file.path)}
            >
              <TabBadge name={file.name} />
              <span className={styles.tabName}>{file.name}</span>
              {isDirty && <span className={styles.dirtyDot} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className={styles.tabClose}
              aria-label={`Cerrar ${file.name}`}
              onClick={() => onClose(file.path)}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
