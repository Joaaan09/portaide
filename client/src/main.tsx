import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Fuentes autoalojadas (@fontsource) — pesos 400/500/600/700 + itálica 400
// (la itálica la usa, entre otros, el "thinking" del chat)
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-sans/400-italic.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/jetbrains-mono/400-italic.css'

import './styles/tokens.css'
import App from './App'
import { consumeChatDeepLink, registerServiceWorker } from './lib/push'

// Arranque desde una notificación (`/?chat=<sessionId>`): se apunta la sesión
// como pestaña activa ANTES de montar la app y se limpia la URL.
consumeChatDeepLink()

// El tema lo gestiona ThemeProvider (src/theme/); index.html trae
// data-theme="midnight" de base para evitar flash antes de hidratar.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service Worker: SOLO para Web Push (no cachea nada, ver client/public/sw.js).
// Registrarlo no pide permisos ni suscribe: eso lo hace el usuario en Settings.
void registerServiceWorker()
