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

// Tema por defecto; los 3 temas (midnight/lavender/magenta) se conmutarán desde Settings
document.documentElement.dataset.theme = 'midnight'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
