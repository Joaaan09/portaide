// TerminalPane — una instancia de xterm.js enchufada al `terminalStore` (que es
// quien tiene el ÚNICO WebSocket multiplexado a /ws/terminal). El pane sólo se
// ocupa de la terminal en sí: ciclo de vida de xterm, fit + resize, tema
// reactivo y overlay cuando el pty ha terminado.
//
// Clave de la persistencia: al desmontarse NO se mata nada. El pane da de baja
// su "sink" en el store → `detach` → el pty SIGUE VIVO en el server. Al volver,
// el `snapshot` (scrollback autoritativo) repinta la terminal entera.
//
// La política de entrada (modificadores sticky) vive en TerminalView: aquí sólo
// se reenvía lo que el usuario teclea vía `onInput`.
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { buildXtermTheme } from './xtermTheme'
import { SEQ } from './keys'
import { terminalStore, type TerminalSink } from './terminalStore'
import styles from './TerminalView.module.css'

export type { ConnStatus, TabStatus } from './terminalStore'

/** API imperativa que TerminalView usa para dirigir esta terminal. */
export interface TerminalHandle {
  /** Devuelve el foco al área de escritura (mantiene el teclado móvil abierto). */
  focus: () => void
  /** Reajusta el tamaño al contenedor y notifica el resize al pty. */
  fit: () => void
}

interface TerminalPaneProps {
  id: string
  active: boolean
  /** Cambia cuando el tema (data-theme) cambia: dispara reaplicar el tema xterm. */
  themeVersion: number
  /** false si el pty terminó (muestra el overlay con la acción de reinicio). */
  alive: boolean
  /** Código de salida del pty, si terminó. */
  exitCode: number | null
  /** El usuario tecleó en la terminal (antes de aplicar modificadores). */
  onInput: (data: string) => void
  /** Alta/baja del handle imperativo de esta pestaña en TerminalView. */
  registerHandle: (id: string, handle: TerminalHandle | null) => void
}

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const isCoarsePointer = (): boolean => window.matchMedia('(pointer: coarse)').matches

// Auto-repeat sintético del backspace. En iOS, al MANTENER pulsado el borrado del
// teclado virtual NO se emiten `keydown` repetidos (sí en escritorio y en las
// flechas), así que el borrado se queda en un solo carácter por toque. Lo suplimos:
// al primer keydown de Backspace —xterm ya ha borrado ese carácter— programamos,
// tras un retardo inicial, el reenvío de DEL a intervalos hasta soltar (`keyup`).
const BACKSPACE_INITIAL_DELAY = 400 // ms antes de arrancar la repetición (como el SO)
const BACKSPACE_REPEAT_INTERVAL = 55 // ms entre repeticiones
const BACKSPACE_MAX_REPEATS = 500 // tope de seguridad por si se pierde el `keyup`

/**
 * Engancha el auto-repeat de backspace al textarea de xterm. `sendDel` reenvía un
 * DEL al pty. Devuelve la función de limpieza. No hace nada en escritorio: allí el
 * navegador ya emite su propia repetición y duplicarla borraría al doble.
 */
function attachBackspaceRepeat(ta: HTMLTextAreaElement, sendDel: () => void): () => void {
  let delayTimer = 0
  let repeatTimer = 0
  let count = 0

  const stop = (): void => {
    if (delayTimer) {
      clearTimeout(delayTimer)
      delayTimer = 0
    }
    if (repeatTimer) {
      clearInterval(repeatTimer)
      repeatTimer = 0
    }
    count = 0
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    // Cualquier otra tecla corta una repetición de backspace en curso.
    if (e.key !== 'Backspace') {
      stop()
      return
    }
    // Repetición NATIVA del navegador (escritorio / teclado físico en móvil): no la
    // dupliques. `e.repeat` la delata; el puntero fino descarta el escritorio.
    if (e.repeat || !isCoarsePointer()) {
      stop()
      return
    }
    if (delayTimer || repeatTimer) return // este mismo hold ya la programó
    delayTimer = window.setTimeout(() => {
      delayTimer = 0
      repeatTimer = window.setInterval(() => {
        count += 1
        if (count > BACKSPACE_MAX_REPEATS) {
          stop()
          return
        }
        sendDel()
      }, BACKSPACE_REPEAT_INTERVAL)
    }, BACKSPACE_INITIAL_DELAY)
  }

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Backspace') stop()
  }

  // Capture: garantiza que recibimos el evento aunque xterm pare su propagación.
  ta.addEventListener('keydown', onKeyDown, true)
  ta.addEventListener('keyup', onKeyUp, true)
  ta.addEventListener('blur', stop)

  return () => {
    ta.removeEventListener('keydown', onKeyDown, true)
    ta.removeEventListener('keyup', onKeyUp, true)
    ta.removeEventListener('blur', stop)
    stop()
  }
}

/**
 * Firma barata de un snapshot (longitud + hash FNV-1a de la cola). Sirve para
 * NO repintar cuando el server manda exactamente lo que ya está en pantalla
 * (caso típico al volver del background: evita el parpadeo del reset).
 */
