// Mapa extensión → soporte de lenguaje de CodeMirror 6 (DESIGN.md §3: syntax
// highlighting por tipo de archivo). Si la extensión no tiene lenguaje instalado
// se devuelve `[]` (texto plano, sin resaltado). Solo se usan los paquetes ya
// presentes en package.json.
import type { Extension } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'

/** Extensión en minúsculas de una ruta/nombre POSIX (Dockerfile incluido). */
function extOf(path: string): string {
  const name = path.split('/').pop() ?? path
  if (/^dockerfile(\..+)?$/i.test(name)) return 'dockerfile'
  const base = name.startsWith('.') ? name.slice(1) : name
  const dot = base.lastIndexOf('.')
  return (dot >= 0 ? base.slice(dot + 1) : '').toLowerCase()
}

/** Extensión de lenguaje para la ruta dada, o `[]` si no hay match (texto plano). */
export function languageForPath(path: string): Extension {
  switch (extOf(path)) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: true })
    case 'ts':
      return javascript({ typescript: true })
    case 'tsx':
      return javascript({ typescript: true, jsx: true })
    case 'json':
      return json()
    case 'html':
    case 'htm':
      return html()
    case 'css':
      return css()
    case 'md':
    case 'markdown':
      return markdown()
    case 'py':
      return python()
    default:
      return []
  }
}
