// TerminalRuntime: el pty DESACOPLADO de la conexión WebSocket, mismo patrón que
// el SessionRuntime del chat (chat/runtime.ts). Antes el pty nacía y moría dentro
// del handler de /ws/terminal: al cerrarse el socket (móvil bloqueado, cambio de
// vista, TCP medio-abierto) se hacía `term.kill()` y se perdía el proceso — y con
// él cualquier tarea larga (`claude`, un build, un dev server). Ahora:
//
// - Cada pestaña de terminal (su UUID) tiene UN runtime que POSEE el pty,
//   independiente de cualquier WS. El socket es solo transporte que se
//   suscribe/desuscribe (pty.ts). Cerrar el socket NO mata la shell.
// - El pty escribe SIEMPRE al ring buffer de salida, haya o no subscribers, para
//   que al reengancharse se pueda repintar lo perdido (`snapshot`).
// - Si el pty MUERE sin nadie mirando, el runtime se conserva (muerto) con su
//   salida final y su `exitCode` hasta que alguien lo reclame: el usuario tiene
//   que enterarse de que su proceso murió, no encontrarse una shell nueva.
// - IDENTIDAD DE RUNTIME: un `sessionId` puede tener runtimes SUCESIVOS (el botón
//   "Reiniciar shell" hace kill + attach con el MISMO id 150 ms después). Por eso
//   nada se borra del mapa "por id" a secas: se comprueba que la entrada siga
//   siendo ese runtime (`remove(id, owner)`), y un runtime descartado enmudece
//   (no emite tramas ni programa borrados) para no pisar a su sucesor.
// - Reaper de huérfanos: una sesión sin nadie mirando más de TERMINAL_ORPHAN_TTL_MS
//   se mata (evita ptys zombis para siempre). El TTL se cancela al reengancharse.
// - CERRAR MATA DE VERDAD: todo cierre (pestaña, reaper o shutdown) escala SIGHUP →
//   SIGKILL. Una `bash -l` interactiva ignora SIGTERM y, con `trap '' HUP`, ignora
//   también el SIGHUP: sin escalada sobrevivía a todo y quedaba comiendo CPU.
// - Cota de concurrencia (TERMINAL_MAX_SESSIONS): este VPS (6 vCPU) se congela por
//   saturación de CPU con varias sesiones pesadas a la vez (ver memoria del VPS).
import { spawn, type IPty } from 'node-pty';
import type { WebSocket } from 'ws';
import { env } from '../config/env.js';
import { resolveCwd } from './cwd.js';

/** Dimensiones iniciales razonables: el cliente reajusta con `fit` apenas monta. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** Cota defensiva del resize (evita valores absurdos desde el cliente). */
const MAX_DIM = 1000;

/** Cada cuánto pasa el reaper buscando sesiones huérfanas. */
const REAPER_INTERVAL_MS = 5 * 60_000;

/**
 * Margen tras el `exit` antes de tirar un runtime muerto que SUS SUBSCRIBERS YA
 * VIERON morir. Corto a propósito: solo cubre un reattach inmediato (p.ej. el
 * cliente reconectando justo en ese instante). Los muertos que nadie ha visto no
 * usan este margen: se conservan hasta que alguien los reclame (ver `onExit`).
 */
const DEAD_GRACE_MS = 30_000;

/**
 * Plazo entre el SIGHUP educado y el SIGKILL al cerrar una sesión.
 *
 * Cerrar una terminal es una acción EXPLÍCITA (el usuario cierra la pestaña, el
 * reaper recoge una huérfana o el server se apaga): si la shell ignora la señal
 * educada, se la mata. No es un caso a respetar — una `bash -l` interactiva
 * ignora SIGTERM de serie y, con un `trap '' HUP`, sobrevivía al cierre y al
 * `shutdown()`: quedaba comiendo CPU en un VPS que ya se congela por eso, fuera
 * de la cota de TERMINAL_MAX_SESSIONS y sin forma de matarla desde la app.
 *
 * 2,5 s: de sobra para una salida limpia (bash guarda su history y sale en
 * milisegundos) y lo bastante corto para no dejar el proceso ahí.
 */
const KILL_ESCALATION_MS = 2_500;

