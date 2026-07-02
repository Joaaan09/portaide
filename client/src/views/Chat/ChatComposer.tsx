// ChatComposer — input del chat, fijo al pie de la vista (DESIGN.md §6): chip de
// contexto (carpeta del workspace), textarea autoexpandible 1→4 líneas, botón ↑
// (o ■ para interrumpir mientras streamea) y pie con SELECTOR de modelo real +
// control de permission mode (Ask / Auto-edits / Bypass), cableados al puente.
import { useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import type { ChatPermissionMode } from './types'
import styles from './ChatComposer.module.css'

/** Altura máxima del textarea: ~4 líneas de 19px + padding vertical */
const MAX_TEXTAREA_HEIGHT = 88

/** Modos de permiso expuestos en el segmented (DESIGN.md §6 / Settings §10). */
const PERMISSION_OPTIONS: { value: ChatPermissionMode; label: string; title: string }[] = [
  { value: 'default', label: 'Ask', title: 'Ask before edits' },
  { value: 'acceptEdits', label: 'Auto-edits', title: 'Auto-approve edits' },
  { value: 'bypassPermissions', label: 'Bypass', title: 'Bypass all permission checks' },
]

interface ChatComposerProps {
  onSend: (text: string) => void
  model: string
  modelOptions: { value: string; label: string }[]
  onModelChange: (value: string) => void
  permissionMode: ChatPermissionMode
  onPermissionChange: (mode: ChatPermissionMode) => void
  streaming: boolean
  onInterrupt: () => void
  /** Nombre de la carpeta de trabajo activa (chip de contexto). */
  contextLabel?: string
}

export default function ChatComposer({
  onSend,
  model,
  modelOptions,
  onModelChange,
  permissionMode,
  onPermissionChange,
  streaming,
  onInterrupt,
  contextLabel,
}: ChatComposerProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canSend = text.trim().length > 0 && !streaming

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

  // Evita que el tap en el botón robe el foco del textarea (el teclado no se cierra)
  const keepFocus = (event: PointerEvent) => event.preventDefault()

  return (
    <form className={styles.composer} onSubmit={handleSubmit}>
      {/* Chip de contexto: la carpeta de trabajo activa (cwd del turno) */}
      <div className={styles.chips}>
        <span className={styles.chip}>
          <span className={styles.chipAt}>@</span>
          {contextLabel || 'workspace'}
        </span>
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
        {streaming ? (
          <button
            type="button"
            className={styles.stop}
            aria-label="Detener respuesta"
            onPointerDown={keepFocus}
            onClick={onInterrupt}
          >
            ■
          </button>
        ) : (
          <button
            type="submit"
            className={styles.send}
            disabled={!canSend}
            aria-label="Enviar mensaje"
            onPointerDown={keepFocus}
          >
            ↑
          </button>
        )}
      </div>

      <div className={styles.meta}>
        {/* Selector de modelo real (manda set_model) */}
        <label className={styles.modelWrap}>
          <span className={styles.srOnly}>Modelo</span>
          <select
            className={styles.model}
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
          >
            {modelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {/* Permission mode segmented (manda set_permission_mode) */}
        <div className={styles.segmented} role="group" aria-label="Permission mode">
          {PERMISSION_OPTIONS.map((opt) => {
            const active = opt.value === permissionMode
            return (
              <button
                key={opt.value}
                type="button"
                className={active ? `${styles.segItem} ${styles.segActive}` : styles.segItem}
                aria-pressed={active}
                title={opt.title}
                onClick={() => onPermissionChange(opt.value)}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
    </form>
  )
}
