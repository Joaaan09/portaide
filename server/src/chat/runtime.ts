// SessionRuntime: el turno del agente DESACOPLADO de la conexión WebSocket
// (decisiones.md · "Chat en segundo plano: SessionRuntime"). Antes el query() del
// SDK nacía y moría dentro del handler de /ws/chat: al cerrar el socket (pantalla
// apagada, app en 2º plano) se abortaba el turno y se perdía el buffer. Ahora:
//
// - Cada sesión (por su UUID de pestaña) tiene UN runtime que POSEE el turno,
//   independiente de cualquier WS. El socket es solo un transporte que se
//   suscribe/desuscribe (ws.ts). Cerrar el socket NO para el turno.
// - El servidor es AUTORITATIVO del hilo, modelado como LOG DE EVENTOS (no items):
//   registra cada evento del bridge + la burbuja del usuario, lo persiste (SQLite)
//   y lo reenvía como `snapshot` al hacer `attach`. El cliente sigue siendo el
//   único que ensambla el render (evita duplicar la lógica de bloques/tool-cards).
// - Cola por sesión: escribir mientras trabaja ENCOLA (se procesa al terminar).
// - Concurrencia global acotada (env.chatMaxConcurrentTurns; 0 = sin límite): a lo
//   sumo N turnos corriendo a la vez, el resto espera slot (protege la CPU del VPS).
import type { WebSocket } from 'ws';
import { env } from '../config/env.js';
import { getSession, upsertSession } from './store.js';
import {
  runChatTurn,
  type ChatEffort,
  type ChatPermissionMode,
  type ChatTurn,
  type OutMsg,
} from './bridge.js';

/** Evento del log del hilo: los del bridge (OutMsg) + la burbuja del usuario. */
export type LogEvent = OutMsg | { type: 'user'; id: string; text: string };

/** Estado del turno de una sesión (para la UI de "trabajando / en cola"). */
export type TurnStatus = 'idle' | 'queued' | 'running' | 'error';

/** Un mensaje del usuario listo para arrancar/encolar un turno. */
export interface IncomingMessage {
  /** id local que genera el cliente (dedup del eco optimista de la burbuja). */
  localId: string;
  text: string;
  /** cwd YA validado bajo FS_ROOT (lo resuelve ws.ts). */
  cwd: string;
  model?: string;
  permissionMode: ChatPermissionMode;
  effort?: ChatEffort;
  enableWorkflows: boolean;
}

/** Debounce de persistencia del log mientras streamea (evita escribir por cada delta). */
const PERSIST_DEBOUNCE_MS = 800;

/** Título corto a partir del primer mensaje (fallback para sesiones que el cliente nunca toca). */
function snippet(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean;
}

class SessionRuntime {
  readonly id: string;
  private manager: RuntimeManager;

  private events: LogEvent[] = [];
  private status: TurnStatus = 'idle';
  private claudeSessionId: string | undefined;
  private title: string | undefined;
  /** true mientras el título lo puso el runtime (fallback) y aún no se persistió. */
  private titleDirty = false;

  private queue: IncomingMessage[] = [];
  private turn: ChatTurn | null = null;
  private subscribers = new Set<WebSocket>();

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  constructor(id: string, manager: RuntimeManager) {
    this.id = id;
    this.manager = manager;
  }

