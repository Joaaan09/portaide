// TerminalPane — una instancia de xterm.js puenteada con su propio WebSocket a
// /ws/terminal (un pty por pestaña). Se ocupa del ciclo de vida de la terminal
// y del socket, el fit + resize, el tema reactivo y el overlay de estado.
// La política de entrada (modificadores sticky) vive en TerminalView: aquí solo
// se reenvía lo que el usuario teclea vía `onInput`. El pane se auto-registra en
// TerminalView con un handle imperativo (send/focus/fit).
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { buildXtermTheme } from './xtermTheme'
import styles from './TerminalView.module.css'

/** Estado de la conexión de una pestaña (para el punto de estado y el overlay). */
export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error'

/** API imperativa que TerminalView usa para dirigir esta terminal. */
export interface TerminalHandle {
  /** Escribe datos crudos en el pty (input del usuario ya procesado). */
  send: (data: string) => void
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
  /** El usuario tecleó en la terminal (antes de aplicar modificadores). */
  onInput: (data: string) => void
  /** Notifica el estado de conexión hacia arriba (punto de estado en la pestaña). */
  onStatus: (status: ConnStatus) => void
  /** Alta/baja del handle imperativo de esta pestaña en TerminalView. */
  registerHandle: (id: string, handle: TerminalHandle | null) => void
}

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function terminalWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/terminal`
}

export default function TerminalPane({
  id,
  active,
  themeVersion,
  onInput,
  onStatus,
  registerHandle,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Callbacks siempre frescos para los listeners creados una sola vez.
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const activeRef = useRef(active)
  activeRef.current = active

  const [status, setStatus] = useState<ConnStatus>('connecting')
  const statusRef = useRef<ConnStatus>('connecting')
  statusRef.current = status

  // `epoch` re-crea el WebSocket (reconexión manual desde el overlay).
  const [epoch, setEpoch] = useState(0)

  const updateStatus = (next: ConnStatus): void => {
    statusRef.current = next
    setStatus(next)
  }

  // Fit + envío del nuevo tamaño al pty. No-op si la pestaña no está visible
  // (display:none → dimensiones 0): se reajusta al activarse.
  const fitAndResize = (): void => {
    if (!activeRef.current) return
    const term = termRef.current
    const fit = fitRef.current
    const ws = wsRef.current
    if (!term || !fit) return
    try {
      fit.fit()
    } catch {
      return // el contenedor aún no es medible
    }
    if (term.cols > 0 && term.rows > 0 && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
  }
  // Ref para que el handle imperativo llame siempre a la versión actual.
  const fitAndResizeRef = useRef(fitAndResize)
  fitAndResizeRef.current = fitAndResize

  // Handle imperativo estable (los métodos leen refs, así que no rota).
  const handleRef = useRef<TerminalHandle | null>(null)
  if (!handleRef.current) {
    handleRef.current = {
      send: (data) => {
        const ws = wsRef.current
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      },
      focus: () => termRef.current?.focus(),
      fit: () => fitAndResizeRef.current(),
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

    // Lo que el usuario teclea → arriba (TerminalView aplica modificadores y envía).
    const dataSub = term.onData((data) => onInputRef.current(data))

    // Reajuste ante cambios de tamaño del contenedor (rotación, split, etc.).
    const ro = new ResizeObserver(() => fitAndResizeRef.current())
    ro.observe(host)

    // Primer fit tras el layout inicial.
    const raf = requestAnimationFrame(() => fitAndResizeRef.current())

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      dataSub.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  // --- Conexión WebSocket (se re-crea al reconectar) ---------------------
  useEffect(() => {
    updateStatus('connecting')
    const ws = new WebSocket(terminalWsUrl())
    wsRef.current = ws

    ws.onopen = () => {
      updateStatus('open')
      fitAndResizeRef.current() // envía el tamaño real al pty recién abierto
      if (activeRef.current) termRef.current?.focus()
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: { type?: unknown; data?: unknown }
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'output' && typeof msg.data === 'string') {
        termRef.current?.write(msg.data)
      } else if (msg.type === 'exit') {
        updateStatus('closed') // el server cierra el socket a continuación
      }
    }

    ws.onerror = () => updateStatus('error')

    ws.onclose = () => {
      // No pisar un 'error' previo con 'closed' (el error es más informativo).
      if (statusRef.current !== 'error') updateStatus('closed')
    }

    return () => {
      // Evita callbacks sobre un socket que vamos a cerrar.
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      ws.close()
      if (wsRef.current === ws) wsRef.current = null
    }
  }, [epoch])

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

  const reconnect = (): void => {
    termRef.current?.reset()
    setEpoch((e) => e + 1)
  }

  const disconnected = status === 'closed' || status === 'error'

  return (
    <div className={styles.paneInner}>
      <div ref={hostRef} className={styles.host} role="group" aria-label="Terminal (pty del VPS)" />
      {disconnected && (
        <div className={styles.overlay} role="status">
          <p className={styles.overlayText}>
            {status === 'error' ? 'Connection error' : 'Terminal disconnected'}
          </p>
          <button type="button" className={styles.reconnect} onClick={reconnect}>
            Reconnect
          </button>
        </div>
      )}
    </div>
  )
}