/**
 * Lo mismo pero en el apagado del server: margen mucho más corto para no retrasar
 * el cierre (index.ts hace `process.exit(0)` en cuanto `server.close` completa).
 * Como red de seguridad, `shutdown()` remata a los supervivientes en el hook
 * `process.on('exit')`, que sí llega siempre.
 */
const SHUTDOWN_ESCALATION_MS = 250;

/**
 * Shell a lanzar. Interactivo de login (`-l`): al ir conectada a un pty, la
 * shell es interactiva y, siendo de login, carga la cadena de perfiles
 * (`~/.profile` → `~/.bashrc`), por lo que los alias del usuario (p.ej.
 * `clauded`) quedan disponibles. CLAUDE.md §2/§4.
 */
function resolveShell(): string {
  return process.env.SHELL || 'bash';
}

/** Normaliza una dimensión (cols/rows) que llega del cliente. */
export function clampDim(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  if (n < 1) return null;
  return Math.min(n, MAX_DIM);
}

/** Envía una trama JSON a un socket si sigue abierto. */
function sendTo(ws: WebSocket, frame: object): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

/**
 * Desplaza `from` hacia delante hasta caer en el primer byte de un carácter UTF-8
 * (los de continuación son `10xxxxxx`). Así el recorte del ring buffer nunca parte
 * un carácter multibyte a mitad (acentos, box-drawing, emojis del prompt…).
 */
function safeCutOffset(buf: Buffer, from: number): number {
  let i = Math.min(Math.max(from, 0), buf.length);
  while (i < buf.length && ((buf[i] as number) & 0xc0) === 0x80) i += 1;
  return i;
}

/** Opciones del `attach` (todo opcional: el cliente puede no saber aún su tamaño). */
export interface AttachOptions {
  /** cwd pedido por el cliente; se ancla a FS_ROOT con `resolveCwd`. */
  cwd?: string | undefined;
  cols?: number | null;
  rows?: number | null;
}

class TerminalRuntime {
  readonly id: string;
  readonly cwd: string;

  private term: IPty | null = null;
  /** Ring buffer de salida, troceado: se recorta por el principio al pasarse de bytes. */
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private subscribers = new Set<WebSocket>();
  /** Momento del último detach (arranca el TTL de huérfano). null = hay alguien mirando. */
  private lastDetachAt: number | null = null;
  private alive = true;
  /** Código de salida del pty; null mientras vive. Viaja en el snapshot final. */
  private exitCode: number | null = null;
  /** Temporizador de borrado del runtime muerto YA visto por sus subscribers. */
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * DESCARTADO: este runtime ya no representa a su `id` (se mató la pestaña, lo
   * reclamó un `attach` o lo barrió el reaper). Un descartado no emite NADA ni
   * programa borrados: sus sockets pueden estar mirando ya a su SUCESOR (mismo
   * id, pty nuevo) y un `exit` rezagado del pty viejo mataría la pestaña nueva.
   */
  private discarded = false;
  /** true en cuanto el pty notifica su salida (el pid ya no es suyo: no señalizar). */
  private ptyExited = false;
  /** El pty al que se le mandó SIGHUP, a la espera de morir (para el SIGKILL). */
  private dyingTerm: IPty | null = null;
  /** Temporizador del SIGKILL de escalada. */
  private killTimer: ReturnType<typeof setTimeout> | null = null;