  // --- Carga perezosa del log + claudeSessionId persistidos (una sola vez) ---
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadingPromise) {
      this.loadingPromise = (async () => {
        try {
          const s = await getSession(this.id);
          if (s) {
            this.events = Array.isArray(s.thread) ? (s.thread as LogEvent[]) : [];
            this.claudeSessionId = s.claudeSessionId ?? undefined;
            // 'new chat' se trata como sin título (para que el fallback pueda ponerlo).
            if (s.title && s.title !== 'new chat') this.title = s.title;
          }
        } finally {
          this.loaded = true;
        }
      })();
    }
    await this.loadingPromise;
  }

  hasSubscribers(): boolean {
    return this.subscribers.size > 0;
  }

  private snapshotFrame(): object {
    return {
      type: 'snapshot',
      sessionId: this.id,
      events: this.events,
      status: this.status,
      claudeSessionId: this.claudeSessionId ?? null,
      queueLength: this.queue.length,
    };
  }

  /** Suscribe un socket y le manda el snapshot autoritativo del hilo. */
  async attach(ws: WebSocket): Promise<void> {
    await this.ensureLoaded();
    // Snapshot ANTES de suscribir, en el mismo tramo síncrono: como el bucle del
    // turno emite en ticks posteriores, no se cuela ningún evento entre medias
    // (ni se pierde ni se duplica).
    sendTo(ws, this.snapshotFrame());
    this.subscribers.add(ws);
  }

  detach(ws: WebSocket): void {
    this.subscribers.delete(ws);
  }

  private broadcast(frame: object): void {
    const data = JSON.stringify(frame);
    for (const ws of this.subscribers) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  private setStatus(status: TurnStatus): void {
    this.status = status;
    this.broadcast({
      type: 'status',
      sessionId: this.id,
      status,
      queueLength: this.queue.length,
    });
  }

  private appendEvent(ev: LogEvent): void {
    this.events.push(ev);
    this.schedulePersist();
  }

  /** Recibe un mensaje del usuario: lo arranca o lo encola (la burbuja del usuario
   *  se registra al ARRANCAR el turno, no aquí, para que el orden del log sea
   *  correcto con la cola: user1 → assistant1 → user2 → assistant2). */
  async enqueueMessage(msg: IncomingMessage): Promise<void> {
    await this.ensureLoaded();

    if (this.turn) {
      // Ya hay un turno vivo en ESTA sesión: se encola y se procesa al terminar.
      this.queue.push(msg);
      this.setStatus('running'); // sigue running, pero cambia queueLength
      return;
    }
    void this.startTurn(msg);
  }

  private async startTurn(msg: IncomingMessage): Promise<void> {
    this.setStatus('queued'); // esperando slot de concurrencia global
    const release = await this.manager.acquireSlot();

    // Pudo pararse (stop) mientras esperábamos el slot.
    if (this.stopped) {
      this.stopped = false;
      release();
      this.setStatus('idle');
      return;
    }

    // Burbuja del usuario al log (evento autoritativo) + broadcast, AL arrancar.
    const userEv: LogEvent = { type: 'user', id: msg.localId, text: msg.text };
    this.appendEvent(userEv);
    this.broadcast({ type: 'event', sessionId: this.id, event: userEv });

    // Título de fallback por el primer mensaje (para sesiones puramente en 2º plano).
    if (!this.title) {
      this.title = snippet(msg.text);
      this.titleDirty = true;
    }

    this.setStatus('running');
    this.turn = runChatTurn({
      emit: (out) => this.onEmit(out),
      cwd: msg.cwd,
      userText: msg.text,
      resumeSessionId: this.claudeSessionId,
      model: msg.model,
      permissionMode: msg.permissionMode,
      effort: msg.effort,
      enableWorkflows: msg.enableWorkflows,
      onSession: (sid) => {
        this.claudeSessionId = sid;
        this.schedulePersist();
      },
      onDone: () => {
        this.turn = null;
        release();
        this.onTurnDone();
      },
    });
  }

  private onEmit(out: OutMsg): void {
    // 'session' no es renderizable (lo capturamos por onSession): fuera del log.
    if (out.type !== 'session') this.appendEvent(out);
    this.broadcast({ type: 'event', sessionId: this.id, event: out });
    if (out.type === 'error') this.setStatus('error');
  }

  private stopped = false;

  private onTurnDone(): void {
    // ¿Mensajes encolados durante el turno? Procesa el siguiente.
    const next = this.queue.shift();
    if (next) {
      void this.startTurn(next);
      return;
    }
    if (this.status !== 'error') this.setStatus('idle');
    this.persistNow();
    // Turno acabado sin nadie mirando esta sesión (app en 2º plano) → hook de push
    // (lo cablea la Pieza C; aquí es no-op salvo que se registre).
    if (this.subscribers.size === 0) {
      this.manager.notifyIdleWithoutSubscribers(this.id, this.title);
    }
  }

  /** Aborta el turno vivo y vacía la cola (acción explícita del usuario). */
  stop(): void {
    this.queue = [];
    if (this.turn) {
      this.turn.interrupt(); // onDone → release + onTurnDone
    } else {
      this.stopped = true; // por si está esperando slot
    }
  }

  setModel(model: string | undefined): void {
    this.turn?.setModel(model);
  }

  setPermissionMode(mode: ChatPermissionMode): void {
    this.turn?.setPermissionMode(mode);
  }

  resolvePermission(
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ): void {
    this.turn?.resolvePermission(requestId, decision, updatedInput);
  }

  // --- Persistencia (SQLite vía store.ts) ------------------------------------

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref();
  }

  private persistNow(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const patch: {
      thread: unknown[];
      claudeSessionId: string | null;
      title?: string;
    } = {
      thread: this.events,
      claudeSessionId: this.claudeSessionId ?? null,
    };
    // El título solo lo escribe el runtime si lo puso él (fallback) y no se ha
    // persistido aún: así NUNCA machaca un rename hecho por el cliente vía PATCH.
    if (this.titleDirty && this.title) {
      patch.title = this.title;
      this.titleDirty = false;
    }
    void upsertSession(this.id, patch).catch(() => {
      /* sin persistencia: el hilo vive en memoria hasta el próximo intento */
    });
  }

  /** Aborta el turno vivo (cierre del proceso). No persiste (lo hará onDone si da tiempo). */
  abort(): void {
    this.turn?.interrupt();
  }
}

