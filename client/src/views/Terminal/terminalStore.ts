// Store del Terminal (singleton a nivel de módulo). Gestiona UNA conexión
// WebSocket MULTIPLEXADA a /ws/terminal para TODAS las pestañas: cada trama
// lleva `sessionId`.
//
// Por qué un singleton fuera de React: AppShell remonta la vista con key={view},
// así que al navegar `TerminalView` se desmonta. Antes eso cerraba el socket y
// mataba el pty. Ahora el pty vive en el server y sobrevive al socket; el
// cliente sólo se **desengancha** (`detach`) y, al volver, se re-engancha
// (`attach`) y repinta con el `snapshot` (scrollback autoritativo del server).
//
// Protocolo (fijado con el backend):
//   cliente→server: attach{sessionId,cwd?,cols?,rows?} · input{sessionId,data}
//                   resize{sessionId,cols,rows} · detach{sessionId} · kill{sessionId}
//   server→cliente: snapshot{sessionId,data,alive,exitCode,cwd} · data{sessionId,data}
//                   exit{sessionId,exitCode} · error{sessionId,message}
// `kill` SÓLO al cerrar una pestaña con la ✕ (o al reiniciar un pty muerto).
//
// REGLA DURA (ADR): una pestaña cuyo pty murió NO se revive sola. Un `attach` con
// un sessionId que el server ya descartó abre una shell NUEVA, así que sólo se
// hace `attach` de pestañas con `alive: true`; a las muertas las revive el usuario
// desde la vista (`restartTab`).

/** Estado del socket /ws/terminal (uno para todas las pestañas). */
export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error'

/**
 * Estado del punto de una pestaña. Añade `dead` al del socket: el pty terminó
 * (la sesión murió), que NO es lo mismo que estar sin conexión — y se distingue
 * en la tira de pestañas (DESIGN.md §9).
 */
export type TabStatus = ConnStatus | 'dead'

/** Pestaña de terminal: meta persistida ({id,title}) + estado vivo del pty. */
export interface TermTabState {
  id: string
  title: string
  /** false cuando el server informó `exit` (el pty murió). */
  alive: boolean
  /** Código de salida del pty, si terminó. */
  exitCode: number | null
  /** cwd real del pty (lo informa el `snapshot`). */
  cwd: string | null
  /** Último `error` del server para esta sesión. */
  error: string | null
}

/** Foto inmutable que consume la vista (useSyncExternalStore). */
export interface TerminalSnapshot {
  tabs: TermTabState[]
  activeId: string
  conn: ConnStatus
}

/**
 * Salida de una pestaña hacia su xterm. La instancia de xterm sigue viviendo en
 * `TerminalPane` (React); el store sólo le entrega datos y le pide su tamaño.
 */
export interface TerminalSink {
  /** Repinta la terminal con el scrollback autoritativo del server. */
  applySnapshot: (data: string) => void
  /** Escribe datos en vivo. */
  write: (data: string) => void
  /** Tamaño actual en celdas, o null si aún no es medible (pestaña oculta). */
  size: () => { cols: number; rows: number } | null
}

// --- Constantes ------------------------------------------------------------

const LS_TABS = 'portaide:terminal:tabs'
const LS_ACTIVE = 'portaide:terminal:active'
/** Misma clave que WorkspaceProvider: da un cwd síncrono en arranque en frío. */
const LS_WORKSPACE = 'portaide:workspace'

const RECONNECT_MIN_MS = 500
const RECONNECT_MAX_MS = 15_000
/** Tras N intentos fallidos el indicador pasa de "reconnecting" a "disconnected". */
const DOWN_AFTER_ATTEMPTS = 3
/** Silencio máximo tolerado al volver del background antes de dar el socket por zombi. */
const STALE_MS = 20_000
/** Un socket que no llega a abrir en este tiempo se descarta (móvil en mala red). */
const OPEN_TIMEOUT_MS = 12_000
/**
 * Si el usuario escribe y el pty no devuelve NADA en este tiempo, el socket es
 * SOSPECHOSO (no culpable: hay prompts sin eco). Dispara un probe, no un corte.
 */