  /** Lanza el pty. Si `spawn` falla, propaga: el manager no registra el runtime. */
  constructor(id: string, cwd: string, cols: number, rows: number) {
    this.id = id;
    this.cwd = cwd;

    const term = spawn(resolveShell(), ['-l'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      // env del proceso + TERM correcto para colores/secuencias.
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    this.term = term;

    term.onData((data) => this.onData(data));
    term.onExit(({ exitCode }) => this.onExit(exitCode));
  }

  // --- Ring buffer de salida ------------------------------------------------

  /** Acumula la salida SIEMPRE (haya o no subscribers) y recorta por el principio. */
  private append(chunk: string): void {
    const buf = Buffer.from(chunk, 'utf8');
    if (buf.byteLength === 0) return;
    this.chunks.push(buf);
    this.bufferedBytes += buf.byteLength;

    const max = env.terminalScrollbackBytes;
    while (this.bufferedBytes > max) {
      const first = this.chunks[0];
      if (!first) break;
      // ¿Sigue sobrando incluso quitando el chunk entero? → fuera del todo.
      if (this.bufferedBytes - first.byteLength >= max) {
        this.chunks.shift();
        this.bufferedBytes -= first.byteLength;
        continue;
      }
      // Basta con recortar el principio de este chunk (en un límite seguro).
      const cut = safeCutOffset(first, this.bufferedBytes - max);
      if (cut <= 0) break; // defensivo: no se puede recortar más
      const rest = first.subarray(cut);
      this.bufferedBytes -= cut;
      if (rest.byteLength === 0) this.chunks.shift();
      else this.chunks[0] = rest;
    }
  }

  /** Todo lo acumulado, como string (lo que xterm repinta al reengancharse). */
  private scrollback(): string {
    if (this.chunks.length === 0) return '';
    return Buffer.concat(this.chunks).toString('utf8');
  }

  // --- Suscriptores ----------------------------------------------------------

  private broadcast(frame: object): void {
    // Un runtime descartado NO habla: sus tramas llevan el mismo `sessionId` que
    // las del sucesor y llegarían a la pestaña equivocada (CLAUDE.md §4/§3).
    if (this.discarded) return;
    const data = JSON.stringify(frame);
    for (const ws of this.subscribers) {
      if (ws.readyState === ws.OPEN) ws.send(data);
      else this.subscribers.delete(ws); // socket muerto: deja de contar como "mirando"
    }
    this.noteSubscriberLoss();
  }

  /** Si se quedó sin nadie mirando, arranca el reloj del TTL de huérfano. */
  private noteSubscriberLoss(): void {
    if (this.subscribers.size === 0 && this.lastDetachAt === null) {
      this.lastDetachAt = Date.now();
    }
  }

  /**
   * Suscribe un socket y le manda el snapshot del scrollback. El snapshot va
   * ANTES de suscribir y en el MISMO tramo síncrono: la salida del pty llega en
   * ticks posteriores, así que no se pierde ni se duplica nada.
   *
   * Devuelve `true` si el socket quedó suscrito. Si la sesión ya está MUERTA
   * devuelve `false`: se le entrega el snapshot final (con `alive:false`, el
   * `exitCode` y la última salida) y el runtime se elimina — no se revive aquí,
   * que decida el cliente si abre una pestaña nueva.
   */
  attach(ws: WebSocket, opts: AttachOptions): boolean {
    sendTo(ws, {
      type: 'snapshot',
      sessionId: this.id,
      data: this.scrollback(),
      alive: this.alive,
      exitCode: this.exitCode,
      cwd: this.cwd,
    });

    if (!this.alive) {
      // Reclamado: ya cumplió su función. Se borra del mapa POR IDENTIDAD (nunca
      // por id a secas) y se descarta, para no tocar a un posible sucesor.
      terminalRuntimeManager.remove(this.id, this);
      this.discard();
      return false;
    }

    this.subscribers.add(ws);
    this.lastDetachAt = null; // vuelve a haber alguien mirando → cancela el TTL

    const cols = clampDim(opts.cols);
    const rows = clampDim(opts.rows);
    if (cols !== null && rows !== null) this.resize(cols, rows);
    return true;
  }

  /** Desuscribe un socket. NUNCA mata el pty (ese es justo el bug que arreglamos). */
  detach(ws: WebSocket): void {
    this.subscribers.delete(ws);
    this.noteSubscriberLoss();
  }

  // --- Ciclo de vida del pty -------------------------------------------------

  private onData(chunk: string): void {
    // Coletazos del pty de un runtime ya descartado: ni se guardan ni se emiten.
    if (this.discarded) return;
    this.append(chunk);
    this.broadcast({ type: 'data', sessionId: this.id, data: chunk });
  }

  /**
   * El pty murió. El runtime NO se tira al momento: conserva su scrollback y su
   * `exitCode` para que el usuario SE ENTERE (caso real: dejas `clauded`
   * corriendo, apagas el móvil y el proceso muere — al volver debes ver que
   * murió, no una shell nueva como si nada).
   *  - Con subscribers → ya lo han visto por el `exit`: se borra tras un margen corto.
   *  - Sin subscribers → se conserva hasta que alguien lo reclame con un `attach`
   *    (y, como red de seguridad, hasta que lo barra el reaper).
   */
  private onExit(exitCode: number): void {
    this.term = null;
    // El pty ya no existe: a partir de aquí su pid puede reciclarlo el sistema,
    // así que se cancela cualquier señal pendiente (SIGKILL de escalada).
    this.ptyExited = true;
    this.dyingTerm = null;
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    // Runtime ya descartado (lo matamos nosotros en `kill`): el `exit` ya se avisó
    // ahí y el id puede ser de otro pty. Ni emitir ni programar borrados.
    if (this.discarded) return;

    this.alive = false;
    this.exitCode = exitCode;
    // `broadcast` purga de paso los sockets muertos, así que el recuento de
    // subscribers de después es fiable.
    this.broadcast({ type: 'exit', sessionId: this.id, exitCode });

    if (this.subscribers.size > 0) {
      // Borrado diferido POR IDENTIDAD (`this`), no por id: si para entonces el
      // mapa ya guarda otro runtime con este id, no se toca (era el bug crítico).
      this.graceTimer = setTimeout(
        () => terminalRuntimeManager.remove(this.id, this),
        DEAD_GRACE_MS
      );
      this.graceTimer.unref();
    }
  }

  private clearGraceTimer(): void {
    if (!this.graceTimer) return;
    clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  /**
   * Marca el runtime como descartado: cancela su borrado diferido y suelta a sus
   * subscribers (que ya pueden estar suscritos al sucesor). Idempotente. A partir
   * de aquí el runtime es mudo: nada de lo que haga su pty sale a la red.
   */
  discard(): void {
    this.discarded = true;
    this.clearGraceTimer();
    this.subscribers.clear();
  }

  isAlive(): boolean {
    return this.alive;
  }

  write(data: string): void {
    try {
      this.term?.write(data);
    } catch {
      /* el pty ya no existe */
    }
  }

  resize(cols: number, rows: number): void {
    try {
      this.term?.resize(cols, rows);
    } catch {
      /* el pty ya no existe */
    }
  }

  /**
   * Mata el pty y descarta el runtime (cierre explícito de la pestaña, reaper o
   * shutdown del proceso).
   *
   * El `exit` se avisa AQUÍ, síncrono, en vez de esperar al del pty: el `kill()`
   * manda SIGHUP y, con un hijo en primer plano que lo ignore, el `exit` real
   * puede tardar — para entonces el socket podría estar ya mirando a la pestaña
   * recreada con el mismo id ("Reiniciar shell" = kill + attach 150 ms después) y
   * la marcaría muerta. Avisar aquí y enmudecer después elimina esa carrera.
   *
   * La señal se ESCALA: SIGHUP y, si el pty sigue vivo pasado `escalateMs`,
   * SIGKILL (ver KILL_ESCALATION_MS).
   */
  kill(escalateMs: number = KILL_ESCALATION_MS): void {
    if (this.alive) {
      this.alive = false;
      // exitCode null = terminada a petición (no hubo código de salida real).
      this.broadcast({ type: 'exit', sessionId: this.id, exitCode: this.exitCode });
    }
    this.discard();

    // El pty se captura en una LOCAL y se guarda en `dyingTerm`: la escalada
    // señaliza SIEMPRE a este objeto pty, nunca a lo que haya en el mapa bajo
    // este `sessionId` (podría ser ya el pty del sucesor).
    const term = this.term;
    this.term = null;
    if (!term || this.ptyExited) return;
    this.dyingTerm = term;

    try {
      term.kill(); // SIGHUP: la vía educada
    } catch {
      /* el proceso ya no existe */
    }

    this.killTimer = setTimeout(() => {
      this.killTimer = null;
      // Guarda anti-reuso de PID: si el pty ya notificó su salida, su pid puede
      // pertenecer YA a otro proceso del sistema. `ptyExited` es de ESTA
      // instancia, que posee un único pty de por vida, así que no puede
      // confundirse con la del sucesor. (Además `onExit` cancela este timer.)
      if (this.ptyExited) return;
      console.warn(
        `[terminal] sesión ${this.id}: la shell ignoró SIGHUP tras ${escalateMs}ms — SIGKILL`
      );
      try {
        term.kill('SIGKILL');
      } catch {
        /* el proceso ya no existe */
      }
      this.dyingTerm = null;
    }, escalateMs);
    this.killTimer.unref(); // no mantiene vivo el proceso
  }

  /**
   * Último recurso, SÍNCRONO: SIGKILL al pty que ignoró el SIGHUP. Lo llama
   * `shutdown()` desde el hook `process.on('exit')`, donde solo cabe trabajo
   * síncrono y donde ya no van a dispararse temporizadores. Sin esto, apagar el
   * server dejaría vivas justo las shells que no obedecen.
   */
  forceKill(): void {
    const term = this.dyingTerm;
    this.dyingTerm = null;
    if (!term || this.ptyExited) return; // nada que matar / pid ya reciclable
    try {
      term.kill('SIGKILL');
    } catch {
      /* el proceso ya no existe */
    }
  }

  /** ¿Sin nadie mirando desde hace más del TTL? (purga antes los sockets muertos). */
  isOrphan(now: number, ttlMs: number): boolean {
    for (const ws of this.subscribers) {
      if (ws.readyState !== ws.OPEN) this.subscribers.delete(ws);
    }
    this.noteSubscriberLoss();
    if (this.subscribers.size > 0 || this.lastDetachAt === null) return false;
    return now - this.lastDetachAt > ttlMs;
  }
}

class TerminalRuntimeManager {
  private runtimes = new Map<string, TerminalRuntime>();
  private reaper: ReturnType<typeof setInterval> | null = null;
  /** Runtimes con un SIGHUP pendiente de confirmar, a rematar al salir el proceso. */
  private pendingKills: TerminalRuntime[] = [];
  private exitHookArmed = false;

  /**
   * Crea el runtime si no existe (con el cwd pedido) o reengancha al existente.
   * Devuelve `true` si el socket quedó suscrito; `false` si no (o se rechazó —
   * con su trama `error` —, o la sesión estaba muerta y solo se entregó su
   * snapshot final).
   */
  attach(ws: WebSocket, sessionId: string, opts: AttachOptions): boolean {
    const rt = this.runtimes.get(sessionId);
    if (rt) return rt.attach(ws, opts);

    // Solo cuentan las sesiones VIVAS: las muertas retenidas (a la espera de que
    // alguien vea su exitCode) no consumen CPU, así que no deben bloquear el cupo.
    const max = env.terminalMaxSessions;
    if (this.countAlive() >= max) {
      sendTo(ws, {
        type: 'error',
        sessionId,
        message:
          `Límite de ${max} sesiones de terminal simultáneas alcanzado ` +
          `(protege la CPU del VPS). Cierra alguna pestaña e inténtalo de nuevo.`,
      });
      return false;
    }

    // El cwd del cliente NUNCA se usa a ciegas: se ancla a FS_ROOT (CLAUDE.md §11).
    const cwd = resolveCwd(opts.cwd);
    const cols = clampDim(opts.cols) ?? DEFAULT_COLS;
    const rows = clampDim(opts.rows) ?? DEFAULT_ROWS;
    let fresh: TerminalRuntime;
    try {
      fresh = new TerminalRuntime(sessionId, cwd, cols, rows);
    } catch (err) {
      console.error('[terminal] no se pudo lanzar el pty:', err);
      sendTo(ws, { type: 'error', sessionId, message: 'No se pudo lanzar la shell.' });
      return false;
    }
    this.runtimes.set(sessionId, fresh);
    this.startReaper();
    return fresh.attach(ws, opts);
  }

  /** Sesiones con el pty todavía vivo (las muertas retenidas no cuentan). */
  private countAlive(): number {
    let n = 0;
    for (const rt of this.runtimes.values()) if (rt.isAlive()) n += 1;
    return n;
  }

  /** Desuscribe un socket de una sesión (si existe). No mata nada. */
  detach(ws: WebSocket, sessionId: string): void {
    this.runtimes.get(sessionId)?.detach(ws);
  }

  write(sessionId: string, data: string): void {
    this.runtimes.get(sessionId)?.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.runtimes.get(sessionId)?.resize(cols, rows);
  }

  /**
   * Cierre explícito de la pestaña: saca el runtime del mapa y mata el pty. El id
   * queda libre en el acto, así que un `attach` posterior con el mismo id abre una
   * shell nueva sin esperar al `exit` real del pty viejo (que ya no dirá nada:
   * `kill()` avisa a sus subscribers y descarta el runtime). El pty muere sí o sí:
   * SIGHUP y, si lo ignora, SIGKILL (KILL_ESCALATION_MS).
   */
  kill(sessionId: string): void {
    const rt = this.runtimes.get(sessionId);
    if (!rt) return;
    this.runtimes.delete(sessionId);
    rt.kill();
  }

  /**
   * Elimina un runtime del mapa, pero SOLO si la entrada sigue siendo ese mismo
   * runtime (`owner`). La comprobación de identidad no es opcional: el borrado
   * diferido de un runtime muerto (30 s) llegaba a borrar al SUCESOR vivo creado
   * con el mismo id — "Reiniciar shell" hace kill + attach 150 ms después — y el
   * pty nuevo quedaba fuera del mapa: la terminal seguía pintando pero dejaba de
   * aceptar input, no contaba para TERMINAL_MAX_SESSIONS, era invisible para el
   * reaper y sobrevivía a `shutdown()` (bash huérfano en el VPS).
   */
  remove(sessionId: string, owner: TerminalRuntime): void {
    if (this.runtimes.get(sessionId) !== owner) return; // ya lo sustituyó otro
    this.runtimes.delete(sessionId);
    owner.discard();
  }

  // --- Reaper de huérfanos ---------------------------------------------------

  private startReaper(): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => this.reap(), REAPER_INTERVAL_MS);
    this.reaper.unref(); // no mantiene vivo el proceso
  }

  private stopReaper(): void {
    if (!this.reaper) return;
    clearInterval(this.reaper);
    this.reaper = null;
  }

  /**
   * Barre las sesiones sin nadie mirando desde hace más del TTL. Cubre los dos
   * casos con el MISMO plazo (a propósito): las vivas (mata el pty) y las muertas
   * que nadie llegó a reclamar (libera su scrollback). Mismo TTL porque el aviso
   * de "tu proceso murió" debe sobrevivir tanto como habría sobrevivido la sesión.
   */
  private reap(): void {
    const ttl = env.terminalOrphanTtlMs;
    const now = Date.now();
    for (const [id, rt] of this.runtimes) {
      if (!rt.isOrphan(now, ttl)) continue;
      const que = rt.isAlive() ? 'se mata el pty' : 'salida final nunca reclamada';
      console.log(`[terminal] sesión ${id} sin subscribers > ${ttl}ms — ${que}`);
      this.runtimes.delete(id);
      rt.kill();
    }
    if (this.runtimes.size === 0) this.stopReaper();
  }

  /**
   * Mata todos los ptys (cierre limpio del proceso). Margen de escalada corto
   * para no retrasar el apagado, y hook `exit` como red de seguridad: si el
   * proceso sale antes de que venza el margen, los que ignoraron el SIGHUP se
   * quedarían huérfanos en el VPS.
   */
  shutdown(): void {
    this.stopReaper();
    const dying = [...this.runtimes.values()];
    this.runtimes.clear();
    for (const rt of dying) rt.kill(SHUTDOWN_ESCALATION_MS);
    if (dying.length > 0) this.armExitHook(dying);
  }

  /** Remate síncrono de los ptys rebeldes justo antes de que muera el proceso. */
  private armExitHook(dying: TerminalRuntime[]): void {
    this.pendingKills.push(...dying);
    if (this.exitHookArmed) return;
    this.exitHookArmed = true;
    process.once('exit', () => {
      for (const rt of this.pendingKills) rt.forceKill();
      this.pendingKills = [];
    });
  }
}

/** Instancia única del gestor de terminales (singleton de módulo). */
export const terminalRuntimeManager = new TerminalRuntimeManager();
