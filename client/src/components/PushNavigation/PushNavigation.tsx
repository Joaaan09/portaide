// Puente entre el Service Worker y la navegación de la app: cuando el usuario
// toca una notificación con la PWA YA abierta, el SW enfoca la ventana y manda
// `portaide:open-chat` (client/public/sw.js). Aquí se traduce a "ir al Chat".
//
// No renderiza nada; se monta dentro de <NavigationProvider> (App.tsx).
//
// La app no usa rutas (la vista es estado en memoria) y el store del chat sólo
// lee la pestaña activa de localStorage al CARGAR la lista, así que con la app ya
// abierta no basta con navegar: además de `setActiveChatSession` (que cubre el
// arranque en frío) se emite `portaide:open-chat-session`. Lo ESCUCHA el store
// del chat (`views/Chat/chatStore.ts`, en `bindLifecycle`), que selecciona esa
// pestaña —o la reabre desde el historial si no está en la tira—.
import { useEffect } from 'react'
import { onPushNavigate, setActiveChatSession } from '../../lib/push'
import { useNavigation } from '../../navigation/NavigationProvider'

export default function PushNavigation() {
  const { setView } = useNavigation()

  useEffect(() => {
    return onPushNavigate((sessionId) => {
      if (sessionId) {
        setActiveChatSession(sessionId)
        window.dispatchEvent(
          new CustomEvent('portaide:open-chat-session', { detail: { sessionId } })
        )
      }
      setView('chat')
    })
  }, [setView])

  return null
}