/** Envía una trama JSON a un socket si sigue abierto. */
function sendTo(ws: WebSocket, frame: object): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

class RuntimeManager {
  private runtimes = new Map<string, SessionRuntime>();
  private running = 0;
  private waiters: Array<() => void> = [];
  private idleHook: ((sessionId: string, title?: string) => void) | null = null;

  private get maxConcurrent(): number {
    return env.chatMaxConcurrentTurns;
  }

  /** Runtime de una sesión (lo crea perezosamente). */
  get(id: string): SessionRuntime {
    let rt = this.runtimes.get(id);
    if (!rt) {
      rt = new SessionRuntime(id, this);
      this.runtimes.set(id, rt);
    }
    return rt;
  }

  /**
   * Semáforo de concurrencia. Devuelve un `release`. Con maxConcurrent=0 no hay
   * límite (resuelve siempre al momento). El slot se TRANSFIERE al siguiente en
   * cola al liberar (sin decrementar), para no sobre-suscribir en carreras.
   */
  async acquireSlot(): Promise<() => void> {
    const max = this.maxConcurrent;
    if (max === 0 || this.running < max) {
      this.running += 1;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      // Slot transferido por un release: this.running ya nos cuenta.
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        next(); // transfiere el slot (running intacto)
      } else {
        this.running -= 1; // libera de verdad
      }
    };
  }

  /** Registra el hook de "turno terminado sin subscribers" (lo usa la Pieza C: push). */
  onIdleWithoutSubscribers(hook: (sessionId: string, title?: string) => void): void {
    this.idleHook = hook;
  }

  notifyIdleWithoutSubscribers(sessionId: string, title?: string): void {
    this.idleHook?.(sessionId, title);
  }

  /** Aborta todos los turnos vivos (cierre limpio del proceso). */
  shutdown(): void {
    for (const rt of this.runtimes.values()) rt.abort();
  }
}

/** Instancia única del gestor de runtimes (singleton de módulo). */
export const runtimeManager = new RuntimeManager();
