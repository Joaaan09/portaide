// Puente del chat con Claude REAL (CLAUDE.md §4, decisiones.md "Puente del Chat:
// Agent SDK"). Ejecuta UN turno de conversación con `@anthropic-ai/claude-agent-sdk`
// y mapea el stream de eventos del SDK al protocolo JSON del WS /ws/chat.
//
// Aprobaciones REALES: en permissionMode 'default' el SDK auto-permite Read y
// llama a `canUseTool` para Edit/Write/Bash → ahí pausamos, mandamos un
// `permission_request` al cliente y ESPERAMOS su `permission_decision` (una
// Promise que se resuelve cuando llega el mensaje del WS). El requestId es el
// `toolUseID`, así el cliente casa la decisión con la tarjeta exacta.
import {
  query,
  type CanUseTool,
  type EffortLevel,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

/** Modos de permiso que expone la UI (subset de PermissionMode del SDK). */
export type ChatPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/** Niveles de esfuerzo del engine (SDK `options.effort`; undefined = default). */
export type ChatEffort = EffortLevel;

/** Una opción de respuesta de `AskUserQuestion`. */
export interface ChatQuestionOption {
  label: string;
  description?: string;
}

/** Una pregunta de `AskUserQuestion` ya normalizada para la UI. */
export interface ChatQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: ChatQuestionOption[];
}

/** Mensajes server→cliente del protocolo de UI (ver ws.ts / useChatSession.ts). */
export type OutMsg =
  | { type: 'session'; sessionId: string }
  | { type: 'thinking'; delta: string }
  | { type: 'thinking_done' }
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; output?: string }
  | { type: 'permission_request'; requestId: string; toolName: string; input: unknown }
  | { type: 'question_request'; requestId: string; questions: ChatQuestion[] }
  // Resoluciones: van al LOG del hilo para que una card decidida NO vuelva a
  // pedir decisión al reattachar (recargar la PWA, volver desde otro móvil).
  // `reason` distingue la decisión del usuario de un cierre forzado: sin ella,
  // interrumpir el turno pintaba "✕ Rejected" en algo que nadie rechazó.
  | {
      type: 'permission_resolved';
      requestId: string;
      decision: 'allow' | 'deny';
      reason?: 'user' | 'interrupted';
    }
  | { type: 'question_answered'; requestId: string; answers: Record<string, string> }
  | { type: 'assistant_done' }
  | { type: 'result'; subtype: string }
  | { type: 'error'; message: string };

/** Parámetros para arrancar un turno. `cwd` ya viene validado bajo FS_ROOT. */
export interface RunTurnParams {
  /** Sumidero de eventos del turno. Lo conecta el SessionRuntime (runtime.ts):
   *  el turno YA NO escribe a un WebSocket, emite eventos y el runtime decide
   *  qué hacer con ellos (log + broadcast a los subscribers). */
  emit: (msg: OutMsg) => void;
  cwd: string;
  userText: string;
  /** claudeSessionId a reanudar (undefined = turno inicial → sesión nueva). */
  resumeSessionId?: string;
  /** Override de modelo (undefined = default del engine en ~/.claude). */
  model?: string;
  permissionMode: ChatPermissionMode;
  /** Nivel de esfuerzo (undefined = default del engine; el engine lo ignora si el modelo no lo soporta). */
  effort?: ChatEffort;
  /**
   * Activa la herramienta de workflows multiagente del SDK (modo "Ultracode").
   * Se aplica vía `options.settings.enableWorkflows` (el campo lo declara el tipo
   * `Settings` del SDK, no `Options` directamente). Ortogonal al effort.
   */
  enableWorkflows?: boolean;
  /** Se llama con el session_id del init (para reanudar el próximo turno). */
  onSession: (sessionId: string) => void;
  /** Se llama al cerrar el turno (result/error/interrupt) para liberar el slot. */
  onDone: () => void;
  /**
   * Mensajes que se inyectaron pero murieron con el turno (interrupción o
   * error) sin que el agente llegara a recogerlos. Su burbuja YA está en el
   * hilo, así que hay que decirlo: callarlo sería fingir que se entregaron.
   */
  onDropped?: (texts: string[]) => void;
}

