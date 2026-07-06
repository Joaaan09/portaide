// Markdown — renderiza el texto (GFM) de un mensaje del asistente con estilos
// por tokens (DESIGN.md §6). Sin HTML crudo (seguro: no hay rehype-raw), sin
// highlighting por lenguaje (bloques en JetBrains Mono sobre superficie);
// enlaces a nueva pestaña. El texto llega ya en Markdown desde el CLI `claude`.
import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './Markdown.module.css'

function MarkdownImpl({ children }: { children: string }) {
  return (
    <div className={styles.md}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Enlaces siempre en pestaña nueva y con rel de seguridad.
          a(props) {
            const { node, ...rest } = props
            return <a {...rest} target="_blank" rel="noopener noreferrer" />
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

// Memo: durante el streaming solo se re-parsea el bloque cuyo texto cambia,
// no los bloques de texto anteriores del mismo turno.
export default memo(MarkdownImpl)
