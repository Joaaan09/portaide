// Vista Chat — la estrella (CLAUDE.md §4, DESIGN.md §6): réplica de Claude Code
// en VS Code, ahora conectada a Claude REAL vía el puente /ws/chat (Agent SDK),
// con Approve/Reject reales de herramientas. El estado vive en el store singleton
// (useChatSession) para sobrevivir al remontaje de la vista.
import { useState } from 'react'
import { useChatSession } from './useChatSession'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import ChatTabs from './ChatTabs'
import ConnBanner from '../../components/ConnBanner/ConnBanner'
import ChatThread from './ChatThread'
import ChatComposer from './ChatComposer'
import ChatHistory from './ChatHistory'
import styles from './ChatView.module.css'

export default function ChatView() {
  const chat = useChatSession()
  const [historyOpen, setHistoryOpen] = useState(false)
  // Lectura del workspace activo → es el `cwd` de cada turno (import en LECTURA).
  const { workspace } = useWorkspace()
  const contextLabel = workspace ? (workspace.split('/').filter(Boolean).pop() ?? undefined) : undefined

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
        onRetryMessage={chat.retryMessage}
      />
      <ChatComposer
        onSend={(text) => chat.sendMessage(text, workspace)}
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
        contextLabel={contextLabel}
      />
      <ChatHistory
        open={historyOpen}
        cwd={workspace}
        onClose={() => setHistoryOpen(false)}
        onOpen={(meta) => chat.reopenSession({ id: meta.id, title: meta.title })}
        onOpenEngine={(id) => chat.openEngineSession({ id, cwd: workspace })}
        onDelete={chat.deleteSession}
        onRename={chat.renameSession}
        fetchHistory={chat.fetchHistory}
        fetchEngineHistory={chat.fetchEngineHistory}
      />
    </main>
  )
}
