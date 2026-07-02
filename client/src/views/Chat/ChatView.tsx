// Vista Chat — la estrella (CLAUDE.md §4, DESIGN.md §6): réplica de Claude Code
// en VS Code, ahora conectada a Claude REAL vía el puente /ws/chat (Agent SDK),
// con Approve/Reject reales de herramientas. El estado vive en el store singleton
// (useChatSession) para sobrevivir al remontaje de la vista.
import { useChatSession } from './useChatSession'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import ChatTabs from './ChatTabs'
import ChatThread from './ChatThread'
import ChatComposer from './ChatComposer'
import styles from './ChatView.module.css'

export default function ChatView() {
  const chat = useChatSession()
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
      />
      <ChatThread session={chat.activeSession} onDecide={chat.decide} />
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
    </main>
  )
}
