// Vista Files (DESIGN.md §8) — cabecera con el workspace activo + botón para
// cambiar de carpeta (selector estilo VS Code) + explorer en árbol lazy.
// Desde la 14ª sesión también es la casa del Source Control (§8.1): chip de
// rama en la cabecera, panel de git en hoja inferior y marcas en el árbol.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import NavMenuButton from '../../components/NavMenuButton/NavMenuButton'
import FolderPicker from '../../components/FolderPicker/FolderPicker'
import FileTree from './FileTree'
import SourceControl from './SourceControl'
import { buildGitMarks, useGitStatus } from './useGitStatus'
import { scroll } from './treeCache'
import styles from './FilesView.module.css'

/** basename de una ruta POSIX ('/a/b/c' → 'c'). */
function basename(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1]! : p
}

export default function FilesView() {
  const { workspace, root, setWorkspace } = useWorkspace()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [scOpen, setScOpen] = useState(false)
  // Estado de git compartido por el chip, el panel y las marcas del árbol.
  const git = useGitStatus(workspace)
  const marks = useMemo(() => buildGitMarks(git.repo), [git.repo])

  // Al volver de otra vista, recupera el scroll del explorer. El árbol se pinta
  // en este mismo commit desde treeCache, así que la altura ya está ahí.
  const bodyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!workspace || !bodyRef.current) return
    bodyRef.current.scrollTop = scroll.workspace === workspace ? scroll.top : 0
  }, [workspace])

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

          {/* Chip de rama → panel Source Control (DESIGN.md §8.1). Si la carpeta
              no es un repo git, no se pinta: nada de estados muertos. */}
          {git.repo && (
            <button
              type="button"
              className={`${styles.branchChip} ${scOpen ? styles.branchChipOpen : ''}`}
              onClick={() => setScOpen(true)}
              aria-haspopup="dialog"
              aria-label={`Source Control · rama ${git.repo.branch ?? 'sin rama'}${
                git.repo.files.length > 0 ? ` · ${git.repo.files.length} archivos con cambios` : ''
              }`}
            >
              <span aria-hidden="true">⑂</span>
              <span className={styles.branchChipName}>{git.repo.branch ?? 'detached'}</span>
              {git.repo.upstream && (git.repo.ahead > 0 || git.repo.behind > 0) && (
                <span className={styles.branchChipCounts} aria-hidden="true">
                  {git.repo.ahead > 0 && `↑${git.repo.ahead}`}
                  {git.repo.behind > 0 && `↓${git.repo.behind}`}
                </span>
              )}
              {git.repo.files.length > 0 && (
                <span className={styles.branchChipDirty} aria-hidden="true">
                  ●
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      <div
        ref={bodyRef}
        className={styles.body}
        onScroll={(e) => {
          scroll.workspace = workspace
          scroll.top = e.currentTarget.scrollTop
        }}
      >
        <p className={styles.eyebrow}>Explorer</p>
        {/* key={workspace} remonta el árbol al cambiar de carpeta de trabajo */}
        <FileTree key={workspace} rootPath={workspace} marks={marks} />
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

      {scOpen && git.repo && (
        <SourceControl
          workspace={workspace}
          repo={git.repo}
          onStatus={git.apply}
          onClose={() => {
            setScOpen(false)
            git.refresh()
          }}
        />
      )}
    </main>
  )
}