/** Handle de un turno vivo: permite decidir permisos y cambiar cosas en caliente. */
export interface ChatTurn {
  /**
   * Inyecta un mensaje del usuario en la sesión VIVA (streaming input): el
   * agente lo recoge en su siguiente paso —a mitad de trabajo, sin cerrar la
   * query ni reanudar con `resume`—, que es como se comporta Claude Code.
   * Devuelve false si el turno ya se está cerrando (entonces va a la cola).
   */
  push: (text: string) => boolean;
  /**
   * Cierra la entrada: el agente termina cuando acabe lo que tiene. Se llama al
   * ver `result` sin nada más que mandarle (así se libera el slot y el proceso
   * `claude`, que en este VPS es lo caro).
   */
  endInput: () => void;
  interrupt: () => void;
  setModel: (model?: string) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  /** Devuelve true si el permiso seguía pendiente (false = ya resuelto/caducado). */
  resolvePermission: (
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ) => boolean;
  /** Responde un `AskUserQuestion` pendiente: `answers` = {pregunta: respuesta}. */
  resolveQuestion: (requestId: string, answers: Record<string, string>) => boolean;
}

// --- Formas mínimas para castear el stream del SDK sin acoplarnos a los tipos
// Beta internos (skipLibCheck está activo; aquí sólo leemos lo que pintamos). --
interface StreamEvent {
  type: string;
  index?: number;
  content_block?: { type?: string };
  delta?: { type?: string; text?: string; thinking?: string };
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

/** Aplana el `content` de un tool_result (string | bloques {text}) a texto plano. */
function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          const t = (part as { text?: unknown }).text;
          return typeof t === 'string' ? t : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * Canal empujable → `AsyncIterable<SDKUserMessage>`. Es lo que permite el
 * STREAMING INPUT: la query se abre con este iterable en vez de con un string,
 * así que se le pueden ir dando mensajes mientras trabaja (verificado contra el
 * SDK: el agente los recoge en su siguiente paso, y la query sigue viva tras
 * cada `result` esperando más). Cerrar el canal es lo que termina el bucle.
 */
function inputChannel(): {
  push: (msg: SDKUserMessage) => void;
  close: () => void;
  closed: () => boolean;
  /** Mensajes metidos que el CLI todavía NO ha recogido del canal. */
  pending: () => number;
  /** Vacía y devuelve lo que nunca llegó a entregarse (turno muerto). */
  drain: () => SDKUserMessage[];
  iterable: AsyncIterable<SDKUserMessage>;
} {
  const items: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let done = false;

  const wakeUp = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };

  return {
    push: (msg) => {
      if (done) return;
      items.push(msg);
      wakeUp();
    },
    close: () => {
      done = true;
      wakeUp();
    },
    closed: () => done,
    pending: () => items.length,
    drain: () => items.splice(0, items.length),
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (items.length > 0) yield items.shift() as SDKUserMessage;
          if (done) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    },
  };
}

/**
 * Envuelve texto del usuario en el mensaje que espera el SDK.
 *
 * `priority: 'now'` NO es decorativo: medido contra el CLI, un mensaje empujado
 * mientras el agente trabaja **se consume del canal y se descarta** si no lleva
 * esa prioridad (probado con `next` y sin campo: el agente terminó su tarea sin
 * enterarse). Con `now` cierra el paso en curso y lo atiende — que es justo el
 * comportamiento pedido: procesar sobre la marcha, no al final.
 */
function userMessage(text: string, live: boolean): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    ...(live ? { priority: 'now' as const } : {}),
  } as SDKUserMessage;
}

/**
 * Margen para que el CLI RECOJA del canal un mensaje recién metido antes de
 * cerrarlo. Solo cubre esa ventana (milisegundos en la práctica), no la
 * respuesta del agente: contar `result`s para eso NO vale —el CLI funde en un
 * solo turno los mensajes que llegan juntos, así que la cuenta nunca cuadraba y
 * el turno se quedaba vivo reteniendo su slot—. Se refresca con cada evento.
 */
const INPUT_GRACE_MS = 3_000;

/**
 * Margen (más largo) cuando hay una INYECCIÓN EN CALIENTE sin atender. Medido
 * contra el CLI: tras un `push` con `priority:'now'` puede haber huecos de >10 s
 * de silencio mientras corta el paso en curso y arranca el nuevo. Solo actúa
 * como red de seguridad —lo normal es que el 2º `result` levante el bloqueo y se
 * cierre por el camino rápido—, así que no retiene el slot en el caso común.
 */
const INJECTED_GRACE_MS = 20_000;

/**
 * Normaliza el input de `AskUserQuestion` a las preguntas que pinta la UI.
 * Devuelve `null` si no tiene la forma esperada (el input lo compone el MODELO:
 * si un día cambia de forma, mejor caer al Approve/Reject genérico que romper).
 */
