// ChatComposer — input del chat, fijo al pie de la vista (DESIGN.md §6):
// chips de contexto (mock), textarea autoexpandible 1→4 líneas, botón ↑
// (acento cuando hay texto) y pie con modelo + permission label.
import { useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import styles from './ChatComposer.module.css'

/** Altura máxima del textarea: ~4 líneas de 19px + padding vertical */
const MAX_TEXTAREA_HEIGHT = 88

interface ChatComposerProps {
  onSend: (text: string) => void
}

export default function ChatComposer({ onSend }: ChatComposerProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canSend = text.trim().length > 0

  // Autoexpansión: crece con el contenido hasta 4 líneas, luego scroll interno
  const resize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }

  const submit = () => {
    if (!canSend) return
    onSend(text)
    setText('')
    // Devuelve el textarea a una línea tras enviar
    const el = textareaRef.current
    if (el) el.style.height = 'auto'
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  // Enter envía (enterKeyHint="send" en móvil); Shift+Enter hace salto de línea
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  // Evita que el tap en ↑ robe el foco del textarea (el teclado móvil no se cierra)
  const keepFocus = (event: PointerEvent) => event.preventDefault()

  return (
    <form className={styles.composer} onSubmit={handleSubmit}>
      {/* Chips de contexto — mock presentacional; serán botones cuando el
          contexto sea funcional (adjuntar archivos al prompt) */}
      <div className={styles.chips} aria-hidden="true">
        <span className={styles.chip}>
          <span className={styles.chipAt}>@</span>auth.service.ts
        </span>
        <span className={styles.chipGhost}>+ context</span>
      </div>

      <div className={styles.box}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            resize()
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask Claude to build, fix, refactor…"
          aria-label="Mensaje para Claude Code"
          rows={1}
          enterKeyHint="send"
          autoComplete="off"
        />
        <button
          type="submit"
          className={styles.send}
          disabled={!canSend}
          aria-label="Enviar mensaje"
          onPointerDown={keepFocus}
        >
          ↑
        </button>
      </div>

      <div className={styles.meta}>
        <span className={styles.model}>claude-sonnet-4.5</span>
        <span className={styles.permission}>Ask before edits</span>
      </div>
    </form>
  )
}