const ECHO_TIMEOUT_MS = 8_000
/** Espera de la respuesta del probe (`attach` → `snapshot`) antes de dar el socket por zombi. */
const PROBE_TIMEOUT_MS = 6_000
/** Suelo entre reconexiones forzadas (evita bucles al alternar foreground). */
const MANUAL_GAP_MS = 800

// --- localStorage (tolerante a modo privado / cuota) -----------------------

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* sin storage: las pestañas viven sólo en memoria */
  }
}

/** id de sesión: UUID (compartido con el server) con fallback razonable. */
function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* crypto no disponible */
  }
  return `t${Date.now().toString(36)}${Math.random().toString(16).slice(2, 10)}`
}

function terminalWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/terminal`
}

function freshTab(title: string): TermTabState {
  return { id: newSessionId(), title, alive: true, exitCode: null, cwd: null, error: null }
}

/** Rehidrata las pestañas persistidas (sólo {id,title}); si no hay, crea una. */
function readStoredTabs(): TermTabState[] {
  const raw = lsGet(LS_TABS)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const tabs = parsed
          .filter(
            (t): t is { id: string; title: string } =>
              !!t &&
              typeof t === 'object' &&
              typeof (t as { id?: unknown }).id === 'string' &&
              typeof (t as { title?: unknown }).title === 'string'
          )
          .map((t) => ({ ...freshTab(t.title), id: t.id }))
        if (tabs.length > 0) return tabs
      }
    } catch {
      /* json corrupto: se empieza de cero */
    }
  }
  return [freshTab('shell')]
}

function initialState(): TerminalSnapshot {
  const tabs = readStoredTabs()
  const stored = lsGet(LS_ACTIVE)
  const activeId = stored && tabs.some((t) => t.id === stored) ? stored : tabs[0]!.id
  // 'connecting' de salida: el store conecta en cuanto la vista se suscribe, y
  // arrancar en 'disconnected' pintaría un parpadeo rojo en el primer frame.
  return { tabs, activeId, conn: 'connecting' }
}

/** Título de la próxima pestaña: `shell`, `shell 2`, `shell 3`… */
function nextTitle(tabs: TermTabState[]): string {
  let max = 0
  for (const t of tabs) {
    const m = /^shell(?:\s+(\d+))?$/.exec(t.title)
    if (m) max = Math.max(max, m[1] ? Number(m[1]) : 1)
  }
  return max === 0 ? 'shell' : `shell ${max + 1}`
}

/**
 * Estado del punto de una pestaña: el pty muerto manda sobre el socket; si el
 * pty vive, el punto refleja la conexión.
 */
export function tabStatus(tab: TermTabState, conn: ConnStatus): TabStatus {
  if (!tab.alive) return 'dead'
  if (tab.error) return 'error'
  return conn
}

// --- El store --------------------------------------------------------------

class TerminalStore {
  private state: TerminalSnapshot = initialState()
  private listeners = new Set<() => void>()

  /** Panes montados (id → sumidero xterm). Sin sink no se hace `attach`. */
  private sinks = new Map<string, TerminalSink>()
  /** Sesiones con `attach` vivo en ESTE socket (se vacía al reconectar). */
  private attached = new Set<string>()
  /** Sesiones en pleno reinicio: su `exit` es el del pty que acabamos de matar. */
  private restarting = new Set<string>()

  private ws: WebSocket | null = null
  private started = false
  private attempts = 0
  private reconnectTimer: number | null = null
  private openTimer: number | null = null
  private echoTimer: number | null = null
  private probeTimer: number | null = null
  private lastFrameAt = 0
  private lastConnectAt = 0
  /** cwd para los `attach` (workspace activo). Arranca del que persiste Workspace. */
  private cwd: string | null = lsGet(LS_WORKSPACE)

  // ---- Suscripción (useSyncExternalStore) --------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.init()
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): TerminalSnapshot => this.state

  private emit(): void {
    for (const l of this.listeners) l()
  }

  private setState(patch: Partial<TerminalSnapshot>): void {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  private patchTab(id: string, patch: Partial<TermTabState>): void {
    if (!this.state.tabs.some((t) => t.id === id)) return
    this.setState({ tabs: this.state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  }

  /** Persiste sólo la meta (id + título); lo demás es estado vivo del server. */
  private persistTabs(): void {
    lsSet(LS_TABS, JSON.stringify(this.state.tabs.map((t) => ({ id: t.id, title: t.title }))))
  }

  // ---- Arranque ----------------------------------------------------------

  private init(): void {
    if (this.started) return
    this.started = true
    this.installWakeListeners()
    this.connect()
  }

  /**
   * El móvil suspende la pestaña al bloquear la pantalla: al volver hay que
   * comprobar el socket. NO se quitan nunca (el store es un singleton).
   */
  private installWakeListeners(): void {
    document.addEventListener('visibilitychange', this.onWake)
    window.addEventListener('online', this.onWake)
    window.addEventListener('pageshow', this.onWake)
    window.addEventListener('offline', this.onOffline)
  }

  private onWake = (): void => {
    if (document.visibilityState === 'hidden') return
    this.ensureFresh()
  }

  private onOffline = (): void => {
    // Sin red el socket queda colgado: tirarlo ya evita esperar al timeout de TCP.
    if (this.ws) this.handleDown(this.ws)
  }

  /**
   * Comprueba que el socket sirve de verdad. En móvil queda ZOMBI: `readyState`
   * sigue OPEN aunque el socket esté muerto, así que además del estado se mira
   * cuánto lleva mudo (`lastFrameAt`).
   */
  private ensureFresh(): void {
    const ws = this.ws
    if (!ws) {
      this.reconnectNow()
      return
    }
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      this.handleDown(ws)
      this.reconnectNow()
      return
    }
    if (ws.readyState === WebSocket.OPEN && Date.now() - this.lastFrameAt > STALE_MS) {
      this.handleDown(ws)
      this.reconnectNow()
    }
    // CONNECTING: lo cubre `openTimer`.
  }

  // ---- WebSocket ---------------------------------------------------------

  private connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    this.lastConnectAt = Date.now()
    this.setState({ conn: 'connecting' })

    const ws = new WebSocket(terminalWsUrl())
    this.ws = ws

    this.clearOpenTimer()
    this.openTimer = window.setTimeout(() => {
      this.openTimer = null
      if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) this.handleDown(ws)
    }, OPEN_TIMEOUT_MS)

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.clearOpenTimer()
      this.attempts = 0
      this.lastFrameAt = Date.now()
      this.attached.clear() // socket nuevo → el server no sabe nada de nosotros
      this.setState({ conn: 'open' })
      this.attachAll()
    }

    ws.onmessage = (e) => {
      if (this.ws !== ws) return
      this.lastFrameAt = Date.now()
      if (typeof e.data !== 'string') return
      try {
        this.handleFrame(JSON.parse(e.data) as Record<string, unknown>)
      } catch {
        /* trama no-JSON: se ignora */
      }
    }

    ws.onerror = () => {
      if (this.ws === ws) this.handleDown(ws)
    }

    ws.onclose = () => {
      if (this.ws === ws) this.handleDown(ws)
    }
  }

  /** Da el socket por perdido: lo desmonta, marca estado y programa reintento. */
  private handleDown(ws: WebSocket): void {
    if (this.ws !== ws) return
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
    try {
      ws.close()
    } catch {
      /* ya estaba cerrándose */
    }
    this.ws = null
    this.attached.clear()
    this.clearOpenTimer()
    this.clearEchoTimer()
    this.clearProbeTimer()
    this.scheduleReconnect()
    // Un corte breve se anuncia como "reconectando"; sólo tras varios intentos
    // fallidos se le dice al usuario que está desconectado.
    this.setState({ conn: this.attempts >= DOWN_AFTER_ATTEMPTS ? 'closed' : 'connecting' })
  }

  /** Backoff exponencial con jitter: 500ms → 15s máx. */
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.attempts)
    this.attempts = Math.min(this.attempts + 1, 16)
    const delay = Math.round(base * (0.5 + Math.random() * 0.5)) // jitter ±50%
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private clearOpenTimer(): void {
    if (this.openTimer === null) return
    window.clearTimeout(this.openTimer)
    this.openTimer = null
  }

  private clearEchoTimer(): void {
    if (this.echoTimer === null) return
    window.clearTimeout(this.echoTimer)
    this.echoTimer = null
  }

  private clearProbeTimer(): void {
    if (this.probeTimer === null) return
    window.clearTimeout(this.probeTimer)
    this.probeTimer = null
  }

  /** Reconecta YA (volver del background, botón Reconnect, input sin socket). */
  reconnectNow = (): void => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    if (Date.now() - this.lastConnectAt < MANUAL_GAP_MS && this.ws) return
    this.clearReconnectTimer()
    this.attempts = 0
    this.connect()
  }

  /** Envía una trama; false si el socket no está listo (no se encola input). */
  private send(frame: Record<string, unknown>): boolean {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    try {
      ws.send(JSON.stringify(frame))
      return true
    } catch {
      return false
    }
  }

  // ---- attach / detach ---------------------------------------------------

  private attach(id: string): void {
    if (this.attached.has(id)) return
    // Pestaña con el pty MUERTO: no se re-engancha. El server retiene la sesión
    // muerta un rato y luego la descarta, así que un `attach` posterior (una
    // reconexión, remontar el pane) le abriría una shell NUEVA: el aviso "la
    // shell terminó · código N" desaparecería solo y se consumiría un slot sin
    // que el usuario lo haya pedido. Sólo `restartTab` la revive (ADR).
    if (this.state.tabs.some((t) => t.id === id && !t.alive)) return
    const size = this.sinks.get(id)?.size() ?? null
    const ok = this.send({
      type: 'attach',
      sessionId: id,
      ...(this.cwd ? { cwd: this.cwd } : {}),
      ...(size ? { cols: size.cols, rows: size.rows } : {}),
    })
    if (ok) this.attached.add(id)
  }

  /** Desengancha SIN matar el proceso (desmontar la vista no cierra la shell). */
  private detach(id: string): void {
    if (!this.attached.delete(id)) return
    this.send({ type: 'detach', sessionId: id })
  }

  /**
   * (Re)engancha las pestañas VIVAS con pane montado → snapshot de cada una. Las
   * muertas se quedan como están (ver la regla del `attach`).
   */
  private attachAll(): void {
    for (const id of this.sinks.keys()) this.attach(id)
  }

  // ---- Frames server→cliente ---------------------------------------------

  private handleFrame(frame: Record<string, unknown>): void {
    const id = typeof frame.sessionId === 'string' ? frame.sessionId : ''
    if (!id) return
    const sink = this.sinks.get(id)

    switch (frame.type) {
      case 'snapshot': {
        const alive = frame.alive !== false
        this.restarting.delete(id) // el reinicio (si lo había) ya se resolvió
        // Snapshot final (alive:false): el server ENTREGA la salida final y
        // DESCARTA la sesión, así que este socket ya no está suscrito a nada.
        // Un `attach` posterior con el mismo id abrirá una shell nueva.
        if (!alive) this.attached.delete(id)
        this.patchTab(id, {
          alive,
          exitCode: typeof frame.exitCode === 'number' ? frame.exitCode : null,
          cwd: typeof frame.cwd === 'string' ? frame.cwd : null,
          error: null,
        })
        if (sink) {
          sink.applySnapshot(typeof frame.data === 'string' ? frame.data : '')
          // El pty pudo crearse con un tamaño por defecto: fija el real.
          if (alive) this.pushSize(id)
        }
        return
      }
      case 'data': {
        if (sink && typeof frame.data === 'string') sink.write(frame.data)
        return
      }
      case 'exit': {
        // Ignora el `exit` del pty que acabamos de matar para reiniciar la
        // pestaña (llega después del kill y marcaría la sesión nueva como muerta).
        if (this.restarting.has(id)) return
        const code = typeof frame.exitCode === 'number' ? frame.exitCode : null
        this.attached.delete(id)
        this.patchTab(id, { alive: false, exitCode: code })
        return
      }
      case 'error': {
        const message = typeof frame.message === 'string' ? frame.message : 'terminal error'
        const prev = this.state.tabs.find((t) => t.id === id)?.error
        this.restarting.delete(id)
        this.patchTab(id, { error: message })
        // Se pinta en la propia terminal (SGR rojo = --red vía xtermTheme) para
        // que el error sea visible; sin repetir si es el mismo de antes.
        if (sink && prev !== message) sink.write(`\r\n\x1b[31m⚠ ${message}\x1b[0m\r\n`)
        return
      }
      default:
        return
    }
  }

  // ---- API para los panes -------------------------------------------------

  /**
   * Alta del sumidero de una pestaña (la monta `TerminalPane`) → `attach`.
   * La baja hace `detach`, NUNCA `kill`: el pty sigue vivo en el server.
   */
  registerSink = (id: string, sink: TerminalSink): (() => void) => {
    this.sinks.set(id, sink)
    this.attach(id)
    return () => {
      if (this.sinks.get(id) === sink) this.sinks.delete(id)
      this.detach(id)
    }
  }

  /** Entrada del usuario (ya con los modificadores aplicados por la vista). */
  sendInput = (id: string, data: string): void => {
    if (!this.send({ type: 'input', sessionId: id, data })) {
      // Sin socket no se encola: reenviar teclas viejas tras reconectar es peor
      // que perderlas (se ejecutarían fuera de contexto). Se intenta reconectar.
      this.reconnectNow()
      return
    }
    this.armEchoWatchdog(id)
  }

  /**
   * El usuario escribió y no volvió NADA. Eso NO condena al socket: un prompt sin
   * eco es de lo más normal (`sudo`, `ssh`, `read -s`) y cortar ahí es caro — las
   * teclas pulsadas durante la reconexión se pierden, justo mientras tecleas una
   * contraseña. Así que la falta de eco sólo abre SOSPECHA: se lanza un probe
   * (`attach`, la única trama que el server contesta SIEMPRE, con `snapshot`) y
   * sólo si tampoco responde se da el socket por zombi. Prioridad: no cortar en
   * falso, aunque se tarde un poco más en detectar el corte real.
   */
  private armEchoWatchdog(id: string): void {
    if (this.echoTimer !== null || this.probeTimer !== null) return
    const sentAt = Date.now()
    this.echoTimer = window.setTimeout(() => {
      this.echoTimer = null
      if (this.lastFrameAt >= sentAt) return // hubo respuesta: el socket vive
      this.probeSocket(id)
    }, ECHO_TIMEOUT_MS)
  }

  /**
   * Pregunta al server si el socket sigue vivo. El `attach` devuelve `snapshot`
   * en el mismo tramo síncrono; el pane lo descarta si nada cambió (firma del
   * scrollback), así que el probe suele ser gratis. Sin respuesta en
   * PROBE_TIMEOUT_MS: zombi de verdad → reconexión.
   */
  private probeSocket(id: string): void {
    if (this.probeTimer !== null) return
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.reconnectNow()
      return
    }
    // Nunca se sondea con una pestaña muerta (su `attach` abriría shell nueva):
    // se usa otra viva con pane montado y, si no hay ninguna, no se sondea — y
    // por tanto tampoco se corta.
    const target = this.state.tabs.some((t) => t.id === id && t.alive)
      ? id
      : this.state.tabs.find((t) => t.alive && this.sinks.has(t.id))?.id
    if (!target) return
    const size = this.sinks.get(target)?.size() ?? null
    const sent = this.send({
      type: 'attach',
      sessionId: target,
      ...(this.cwd ? { cwd: this.cwd } : {}),
      ...(size ? { cols: size.cols, rows: size.rows } : {}),
    })
    if (!sent) {
      this.handleDown(ws)
      this.reconnectNow()
      return
    }
    this.attached.add(target)
    const mark = this.lastFrameAt
    this.probeTimer = window.setTimeout(() => {
      this.probeTimer = null
      if (this.lastFrameAt !== mark) return // el server contestó: el socket vive
      if (this.ws !== ws) return // ya se reemplazó por otra vía
      this.handleDown(ws)
      this.reconnectNow()
    }, PROBE_TIMEOUT_MS)
  }

  /** Notifica el tamaño de una pestaña al pty (tras un fit). */
  sendResize = (id: string, cols: number, rows: number): void => {
    if (cols <= 0 || rows <= 0) return
    if (!this.attached.has(id)) return
    this.send({ type: 'resize', sessionId: id, cols, rows })
  }

  /** Reenvía el tamaño actual leyéndolo del sink. */
  private pushSize(id: string): void {
    const size = this.sinks.get(id)?.size()
    if (size) this.sendResize(id, size.cols, size.rows)
  }

  // ---- API de la vista ----------------------------------------------------

  /** cwd de los próximos `attach` (workspace activo; no afecta a ptys ya vivos). */
  setCwd = (cwd: string | null): void => {
    this.cwd = cwd
  }

  selectTab = (id: string): void => {
    if (this.state.activeId === id) return
    this.setState({ activeId: id })
    lsSet(LS_ACTIVE, id)
  }

  addTab = (): void => {
    const tab = freshTab(nextTitle(this.state.tabs))
    this.setState({ tabs: [...this.state.tabs, tab], activeId: tab.id })
    this.persistTabs()
    lsSet(LS_ACTIVE, tab.id)
    // El `attach` lo dispara el pane al montarse (registerSink).
  }

  /** Cierra la pestaña: esto SÍ mata el pty (única vía junto a `restartTab`). */
  closeTab = (id: string): void => {
    const idx = this.state.tabs.findIndex((t) => t.id === id)
    if (idx === -1 || this.state.tabs.length <= 1) return // siempre queda una

    this.send({ type: 'kill', sessionId: id })
    this.attached.delete(id)
    this.sinks.delete(id)

    const tabs = this.state.tabs.filter((t) => t.id !== id)
    const activeId =
      this.state.activeId === id ? tabs[Math.max(0, idx - 1)]!.id : this.state.activeId
    this.setState({ tabs, activeId })
    this.persistTabs()
    lsSet(LS_ACTIVE, activeId)
  }

  /**
   * Revive una pestaña cuyo pty terminó: un `attach` con el MISMO sessionId
   * arranca una shell nueva y limpia. Va precedido de un `kill` porque la
   * sesión muerta puede seguir retenida en el server (margen tras el `exit`):
   * sin el `kill` el server volvería a entregar el snapshot final en vez de
   * abrir shell. Sobre una sesión ya descartada el `kill` es un no-op.
   */
  restartTab = (id: string): void => {
    if (!this.state.tabs.some((t) => t.id === id)) return
    this.restarting.add(id)
    this.send({ type: 'kill', sessionId: id })
    this.attached.delete(id)
    this.patchTab(id, { alive: true, exitCode: null, error: null })
    // Pequeño respiro para que el server descarte la sesión antes de recrearla.
    window.setTimeout(() => {
      if (this.sinks.has(id)) this.attach(id)
      // Red de seguridad: si el attach no prospera, no quedarse sordo a los `exit`.
      window.setTimeout(() => this.restarting.delete(id), 3_000)
    }, 150)
  }
}

/** Instancia única compartida por toda la app (sobrevive al remontaje de la vista). */
export const terminalStore = new TerminalStore()
