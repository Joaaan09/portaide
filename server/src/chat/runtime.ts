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
// - Escribir mientras trabaja NO espera: el mensaje se INYECTA en la sesión viva
//   (streaming input del SDK) y el agente lo recoge en su siguiente paso, como
//   Claude Code. La cola solo guarda lo que no puede entregarse todavía (turno
//   esperando slot de concurrencia, u opciones distintas de modelo/esfuerzo).
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
  /**
   * ANCLA de proyecto: carpeta con la que se lanzó el primer turno. Una vez
   * fijada MANDA sobre el `cwd` que llegue en cada mensaje: el engine indexa sus
   * transcripts por proyecto (~/.claude/projects/<cwd>), así que mover el cwd a
   * mitad de hilo partiría el historial y el `resume`. La UI ya no deja
   * cambiarla con el hilo iniciado; esto lo garantiza también en el servidor.
   */
  private cwd: string | undefined;
  /** true mientras el ancla recién fijada no se ha persistido. */
  private cwdDirty = false;

  private queue: IncomingMessage[] = [];
  private turn: ChatTurn | null = null;
  private subscribers = new Set<WebSocket>();

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  /** Debounce del aviso "sigue trabajando" (se cancela si vuelve a haber attach). */
  private busyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Un solo aviso de "sigue trabajando" por turno (no rebuzzear al ir y venir). */
  private busyNotified = false;

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
            this.cwd = s.cwd ?? undefined;
            // 'new chat' se trata como sin título (para que el fallback pueda ponerlo).
            if (s.title && s.title !== 'new chat') this.title = s.title;
            this.closeOrphanRequests();
          }
        } catch (err) {
          // Un fallo de SQLite NO puede tumbar el proceso: esta promesa se espera
          // desde `void`s en ws.ts, y en Node 20 un rechazo sin manejar mata el
          // servidor entero —justo lo que no puede pasar en una herramienta que
          // debe seguir trabajando con el móvil apagado—. Se sigue con el hilo
          // vacío en memoria; el siguiente `persistNow` reintentará escribir.
          console.error(`[chat] no se pudo cargar la sesión ${this.id}:`, err);
        } finally {
          this.loaded = true;
        }
      })();
    }
    await this.loadingPromise;
  }

  /**
   * Cierra los permisos/preguntas que quedaron colgando en el log persistido.
   * Solo corre al RESUCITAR una sesión desde SQLite: si el proceso murió con una
   * pregunta viva (redeploy, crash), el turno que la esperaba ya no existe, así
   * que ninguna respuesta puede resolverla. Sin esto la card volvía a pintarse
   * accionable y responder era un no-op silencioso —la UI decía "✓ respondida" y
   * no había nadie escuchando—.
   */
  private closeOrphanRequests(): void {
    const open = new Set<string>();
    for (const ev of this.events) {
      if (ev.type === 'permission_request' || ev.type === 'question_request') open.add(ev.requestId);
      else if (ev.type === 'permission_resolved' || ev.type === 'question_answered') {
        open.delete(ev.requestId);
      }
    }
    for (const requestId of open) {
      // 'interrupted', no 'user': el usuario no rechazó nada, murió el proceso.
      this.events.push({
        type: 'permission_resolved',
        requestId,
        decision: 'deny',
        reason: 'interrupted',
      });
    }
    if (open.size > 0) this.schedulePersist();
  }

  hasSubscribers(): boolean {
    return this.subscribers.size > 0;
  }

  /**
   * Los mensajes en espera, para que el CLIENTE los pinte. El server es la
   * fuente de verdad también aquí: así la cola sobrevive a recargar la PWA y se
   * ve igual desde otro dispositivo (antes solo viajaba `queueLength`, un número
   * que no permitía mostrar —ni cancelar— lo que habías escrito).
   */
  private queuePreview(): Array<{ localId: string; text: string }> {
    return this.queue.map((m) => ({ localId: m.localId, text: m.text }));
  }

  private snapshotFrame(): object {
    return {
      type: 'snapshot',
      sessionId: this.id,
      events: this.events,
      status: this.status,
      claudeSessionId: this.claudeSessionId ?? null,
      // Ancla de proyecto (null = sin fijar: la conversación aún no ha arrancado).
      cwd: this.cwd ?? null,
      queueLength: this.queue.length,
      queue: this.queuePreview(),
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
    // Vuelve a haber alguien mirando: se cancela el aviso de "sigue trabajando".
    this.clearBusyTimer();
  }

  detach(ws: WebSocket): void {
    this.subscribers.delete(ws);
    this.scheduleBusyNotification();
  }

  // --- Aviso "sigue trabajando" (push) ---------------------------------------
  // El usuario se va (cierra la app, bloquea el móvil, se le cae el socket) con
  // el turno vivo → se le avisa. Con DEBOUNCE (env.pushWorkingDelayMs, ~20 s)
  // porque en móvil el socket se cae y se recupera constantemente: sin él, cada
  // microcorte de red haría vibrar el teléfono (en iOS no hay push silencioso).

  private clearBusyTimer(): void {
    if (this.busyTimer) {
      clearTimeout(this.busyTimer);
      this.busyTimer = null;
    }
  }

  /** ¿El turno está vivo (trabajando o esperando slot)? */
  private isBusy(): boolean {
    return this.status === 'running' || this.status === 'queued';
  }

  private scheduleBusyNotification(): void {
    if (this.busyTimer || this.busyNotified) return;
    if (this.subscribers.size > 0 || !this.isBusy()) return;
    this.busyTimer = setTimeout(() => {
      this.busyTimer = null;
      // Se revalida al disparar: en 20 s el usuario pudo volver o el turno acabar.
      if (this.subscribers.size > 0 || !this.isBusy()) return;
      this.busyNotified = true;
      this.manager.notifyBusyWithoutSubscribers(this.id, this.title);
    }, env.pushWorkingDelayMs);
    this.busyTimer.unref();
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
      queue: this.queuePreview(),
    });
  }

  private appendEvent(ev: LogEvent): void {
    this.events.push(ev);
    this.schedulePersist();
  }

  /** Recibe un mensaje del usuario: lo arranca o lo encola (la burbuja del usuario
   *  se registra al ARRANCAR el turno, no aquí, para que el orden del log sea
   *  correcto con la cola: user1 → assistant1 → user2 → assistant2). */
  /**
   * ¿Ya conocemos este `localId`? Se busca en los dos únicos sitios donde puede
   * estar un mensaje aceptado: el log (la burbuja del usuario se registra al
   * ARRANCAR el turno, con `id = localId`) y la cola de pendientes.
   */
  private hasMessage(localId: string): boolean {
    // Cancelado explícitamente: un reenvío at-least-once NO puede resucitarlo.
    if (this.cancelled.has(localId)) return true;
    if (this.accepted.has(localId)) return true;
    if (this.events.some((ev) => ev.type === 'user' && ev.id === localId)) return true;
    return this.queue.some((m) => m.localId === localId);
  }

  /**
   * `localId`s aceptados que TODAVÍA no están en el log. Cubre la ventana en la
   * que un turno espera slot de concurrencia (`acquireSlot`): ahí el mensaje no
   * está ni en `events` (la burbuja se registra al arrancar) ni en `queue` (esa
   * solo se usa si ya hay un turno vivo), así que sin este registro el guard de
   * idempotencia no veía nada y un reenvío arrancaba un SEGUNDO turno.
   */
  private accepted = new Set<string>();

  async enqueueMessage(msg: IncomingMessage): Promise<void> {
    await this.ensureLoaded();

    // IDEMPOTENCIA por `localId`. El cliente móvil reenvía lo que no le llegó
    // confirmado (el socket muere sin avisar y el `send` se pierde en silencio),
    // así que un mismo mensaje puede llegar dos veces: la primera se encoló pero
    // el `ack` no cruzó. Sin este guard, el reenvío ejecutaría el turno DOS veces
    // —y con `bypassPermissions` eso es trabajo real duplicado sobre el disco—.
    if (this.hasMessage(msg.localId)) return;

    // ¿Hay ya trabajo en marcha en ESTA sesión? `this.turn` NO basta: se asigna
    // después de esperar slot de concurrencia, así que entre medias parecería
    // libre y dos mensajes distintos arrancarían DOS turnos en paralelo sobre el
    // mismo `claudeSessionId` —con `bypassPermissions`, dos agentes escribiendo
    // el mismo repo a la vez—. `accepted` cubre justo esa ventana.
    const busy = this.turn !== null || this.accepted.size > 0;

    // Se marca como aceptado AQUÍ, antes de cualquier `await`: entre la
    // aceptación y la burbuja en el log hay una espera de slot en la que el
    // mensaje sería invisible para el guard (ver `accepted`).
    this.accepted.add(msg.localId);

    // CAMINO PRINCIPAL con trabajo en marcha: se le da al agente EN CALIENTE
    // (streaming input) y lo recoge en su siguiente paso, sin esperar a que
    // termine lo anterior. La burbuja entra al log en ese momento, así que el
    // hilo se ve como en Claude Code: tu mensaje aparece en medio del trabajo.
    if (this.deliverLive(msg)) return;

    if (busy) {
      // No se pudo entregar en caliente (el turno espera slot, se está cerrando,
      // o el mensaje trae otro modelo/esfuerzo): se encola y saldrá después. Se
      // reemite el status ACTUAL (no se fuerza 'running': el turno de delante
      // puede seguir esperando slot, y decir 'running' sería mentir) para que el
      // cliente reciba la cola nueva.
      this.queue.push(msg);
      this.setStatus(this.status);
      return;
    }
    void this.startTurn(msg);
  }

  /**
   * Opciones del turno vivo. Un mensaje solo puede entrar en caliente si pide lo
   * mismo: el modelo y el permiso se cambian sobre la marcha, pero el ESFUERZO y
   * los workflows se fijan al abrir la query — meter ahí un mensaje que pidió
   * 'ultracode' sería servirle otra cosa sin decírselo.
   */
  private turnOptions: Pick<IncomingMessage, 'model' | 'effort' | 'enableWorkflows'> | null = null;
  /** Modo de permiso vigente en el turno vivo (se cambia en caliente). */
  private turnPermissionMode: ChatPermissionMode | null = null;

  private compatibleWithTurn(msg: IncomingMessage): boolean {
    const o = this.turnOptions;
    return (
      o !== null &&
      o.model === msg.model &&
      o.effort === msg.effort &&
      o.enableWorkflows === msg.enableWorkflows &&
      // El PERMISO también tiene que coincidir. `setPermissionMode` es un
      // control request asíncrono al CLI: aplicarlo y empujar el mensaje sin
      // esperar podría ejecutarlo con el modo ANTERIOR —y si el anterior era
      // bypass, sería ejecutar sin permisos algo que el usuario acababa de
      // poner en Ask (CLAUDE.md §11)—. Si difiere, el mensaje espera y abre su
      // propio turno con el modo correcto.
      this.turnPermissionMode === msg.permissionMode
    );
  }

  /** Registra la burbuja del usuario en el log y la difunde (+ título fallback). */
  private commitUserBubble(msg: IncomingMessage): void {
    const userEv: LogEvent = { type: 'user', id: msg.localId, text: msg.text };
    this.appendEvent(userEv);
    // Ya vive en el log: `hasMessage` lo encontrará ahí y el registro temporal
    // deja de hacer falta (así `accepted` no crece sin límite).
    this.accepted.delete(msg.localId);
    this.broadcast({ type: 'event', sessionId: this.id, event: userEv });
    // Título de fallback por el primer mensaje (para sesiones en 2º plano).
    if (!this.title) {
      this.title = snippet(msg.text);
      this.titleDirty = true;
    }
  }

  /**
   * Entrega un mensaje al turno VIVO. false = no se pudo (sin turno, opciones
   * distintas, o el turno ya se está cerrando) y el mensaje sigue su camino
   * normal (cola / turno nuevo).
   */
  private deliverLive(msg: IncomingMessage): boolean {
    if (!this.turn || !this.compatibleWithTurn(msg)) return false;
    if (!this.turn.push(msg.text)) return false;
    this.commitUserBubble(msg);
    return true;
  }

  private async startTurn(msg: IncomingMessage): Promise<void> {
    // El proceso se está cerrando: arrancar aquí dejaría un `claude` huérfano al
    // salir (el turno se aborta pero `onTurnDone` seguía tirando de la cola).
    if (this.manager.isShuttingDown()) return;
    // Turno nuevo (también los de la cola): vuelve a poder avisarse de que trabaja.
    this.busyNotified = false;
    this.setStatus('queued'); // esperando slot de concurrencia global
    const release = await this.manager.acquireSlot();

    // Pudo pararse (stop) mientras esperábamos el slot.
    if (this.stopped) {
      this.stopped = false;
      this.accepted.delete(msg.localId); // nunca llegó a ejecutarse
      release();
      this.setStatus('idle');
      return;
    }

    // O pudo cancelarse SOLO ESTE mensaje mientras esperaba slot: se suelta el
    // slot y se sigue con la cola (a diferencia de `stop`, los demás siguen en
    // pie). Sin `onTurnDone`: no ha terminado ningún turno, y avisar por push de
    // que "terminó" algo que nunca arrancó sería mentira.
    if (this.cancelled.has(msg.localId)) {
      this.cancelled.delete(msg.localId);
      release();
      const next = this.queue.shift();
      if (next) void this.startTurn(next);
      else this.setStatus('idle');
      return;
    }

    // Burbuja del usuario al log (evento autoritativo) + broadcast, AL arrancar.
    this.commitUserBubble(msg);

    // Ancla de proyecto: el primer turno la fija; a partir de ahí el `cwd` del
    // mensaje se IGNORA (ver el campo `cwd`). Se persiste con el resto del log.
    if (!this.cwd) {
      this.cwd = msg.cwd;
      this.cwdDirty = true;
    }
    const cwd = this.cwd;

    this.setStatus('running');
    // Con qué opciones nace el turno: decide qué mensajes pueden entrar en
    // caliente después (ver `compatibleWithTurn`).
    this.turnOptions = {
      model: msg.model,
      effort: msg.effort,
      enableWorkflows: msg.enableWorkflows,
    };
    this.turnPermissionMode = msg.permissionMode;
    this.turn = runChatTurn({
      emit: (out) => this.onEmit(out),
      cwd,
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
      onDropped: (texts) => {
        // Se inyectaron pero el turno murió antes de que el agente los cogiera.
        // Su burbuja ya está en el hilo: hay que decir que no se atendieron.
        for (const text of texts) {
          this.onEmit({
            type: 'error',
            message: `Mensaje no entregado (turno interrumpido): «${snippet(text)}»`,
          });
        }
      },
      onDone: () => {
        this.turn = null;
        this.turnOptions = null;
        this.turnPermissionMode = null;
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
    // El agente terminó lo que tenía: o le damos lo siguiente por el mismo canal
    // (sin `resume` ni relanzar el CLI) o cerramos la entrada.
    if (out.type === 'result') this.feedNextOrClose();
  }

  /**
   * Tras un `result`: encadena el siguiente mensaje de la cola en la MISMA
   * query (contexto ya cargado, arranque instantáneo) o cierra la entrada para
   * que el turno acabe y libere el slot —mantener viva una sesión ociosa costaría
   * un proceso `claude` y un slot de los pocos que tiene este VPS—.
   */
  private feedNextOrClose(): void {
    const turn = this.turn;
    if (!turn) return;
    const next = this.queue[0];
    if (next && this.compatibleWithTurn(next)) {
      // Fuera de la cola ANTES de entregarlo: `deliverLive` difunde su burbuja, y
      // si el cliente aún viera ese `localId` en la cola la pintaría dos veces.
      this.queue.shift();
      if (this.deliverLive(next)) {
        this.setStatus(this.status); // la cola cambió
        return;
      }
      this.queue.unshift(next); // no se pudo: vuelve a su sitio
    }
    // Nada más, o lo siguiente pide otro modelo/esfuerzo: se cierra y `onTurnDone`
    // arrancará un turno nuevo para él.
    turn.endInput();
  }

  private stopped = false;

  private onTurnDone(): void {
    // El turno ya no está vivo: cancela el aviso pendiente de "sigue trabajando"
    // (si no, llegaría un "trabajando" JUSTO DESPUÉS del "terminó").
    this.clearBusyTimer();

    // ¿Mensajes encolados durante el turno? Procesa el siguiente.
    const next = this.queue.shift();
    if (next) {
      void this.startTurn(next);
      return;
    }
    if (this.status !== 'error') this.setStatus('idle');
    this.persistNow();
    // Turno acabado sin nadie mirando esta sesión (app en 2º plano) → push
    // ("terminó" / "falló"). Lo consume push/notifier.ts.
    if (this.subscribers.size === 0) {
      this.manager.notifyIdleWithoutSubscribers(this.id, this.title, this.status);
    }
  }

  /**
   * Lápidas: `localId`s cancelados que TODAVÍA podrían llegar otra vez. El
   * cliente reenvía at-least-once lo que no le llegó confirmado, así que sin
   * esto un mensaje cancelado podía ejecutarse igual —y con `bypassPermissions`
   * eso es trabajo real sobre el disco que el usuario dijo que NO quería—.
   * `stop` NO deja lápidas a propósito: allí la UI ofrece "Reintentar" con el
   * mismo `localId` y debe funcionar.
   */
  private cancelled = new Set<string>();

  /** Tope de lápidas (FIFO): cota de memoria; nadie reenvía algo tan viejo. */
  private static readonly MAX_CANCELLED = 200;

  private tombstone(localId: string): void {
    this.cancelled.add(localId);
    if (this.cancelled.size > SessionRuntime.MAX_CANCELLED) {
      const oldest = this.cancelled.values().next().value;
      if (oldest !== undefined) this.cancelled.delete(oldest);
    }
  }

  /**
   * Retira UN mensaje que aún no ha arrancado: de la cola, o el que está
   * ESPERANDO SLOT de concurrencia (aceptado pero todavía sin turno; con el VPS
   * saturado eso puede durar minutos, así que también tiene que ser cancelable).
   * Si ya arrancó devuelve false —para eso está `stop`— y el cliente no pierde
   * nada: su burbuja ya vive en el log. Devuelve si se canceló.
   */
  cancelQueued(localId: string): boolean {
    const idx = this.queue.findIndex((m) => m.localId === localId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      this.accepted.delete(localId);
      this.tombstone(localId);
      this.setStatus(this.status); // reemite la cola nueva a los suscriptores
      return true;
    }
    // Esperando slot: `startTurn` mira las lápidas justo después de adquirirlo.
    if (this.accepted.has(localId)) {
      this.accepted.delete(localId);
      this.tombstone(localId);
      this.setStatus(this.status);
      return true;
    }
    return false;
  }

  /** Aborta el turno vivo y vacía la cola (acción explícita del usuario). */
  stop(): void {
    // Los encolados se descartan: dejan de estar "aceptados" (si el cliente
    // reenviara uno después, es un mensaje nuevo y debe poder ejecutarse).
    for (const m of this.queue) this.accepted.delete(m.localId);
    this.queue = [];
    if (this.turn) {
      this.turn.interrupt(); // onDone → release + onTurnDone
    } else if (this.accepted.size > 0) {
      // Solo si hay un turno esperando slot (es a ese al que hay que abortar).
      // Antes se armaba SIEMPRE, y el flag se quedaba pegado: un Stop con la
      // sesión ya parada (p. ej. doble toque en ■) hacía que el SIGUIENTE
      // mensaje del usuario se descartara en silencio —con `ack` incluido, así
      // que el cliente lo daba por entregado y la burbuja se quedaba en
      // "enviando" para siempre—.
      this.stopped = true;
    }
    // La cola ya está vacía: hay que DECIRLO. Con un turno vivo lo hará
    // `onTurnDone`, pero sin él (todo esperando slot) no se emitía nada y el
    // móvil seguía pintando "⏳ En cola" con un Cancelar que ya no cancelaba
    // nada, hasta que se liberase un slot —minutos en este VPS—.
    this.setStatus(this.status);
  }

  // Cambios en caliente. Actualizan también lo que el runtime CREE del turno:
  // si no, `compatibleWithTurn` seguiría comparando contra el valor viejo y el
  // siguiente mensaje se iría a la cola (o peor, entraría en un turno que ya
  // corre con otro modelo).
  setModel(model: string | undefined): void {
    if (!this.turn) return;
    this.turn.setModel(model);
    if (this.turnOptions) this.turnOptions = { ...this.turnOptions, model };
  }

  setPermissionMode(mode: ChatPermissionMode): void {
    if (!this.turn) return;
    this.turn.setPermissionMode(mode);
    this.turnPermissionMode = mode;
  }

  resolvePermission(
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ): void {
    this.turn?.resolvePermission(requestId, decision, updatedInput);
  }

  /** Responde un `AskUserQuestion` pendiente del turno vivo. */
  resolveQuestion(requestId: string, answers: Record<string, string>): void {
    this.turn?.resolveQuestion(requestId, answers);
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
      cwd?: string;
    } = {
      thread: this.events,
      claudeSessionId: this.claudeSessionId ?? null,
    };
    // El ancla solo se escribe cuando la fijó este turno: nunca machaca la que
    // ya estaba en la fila (que es la que manda tras el primer mensaje).
    if (this.cwdDirty && this.cwd) {
      patch.cwd = this.cwd;
      this.cwdDirty = false;
    }
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

/** Firma de los hooks de notificación (los consume push/notifier.ts). */
export type IdleHook = (sessionId: string, title: string | undefined, status: TurnStatus) => void;
export type BusyHook = (sessionId: string, title: string | undefined) => void;

class RuntimeManager {
  private runtimes = new Map<string, SessionRuntime>();
  private running = 0;
  private waiters: Array<() => void> = [];
  private idleHook: IdleHook | null = null;
  private busyHook: BusyHook | null = null;

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

  /** Hook "el turno TERMINÓ y no había nadie mirando" → push "terminó"/"falló". */
  onIdleWithoutSubscribers(hook: IdleHook): void {
    this.idleHook = hook;
  }

  notifyIdleWithoutSubscribers(sessionId: string, title: string | undefined, status: TurnStatus): void {
    // Al apagar el servidor los turnos se abortan: eso NO es "terminó" (sería
    // mentirle al usuario en cada redeploy), así que no se notifica.
    if (this.shuttingDown) return;
    this.idleHook?.(sessionId, title, status);
  }

  /** Hook "el usuario se fue y el turno SIGUE vivo" (ya pasado el debounce del
   *  runtime) → push "sigue trabajando". */
  onBusyWithoutSubscribers(hook: BusyHook): void {
    this.busyHook = hook;
  }

  notifyBusyWithoutSubscribers(sessionId: string, title?: string): void {
    if (this.shuttingDown) return;
    this.busyHook?.(sessionId, title);
  }

  private shuttingDown = false;

  /** ¿El proceso se está cerrando? (nadie debe arrancar turnos nuevos). */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /** Aborta todos los turnos vivos (cierre limpio del proceso). */
  shutdown(): void {
    this.shuttingDown = true;
    for (const rt of this.runtimes.values()) rt.abort();
  }
}

/** Instancia única del gestor de runtimes (singleton de módulo). */
export const runtimeManager = new RuntimeManager();