function snapshotSig(data: string): string {
  const tail = data.length > 4096 ? data.slice(-4096) : data
  let h = 0x811c9dc5
  for (let i = 0; i < tail.length; i += 1) {
    h ^= tail.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${data.length}:${(h >>> 0).toString(36)}`
}

export default function TerminalPane({
  id,
  active,
  themeVersion,
  alive,
  exitCode,
  onInput,
  registerHandle,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // Callback siempre fresco para el listener creado una sola vez.
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput
  const activeRef = useRef(active)
  activeRef.current = active

  // Firma del último snapshot pintado + si hubo escritura en vivo después.
  const appliedSigRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)

  // Fit + envío del nuevo tamaño al pty. No-op si la pestaña no está visible
  // (display:none → dimensiones 0): se reajusta al activarse.
  const fitAndResize = (): void => {
    if (!activeRef.current) return
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    // Si estábamos pegados abajo (lo normal), seguir pegados tras el reflow
    // (rotación, teclado móvil, aviso de sesión terminada). Si el usuario había
    // subido a leer historial, se respeta su posición.
    const buf = term.buffer.active
    const wasAtBottom = buf.viewportY >= buf.baseY
    try {
      fit.fit()
    } catch {
      return // el contenedor aún no es medible
    }
    if (wasAtBottom) term.scrollToBottom()
    terminalStore.sendResize(id, term.cols, term.rows)
  }
  // Ref para que los callbacks estables llamen siempre a la versión actual.
  const fitAndResizeRef = useRef(fitAndResize)
  fitAndResizeRef.current = fitAndResize

  // Handle imperativo estable (los métodos leen refs, así que no rota).
  const handleRef = useRef<TerminalHandle | null>(null)
  if (!handleRef.current) {
    handleRef.current = {
      focus: () => termRef.current?.focus(),
      fit: () => fitAndResizeRef.current(),
    }
  }

  // Sumidero estable que el store usa para pintar esta pestaña.
  const sinkRef = useRef<TerminalSink | null>(null)
  if (!sinkRef.current) {
    sinkRef.current = {
      applySnapshot: (data) => {
        const term = termRef.current
        if (!term) return
        const sig = snapshotSig(data)
        // Ya pintado y sin cambios desde entonces → nada que hacer.
        if (sig === appliedSigRef.current && !dirtyRef.current) return
        term.reset()
        term.write(data, () => term.scrollToBottom())
        appliedSigRef.current = sig
        dirtyRef.current = false
      },
      write: (data) => {
        dirtyRef.current = true
        termRef.current?.write(data)
      },
      size: () => {
        const term = termRef.current
        if (!term || term.cols <= 0 || term.rows <= 0) return null
        return { cols: term.cols, rows: term.rows }
      },
    }
  }

  // Alta/baja del handle en TerminalView (una vez por pestaña).
  useEffect(() => {
    registerHandle(id, handleRef.current)
    return () => registerHandle(id, null)
  }, [id, registerHandle])

  // --- Creación de la terminal (una vez) ---------------------------------
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      lineHeight: 1.5, // 18px de interlínea sobre 12px (DESIGN.md §2)
      cursorBlink: !prefersReducedMotion(), // el parpadeo respeta reduced-motion
      cursorStyle: 'block',
      scrollback: 5000,
      theme: buildXtermTheme(),
      allowProposedApi: false,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit
    // Terminal nueva: lo que hubiera pintado antes ya no está en pantalla.
    appliedSigRef.current = null
    dirtyRef.current = false

    // Lo que el usuario teclea → arriba (TerminalView aplica modificadores y envía).
    const dataSub = term.onData((data) => onInputRef.current(data))

    // Suple el auto-repeat del backspace que iOS no da en el teclado virtual.
    const detachBackspace = term.textarea
      ? attachBackspaceRepeat(term.textarea, () => onInputRef.current(SEQ.del))
      : undefined

    // Reajuste ante cambios de tamaño del contenedor (rotación, teclado, split).
    const ro = new ResizeObserver(() => fitAndResizeRef.current())
    ro.observe(host)

    // Primer fit tras el layout inicial.
    const raf = requestAnimationFrame(() => fitAndResizeRef.current())

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      detachBackspace?.()
      dataSub.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  // --- Alta del sink en el store: `attach` al montar, `detach` al desmontar.
  // NUNCA `kill` aquí: el pty debe sobrevivir al cambio de vista.
  useEffect(() => terminalStore.registerSink(id, sinkRef.current!), [id])

  // --- Reaplicar el tema de xterm al cambiar data-theme ------------------
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = buildXtermTheme()
  }, [themeVersion])

  // --- Al activarse la pestaña: reajustar y enfocar ----------------------
  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      fitAndResizeRef.current()
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [active])

  return (
    <div className={styles.paneInner}>
      <div
        ref={hostRef}
        className={alive ? styles.host : `${styles.host} ${styles.hostDead}`}
        role="group"
        aria-label="Terminal (pty del VPS)"
      />
      {/* Sesión terminada: aviso ANCLADO ABAJO, no overlay — la salida final que
          acaba de repintar el snapshot tiene que quedar legible (DESIGN.md §9). */}
      {!alive && (
        <div className={styles.dead} role="status">
          <span className={styles.deadMark} aria-hidden="true" />
          <span className={styles.deadText}>
            la shell terminó{exitCode === null ? '' : ` · código ${exitCode}`}
          </span>
          <button
            type="button"
            className={styles.deadAction}
            onClick={() => terminalStore.restartTab(id)}
          >
            Reiniciar shell
          </button>
        </div>
      )}
    </div>
  )
}
