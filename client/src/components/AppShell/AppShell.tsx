// AppShell — marco de la app (DESIGN.md §5): columna única a 100dvh con
// overflow oculto (el scroll vive dentro del <main> de cada vista), glow
// radial de acento arriba-centro y conmutación de la vista activa.
import type { ComponentType } from 'react'
import { useNavigation, type ViewId } from '../../navigation/NavigationProvider'
import FilesView from '../../views/Files/FilesView'
import EditorView from '../../views/Editor/EditorView'
import ChatView from '../../views/Chat/ChatView'
import TerminalView from '../../views/Terminal/TerminalView'
import SettingsView from '../../views/Settings/SettingsView'
import styles from './AppShell.module.css'

const VIEW_COMPONENTS: Record<ViewId, ComponentType> = {
  files: FilesView,
  editor: EditorView,
  chat: ChatView,
  terminal: TerminalView,
  settings: SettingsView,
}

export default function AppShell() {
  const { view } = useNavigation()
  const ActiveView = VIEW_COMPONENTS[view]

  return (
    <div className={styles.shell}>
      {/* Glow radial de acento: único efecto ambiental permitido (DESIGN.md §4) */}
      <div className={styles.glow} aria-hidden="true" />

      {/* key={view} remonta el contenedor al navegar → la animación `fadein` se reproduce */}
      <div key={view} className={styles.viewport}>
        <ActiveView />
      </div>
    </div>
  )
}
