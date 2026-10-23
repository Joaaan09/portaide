// Vista Chat — la estrella (CLAUDE.md §4, DESIGN.md §6): réplica de Claude Code
// en VS Code, ahora conectada a Claude REAL vía el puente /ws/chat (Agent SDK),
// con Approve/Reject reales de herramientas. El estado vive en el store singleton
// (useChatSession) para sobrevivir al remontaje de la vista.
import { useEffect, useState } from 'react'
import { useChatSession } from './useChatSession'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import ChatTabs from './ChatTabs'
import ConnBanner from '../../components/ConnBanner/ConnBanner'
import FolderPicker from '../../components/FolderPicker/FolderPicker'
import ChatThread from './ChatThread'
import ChatComposer from './ChatComposer'
import ChatHistory from './ChatHistory'
import styles from './ChatView.module.css'

/**
 * Etiqueta del chip de proyecto: la ruta RELATIVA a la raíz navegable
 * (`servers/portaide` → `portaide`), que es lo que identifica el proyecto sin
 * repetir el prefijo en cada chat. Fuera de la raíz cae al último segmento.
 */
function projectLabel(cwd: string | null, root: string | null): string {
  if (!cwd) return 'workspace'
  if (root && cwd.startsWith(root + '/')) return cwd.slice(root.length + 1)
  const parts = cwd.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

export default function ChatView() {
  const chat = useChatSession()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Workspace activo: es la carpeta que HEREDA un chat sin estrenar (el store la
  // usa como default; cada conversación fija la suya al primer mensaje).
  const { workspace, root } = useWorkspace()
  const { setDefaultCwd } = chat
  useEffect(() => {
    setDefaultCwd(workspace)
  }, [workspace, setDefaultCwd])

  const cwd = chat.activeCwd
  const cwdLabel = projectLabel(cwd, root)

  return (
    <main className={styles.view}>
      <h1 className={styles.srOnly}>Chat</h1>
      <ChatTabs
        sessions={chat.sessions}
        activeId={chat.activeId}
        onSelect={chat.selectSession}
        onAdd={chat.addSession}
        onClose={chat.closeSession}
        onOpenHistory={() => setHistoryOpen(true)}
      />
      {/* Tira de conexión (DESIGN.md §6.3): con el socket abierto y la lista
          cargada no ocupa nada; solo se pinta lo anormal. */}
      <ConnBanner
        status={chat.connStatus}
        errorText={chat.sessionsError ? 'No se pudieron cargar las conversaciones' : undefined}
        onRetry={chat.retryConnection}
      />
      <ChatThread
        session={chat.activeSession}
        onDecide={chat.decide}
        onAnswer={chat.answerQuestion}
        onRetryMessage={chat.retryMessage}
        onCancelQueued={chat.cancelQueued}
      />
      <ChatComposer
        onSend={chat.sendMessage}
        model={chat.model}
        modelOptions={chat.modelOptions}
        onModelChange={chat.setModel}
        permissionMode={chat.permissionMode}
        onPermissionChange={chat.setPermissionMode}
        effort={chat.effort}
        effortOptions={chat.effortOptions}
        onEffortChange={chat.setEffort}
        streaming={chat.activeSession.streaming ?? false}
        onInterrupt={chat.interrupt}
        cwdLabel={cwdLabel}
        cwdPath={cwd}
        // Solo se puede elegir carpeta antes del primer mensaje: después el
        // proyecto queda anclado (el engine indexa sus transcripts por cwd).
        onChangeCwd={chat.canChangeCwd && root ? () => setPickerOpen(true) : undefined}
      />
      {/* `canChangeCwd` en la condición: si la conversación arranca con el
          selector abierto (p.ej. desde otro dispositivo), se cierra solo. */}
      {pickerOpen && root && chat.canChangeCwd && (
        <FolderPicker
          root={root}
          initialPath={cwd ?? root}
          title="Carpeta del proyecto"
          confirmLabel="Usar esta carpeta"
          onClose={() => setPickerOpen(false)}
          onOpen={(path) => {
            chat.setSessionCwd(chat.activeId, path)
            setPickerOpen(false)
          }}
        />
      )}
      <ChatHistory
        open={historyOpen}
        // El historial del engine es POR PROYECTO: el del chat activo, que es el
        // que muestra el chip (y coincide con el workspace si aún no está anclado).
        cwd={cwd}
        onClose={() => setHistoryOpen(false)}
        onOpen={(meta) => chat.reopenSession({ id: meta.id, title: meta.title, cwd: meta.cwd })}
        onOpenEngine={(id) => chat.openEngineSession({ id, cwd })}
        onDelete={chat.deleteSession}
        onRename={chat.renameSession}
        fetchHistory={chat.fetchHistory}
        fetchEngineHistory={chat.fetchEngineHistory}
      />
    </main>
  )
}
