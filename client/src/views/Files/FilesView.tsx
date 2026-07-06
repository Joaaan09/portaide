// Vista Files (DESIGN.md §8) — cabecera con el workspace activo + botón para
// cambiar de carpeta (selector estilo VS Code) + explorer en árbol lazy.
import { useState } from 'react'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import NavMenuButton from '../../components/NavMenuButton/NavMenuButton'
import FileTree from './FileTree'
import FolderPicker from './FolderPicker'
import styles from './FilesView.module.css'

/** basename de una ruta POSIX ('/a/b/c' → 'c'). */
function basename(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1]! : p
}

export default function FilesView() {
  const { workspace, root, setWorkspace } = useWorkspace()
  const [pickerOpen, setPickerOpen] = useState(false)

  // Mientras se resuelve el workspace (GET /api/fs/context) mostramos carga.
  if (!workspace) {
    return (
      <main className={styles.view}>
        <div className={styles.centerState}>
          <span className={styles.spinner} aria-hidden="true" />
          <span>conectando al workspace…</span>
        </div>
      </main>
    )
  }

  const name = basename(workspace)
  const initial = name.charAt(0) || '~'

  return (
    <main className={styles.view}>
      <header className={styles.header}>
        <div className={styles.project}>
          <NavMenuButton />
          <span className={styles.badge} aria-hidden="true">
            {initial}
          </span>
          <div className={styles.projectMeta}>
            <span className={styles.projectName}>{name}</span>
            {/* bdi + rtl mantienen visible el final de la ruta al truncar */}
            <span className={styles.projectPath}>
              <bdi>{workspace}</bdi>
            </span>
          </div>
          <button
            type="button"
            className={styles.changeBtn}
            onClick={() => setPickerOpen(true)}
          >
            change folder
          </button>
        </div>

        <div className={styles.connRow}>
          <span className={styles.connDot} aria-hidden="true">
            ●
          </span>
          <span className={styles.connText}>connected</span>
        </div>
      </header>

      <div className={styles.body}>
        <p className={styles.eyebrow}>Explorer</p>
        {/* key={workspace} remonta el árbol al cambiar de carpeta de trabajo */}
        <FileTree key={workspace} rootPath={workspace} />
      </div>

      {pickerOpen && root && (
        <FolderPicker
          root={root}
          initialPath={workspace}
          onClose={() => setPickerOpen(false)}
          onOpen={(path) => {
            setWorkspace(path)
            setPickerOpen(false)
          }}
        />
      )}
    </main>
  )
}
