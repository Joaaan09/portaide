// ChatComposer — input del chat, fijo al pie de la vista (DESIGN.md §6): chip de
// contexto (el PROYECTO de la conversación: su carpeta; editable mientras el
// hilo esté vacío), textarea autoexpandible 1→4 líneas, botón ↑
// (o ■ para interrumpir mientras streamea) y un PANEL desplegable de controles
// (modelo real + permission mode con Plan + slider de esfuerzo), cableados al
// puente. El panel se colapsa para mantener el pie limpio a una mano en móvil;
// cerrado muestra un resumen (modelo · permiso · esfuerzo) en mono.
import {
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { ChatEffortSetting, ChatPermissionMode } from './types'
import styles from './ChatComposer.module.css'

/** Altura máxima del textarea: ~4 líneas de 19px + padding vertical */
const MAX_TEXTAREA_HEIGHT = 88

/** Modos de permiso expuestos en el segmented (DESIGN.md §6 / Settings §10). */
const PERMISSION_OPTIONS: { value: ChatPermissionMode; label: string; title: string }[] = [
  { value: 'default', label: 'Ask', title: 'Pregunta antes de editar o ejecutar' },
  { value: 'plan', label: 'Plan', title: 'Planifica sin tocar nada' },
  { value: 'acceptEdits', label: 'Auto-edits', title: 'Auto-aprueba ediciones de archivo' },
  { value: 'bypassPermissions', label: 'Bypass', title: 'Sin permisos (= clauded)' },
]

interface ChatComposerProps {
  onSend: (text: string) => void
  model: string
  modelOptions: { value: string; label: string }[]
  onModelChange: (value: string) => void
  permissionMode: ChatPermissionMode
  onPermissionChange: (mode: ChatPermissionMode) => void
  effort: ChatEffortSetting
  effortOptions: { value: ChatEffortSetting; label: string }[]
  onEffortChange: (effort: ChatEffortSetting) => void
  streaming: boolean
  onInterrupt: () => void
  /** Etiqueta del chip: carpeta del proyecto de la conversación (corta, mono). */
  cwdLabel: string
  /** Ruta absoluta de esa carpeta (tooltip); null mientras se resuelve. */
  cwdPath: string | null
  /**
   * Abre el selector de carpeta. Ausente = conversación ya iniciada: el chip es
   * estático (el proyecto queda congelado, ver `isChatStarted`).
   */
  onChangeCwd?: () => void
}

export default function ChatComposer({
  onSend,
  model,
  modelOptions,
  onModelChange,
  permissionMode,
  onPermissionChange,
  effort,
  effortOptions,
  onEffortChange,
  streaming,
  onInterrupt,
  cwdLabel,
  cwdPath,
  onChangeCwd,
}: ChatComposerProps) {
  const [text, setText] = useState('')
  const [controlsOpen, setControlsOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // El composer NUNCA se bloquea (DESIGN.md §6.4): escribir con un turno vivo
  // le mete el mensaje al agente EN CALIENTE (lo atiende sobre la marcha, sin
  // esperar a terminar), como en Claude Code. El botón hace una sola cosa a la
  // vez: enviar si hay texto, detener si el campo está vacío y hay trabajo.
  const canSend = text.trim().length > 0
  const showStop = streaming && !canSend

  // Etiquetas del resumen (visible con el panel cerrado)
  const modelLabel = modelOptions.find((o) => o.value === model)?.label ?? 'Por defecto'
  const permLabel = PERMISSION_OPTIONS.find((o) => o.value === permissionMode)?.label ?? 'Ask'
  const effortIndex = Math.max(
    0,
    effortOptions.findIndex((o) => o.value === effort)
  )
  const effortLabel = effortOptions[effortIndex]?.label ?? 'Auto'

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
    // `data-ptr="off"`: el composer queda fuera del pull-to-refresh de la PWA
    // (DESIGN.md §6.7). Es la zona que más se toca y no scrollea, así que un
    // arrastre hacia abajo aquí recargaba la app en mitad de una conversación.
    <form className={styles.composer} data-ptr="off" onSubmit={handleSubmit}>
      {/* Chip de contexto: el PROYECTO de esta conversación (su cwd). Mientras el
          hilo esté vacío es un botón que abre el selector de carpeta; en cuanto
          arranca queda fijo (candado) — ver DESIGN.md §6.6. */}
      <div className={styles.chips}>
        {onChangeCwd ? (
          <button
            type="button"
            className={`${styles.chip} ${styles.chipButton}`}
            onClick={onChangeCwd}
            title={cwdPath ? `Proyecto: ${cwdPath} — toca para cambiar` : 'Elegir carpeta del proyecto'}
            aria-label={`Proyecto ${cwdLabel}. Cambiar carpeta`}
          >
            <span className={styles.chipAt} aria-hidden="true">
              @
            </span>
            <span className={styles.chipName}>
              <bdi>{cwdLabel}</bdi>
            </span>
            <span className={styles.chipCaret} aria-hidden="true">
              ⌄
            </span>
          </button>
        ) : (
          <span
            className={styles.chip}
            title={
              cwdPath
                ? `Proyecto: ${cwdPath} — fijo desde el primer mensaje`
                : 'Proyecto de la conversación'
            }
          >
            <span className={styles.chipAt} aria-hidden="true">
              @
            </span>
            <span className={styles.chipName}>
              <bdi>{cwdLabel}</bdi>
            </span>
            <span className={styles.chipLock} aria-hidden="true">
              <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="2.2" y="5.2" width="7.6" height="5.3" rx="1.2" />
                <path d="M4 5.2V3.9a2 2 0 0 1 4 0v1.3" />
              </svg>
            </span>
          </span>
        )}
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
          placeholder={streaming ? 'Escribe sin esperar…' : 'Ask Claude to build, fix, refactor…'}
          aria-label="Mensaje para Claude Code"
          rows={1}
          enterKeyHint="send"
          autoComplete="off"
        />
        {showStop ? (
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

      <div className={styles.footer}>
        {/* Panel de controles: se despliega hacia arriba (composer anclado abajo) */}
        {controlsOpen && (
          <div id="composer-controls" className={styles.controls}>
            {/* Modelo real (manda set_model) */}
            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Model</span>
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
            </div>

            {/* Permission mode segmented (manda set_permission_mode) */}
            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Permissions</span>
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
                      onPointerDown={keepFocus}
                      onClick={() => onPermissionChange(opt.value)}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Slider de esfuerzo (viaja en el próximo user_message) */}
            <div className={styles.controlRow}>
              <div className={styles.controlHead}>
                <span className={styles.controlLabel}>Effort</span>
                <span className={styles.effortValue}>{effortLabel}</span>
              </div>
              <input
                type="range"
                className={styles.effortSlider}
                min={0}
                max={effortOptions.length - 1}
                step={1}
                value={effortIndex}
                onChange={(event) => {
                  const opt = effortOptions[Number(event.target.value)]
                  if (opt) onEffortChange(opt.value)
                }}
                aria-label="Nivel de esfuerzo"
                aria-valuetext={effortLabel}
              />
              {/* Ultracode: tope superior del slider; nota sobria del modo activo */}
              {effort === 'ultracode' && (
                <p className={styles.effortNote}>modo exhaustivo · multiagente · consume más</p>
              )}
            </div>
          </div>
        )}

        {/* Disparador: resumen en mono + chevron; abre/cierra el panel */}
        <button
          type="button"
          className={styles.settingsToggle}
          aria-expanded={controlsOpen}
          aria-controls="composer-controls"
          onPointerDown={keepFocus}
          onClick={() => setControlsOpen((open) => !open)}
        >
          <span className={styles.settingsIcon} aria-hidden="true">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M2 4.5h6M11 4.5h3M2 11.5h3M8 11.5h6" />
              <circle cx="9.5" cy="4.5" r="1.6" fill="var(--surface)" />
              <circle cx="6.5" cy="11.5" r="1.6" fill="var(--surface)" />
            </svg>
          </span>
          <span className={styles.summary}>
            {modelLabel}
            <span className={styles.summarySep}>·</span>
            {permLabel}
            <span className={styles.summarySep}>·</span>
            {effortLabel}
          </span>
          <span
            className={controlsOpen ? `${styles.caret} ${styles.caretOpen}` : styles.caret}
            aria-hidden="true"
          >
            ⌃
          </span>
        </button>
      </div>
    </form>
  )
}
