// Vista Chat — la estrella (CLAUDE.md §4, DESIGN.md §6): réplica de Claude
// Code en VS Code. Cabecera de conversaciones + hilo con tool-cards + input.
// Los datos son mock (useChatMock); el puente real con el CLI `claude` llega
// en Fase 3 y sustituirá el hook manteniendo este modelo de UI.
import { useChatMock } from './useChatMock'
import ChatTabs from './ChatTabs'
import ChatThread from './ChatThread'
import ChatComposer from './ChatComposer'
import styles from './ChatView.module.css'

export default function ChatView() {
  const chat = useChatMock()

  return (
    <main className={styles.view}>
      <h1 className={styles.srOnly}>Chat</h1>
      <ChatTabs
        sessions={chat.sessions}
        activeId={chat.activeId}
        onSelect={chat.selectSession}
        onAdd={chat.addSession}
      />
      <ChatThread session={chat.activeSession} onDecideEdit={chat.decideEdit} />
      <ChatComposer onSend={chat.sendMessage} />
    </main>
  )
}