function parseQuestions(input: unknown): ChatQuestion[] | null {
  if (!input || typeof input !== 'object') return null;
  const raw = (input as { questions?: unknown }).questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out: ChatQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const q = item as {
      question?: unknown;
      header?: unknown;
      multiSelect?: unknown;
      options?: unknown;
    };
    if (typeof q.question !== 'string' || !q.question) return null;
    if (!Array.isArray(q.options) || q.options.length === 0) return null;

    const options: ChatQuestionOption[] = [];
    for (const o of q.options) {
      if (!o || typeof o !== 'object') return null;
      const opt = o as { label?: unknown; description?: unknown };
      if (typeof opt.label !== 'string' || !opt.label) return null;
      options.push({
        label: opt.label,
        ...(typeof opt.description === 'string' && opt.description
          ? { description: opt.description }
          : {}),
      });
    }

    out.push({
      question: q.question,
      header: typeof q.header === 'string' && q.header ? q.header : 'Question',
      multiSelect: q.multiSelect === true,
      options,
    });
  }
  return out;
}

/**
 * Arranca un turno. Devuelve el handle SÍNCRONAMENTE; el bucle de eventos corre
 * en segundo plano (fire-and-forget con captura de errores). Al terminar llama a
 * `onDone`.
 */
export function runChatTurn(params: RunTurnParams): ChatTurn {
  const { emit, cwd, userText, resumeSessionId, model, permissionMode, effort, enableWorkflows } =
    params;

  const send = (msg: OutMsg): void => {
    emit(msg);
  };

  const abort = new AbortController();

  // Entrada en STREAMING: el turno nace con el primer mensaje pero el canal
  // queda ABIERTO, así que el runtime puede seguir metiéndole mensajes en
  // caliente (el agente los recoge en su siguiente paso) y encadenar los de la
  // cola sin `resume` ni relanzar el proceso `claude`.
  const input = inputChannel();
  input.push(userMessage(userText, false));

  // Cierre del canal: solo se espera a que el CLI haya RECOGIDO lo que se le
  // metió (cerrar con algo sin recoger lo dejaría sin respuesta). Una vez
  // recogido se puede cerrar sin miedo: cerrar la entrada no aborta el trabajo
  // en curso, y el agente responderá igual.
  let wantClose = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Hay un mensaje INYECTADO EN CALIENTE que el agente todavía no ha atendido.
   *
   * Medido contra el CLI (sondas del 2026-08-05): al empujar con `priority:'now'`
   * el CLI **corta el paso en curso y emite un `result`** —el del turno cortado,
   * no el del mensaje nuevo—. El runtime, al ver ese `result` con la cola vacía,
   * llamaba a `endInput()` y CERRABA el canal justo cuando el agente iba a
   * atender la inyección: en 2 de 2 pruebas el mensaje se pospuso al final de la
   * tarea o se perdió del todo (el CLI lo había recogido del canal, así que ni
   * siquiera salía por `onDropped`). Mientras este flag está puesto, `closeInput`
   * NO cierra: aplaza con `INJECTED_GRACE_MS`.
   */
  let injectedLive = false;
  /** `result`s vistos desde la última inyección (el 1º es el del corte). */
  let resultsSincePush = 0;

  const clearGrace = (): void => {
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  };

  /** (Re)arma el margen de cierre; cada señal del agente lo aplaza. */
  const refreshGrace = (): void => {
    if (!wantClose) return;
    clearGrace();
    graceTimer = setTimeout(() => {
      graceTimer = null;
      input.close();
    }, injectedLive ? INJECTED_GRACE_MS : INPUT_GRACE_MS);
    graceTimer.unref?.();
  };

  const closeInput = (): void => {
    // `pending()`: metido y aún sin recoger. `injectedLive`: recogido pero el
    // agente todavía no lo ha atendido (ver el flag). En ambos casos cerrar aquí
    // mataría el mensaje del usuario, así que se aplaza.
    if (input.pending() > 0 || injectedLive) {
      wantClose = true;
      refreshGrace();
      return;
    }
    wantClose = false;
    clearGrace();
    input.close();
  };
  // requestId (=toolUseID) → resolver de la Promise + el input original del tool.
  // Guardamos el input porque el esquema del SDK EXIGE `updatedInput` (un record)
  // en la respuesta 'allow': devolver `{behavior:'allow'}` a secas lanza un
  // ZodError ("expected record" en updatedInput) y la tool falla. Por defecto
  // devolvemos el input tal cual (verificado empíricamente).
  interface Pending {
    resolve: (result: PermissionResult) => void;
    input: Record<string, unknown>;
  }
  const pending = new Map<string, Pending>();
  // index del bloque en curso → su tipo (para saber cuándo cerrar un thinking).
  const blockTypes = new Map<number, string>();

  let activeQuery: Query | null = null;
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    clearGrace();
    input.close(); // por si el bucle acabó por error: nadie debe quedar esperando
    // Cualquier permiso/pregunta que quedara colgando se deniega (turno cerrado)
    // y se marca en el log: si no, la card se quedaría pidiendo una decisión que
    // ya no puede resolver nada.
    for (const [requestId, { resolve }] of pending) {
      resolve({ behavior: 'deny', message: 'Turno finalizado' });
      send({ type: 'permission_resolved', requestId, decision: 'deny', reason: 'interrupted' });
    }
    pending.clear();
    // Lo que se metió y el CLI nunca recogió no se ha ejecutado: se avisa.
    const lost = input.drain();
    if (lost.length > 0) {
      params.onDropped?.(
        lost.map((m) => {
          const c = (m.message as { content?: unknown }).content;
          return typeof c === 'string' ? c : '';
        })
      );
    }
    params.onDone();
  };

  // canUseTool: sólo lo invoca el SDK cuando hace falta prompt (Edit/Write/Bash
  // en 'default'; nada en 'bypassPermissions'). EXCEPCIÓN verificada contra el
  // SDK: `AskUserQuestion` SIEMPRE pasa por aquí, también en bypassPermissions
  // —preguntar no es pedir permiso, el host ES quien recoge la respuesta—.
  // Aquí bloqueamos hasta la decisión.
  const canUseTool: CanUseTool = (toolName, input, { signal, toolUseID }) =>
    new Promise<PermissionResult>((resolve) => {
      const requestId = toolUseID;
      pending.set(requestId, { resolve, input });
      // Preguntas: evento propio con las opciones ya normalizadas (la UI pinta
      // una card de selección, no un Approve/Reject que no significaría nada).
      // Si el input no tiene la forma esperada se cae al permiso genérico.
      const questions = toolName === 'AskUserQuestion' ? parseQuestions(input) : null;
      if (questions) send({ type: 'question_request', requestId, questions });
      else send({ type: 'permission_request', requestId, toolName, input });
      // Si se aborta el turno mientras esperamos, denegamos para no colgar el SDK
      // y lo REGISTRAMOS en el log: sin esto la card se quedaba pendiente para
      // siempre (al reattachar volvía a ofrecer una decisión que ya no resuelve
      // nada, porque el pending murió con el turno).
      signal.addEventListener(
        'abort',
        () => {
          if (pending.delete(requestId)) {
            resolve({ behavior: 'deny', message: 'Interrumpido' });
            send({ type: 'permission_resolved', requestId, decision: 'deny', reason: 'interrupted' });
          }
        },
        { once: true }
      );
    });

  const options: Options = {
    cwd,
    permissionMode,
    includePartialMessages: true,
    canUseTool,
    abortController: abort,
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    ...(model ? { model } : {}),
    // Si el modelo no soporta effort, el engine lo ignora (downgrade silencioso).
    ...(effort ? { effort } : {}),
    // "Ultracode": habilita los workflows multiagente. El campo vive en el tipo
    // `Settings` del SDK (no en `Options`), así que va por `options.settings`,
    // que carga solo esta clave en la capa de mayor prioridad (no pisa el resto).
    ...(enableWorkflows ? { settings: { enableWorkflows: true } } : {}),
    // bypassPermissions exige este flag explícito en el SDK.
    ...(permissionMode === 'bypassPermissions'
      ? { allowDangerouslySkipPermissions: true }
      : {}),
  };

  const mapMessage = (msg: SDKMessage): void => {
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          params.onSession(msg.session_id);
          send({ type: 'session', sessionId: msg.session_id });
        }
        return;
      }
      case 'stream_event': {
        const ev = msg.event as unknown as StreamEvent;
        if (ev.type === 'content_block_start') {
          if (typeof ev.index === 'number' && ev.content_block?.type) {
            blockTypes.set(ev.index, ev.content_block.type);
          }
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta;
          if (d?.type === 'text_delta' && typeof d.text === 'string') {
            send({ type: 'text', delta: d.text });
          } else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string') {
            send({ type: 'thinking', delta: d.thinking });
          }
          // input_json_delta: el input del tool lo tomamos del mensaje 'assistant'
          // (JSON ya completo y válido), así que aquí se ignora.
        } else if (ev.type === 'content_block_stop') {
          if (typeof ev.index === 'number' && blockTypes.get(ev.index) === 'thinking') {
            send({ type: 'thinking_done' });
          }
          if (typeof ev.index === 'number') blockTypes.delete(ev.index);
        }
        return;
      }
      case 'assistant': {
        const content = msg.message.content as unknown as ContentBlock[];
        for (const block of content) {
          if (block.type === 'tool_use' && block.id && block.name) {
            send({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
          }
          // text / thinking ya se pintaron por streaming (stream_event).
        }
        return;
      }
      case 'user': {
        const raw = (msg.message as { content?: unknown }).content;
        const blocks = Array.isArray(raw) ? (raw as ContentBlock[]) : [];
        for (const block of blocks) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            send({
              type: 'tool_result',
              id: block.tool_use_id,
              ok: block.is_error !== true,
              output: flattenContent(block.content),
            });
          }
        }
        return;
      }
      case 'result': {
        // ANTES del `send`: el runtime reacciona al `result` llamando a
        // `endInput()` de forma síncrona, así que el flag tiene que estar ya
        // actualizado cuando `closeInput` lo consulte.
        //
        // El 1er `result` tras una inyección es el del turno CORTADO (el CLI lo
        // emite al aceptar el mensaje con `priority:'now'`): ahí el mensaje aún
        // está sin atender y el canal debe seguir abierto. Del 2º en adelante el
        // agente ya ha respondido a la inyección → se libera el bloqueo y el
        // cierre vuelve al camino rápido (slot liberado en ~0,4 s).
        if (injectedLive) {
          resultsSincePush += 1;
          if (resultsSincePush >= 2) injectedLive = false;
        }
        send({ type: 'result', subtype: msg.subtype });
        return;
      }
      default:
        return;
    }
  };

  // Bucle en segundo plano.
  void (async () => {
    try {
      const q = query({ prompt: input.iterable, options });
      activeQuery = q;
      for await (const msg of q) {
        refreshGrace(); // hay señales de vida: se aplaza el cierre por inactividad
        mapMessage(msg);
        if (msg.type === 'assistant') send({ type: 'assistant_done' });
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      const message = aborted ? 'Interrumpido' : err instanceof Error ? err.message : String(err);
      send({ type: 'error', message });
    } finally {
      finish();
    }
  })();

  return {
    push: (text) => {
      if (finished || input.closed()) return false;
      input.push(userMessage(text, true));
      // Bloquea el cierre del canal hasta que el agente atienda la inyección
      // (ver `injectedLive`). Se reinicia la cuenta: si se encadenan varios
      // mensajes, manda siempre el último.
      injectedLive = true;
      resultsSincePush = 0;
      // El cierre pudo pedirse antes de este push: hay que re-armar el margen
      // con el largo, o el temporizador corto en vuelo cerraría igualmente.
      refreshGrace();
      return true;
    },
    endInput: () => {
      closeInput();
    },
    interrupt: () => {
      // Cerrar la entrada además de abortar: si el bucle estuviera esperando el
      // siguiente mensaje (query viva, agente ocioso), un abort a secas podría
      // dejarlo colgado y el turno no terminaría nunca.
      input.close();
      abort.abort();
      activeQuery?.interrupt?.().catch(() => {
        /* la query ya podía estar cerrada */
      });
    },
    setModel: (m) => {
      activeQuery?.setModel(m).catch(() => {});
    },
    setPermissionMode: (mode) => {
      activeQuery?.setPermissionMode(mode).catch(() => {});
    },
    resolvePermission: (requestId, decision, updatedInput) => {
      const entry = pending.get(requestId);
      if (!entry) return false;
      pending.delete(requestId);
      if (decision === 'allow') {
        // updatedInput SIEMPRE presente (record): el del cliente o el original.
        entry.resolve({ behavior: 'allow', updatedInput: updatedInput ?? entry.input });
      } else {
        entry.resolve({ behavior: 'deny', message: 'Rechazado por el usuario' });
      }
      send({ type: 'permission_resolved', requestId, decision, reason: 'user' });
      return true;
    },
    resolveQuestion: (requestId, answers) => {
      const entry = pending.get(requestId);
      if (!entry) return false;
      pending.delete(requestId);
      // Contrato verificado contra el SDK: se permite la tool con el MISMO input
      // más `answers` = {textoPregunta: respuesta} (varias opciones → separadas
      // por ", "). El input original lo pone el bridge, no el cliente: así una
      // trama manipulada no puede reescribir la pregunta que ejecuta la tool.
      entry.resolve({
        behavior: 'allow',
        updatedInput: { ...entry.input, answers },
      });
      send({ type: 'question_answered', requestId, answers });
      return true;
    },
  };
}
