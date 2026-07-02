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
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { WebSocket } from 'ws';

/** Modos de permiso que expone la UI (subset de PermissionMode del SDK). */
export type ChatPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/** Mensajes server→cliente del protocolo de UI (ver ws.ts / useChatSession.ts). */
type OutMsg =
  | { type: 'session'; sessionId: string }
  | { type: 'thinking'; delta: string }
  | { type: 'thinking_done' }
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; output?: string }
  | { type: 'permission_request'; requestId: string; toolName: string; input: unknown }
  | { type: 'assistant_done' }
  | { type: 'result'; subtype: string }
  | { type: 'error'; message: string };

/** Parámetros para arrancar un turno. `cwd` ya viene validado bajo FS_ROOT. */
export interface RunTurnParams {
  ws: WebSocket;
  cwd: string;
  userText: string;
  /** claudeSessionId a reanudar (undefined = turno inicial → sesión nueva). */
  resumeSessionId?: string;
  /** Override de modelo (undefined = default del engine en ~/.claude). */
  model?: string;
  permissionMode: ChatPermissionMode;
  /** Se llama con el session_id del init (para reanudar el próximo turno). */
  onSession: (sessionId: string) => void;
  /** Se llama al cerrar el turno (result/error/interrupt) para liberar el slot. */
  onDone: () => void;
}

/** Handle de un turno vivo: permite decidir permisos y cambiar cosas en caliente. */
export interface ChatTurn {
  interrupt: () => void;
  setModel: (model?: string) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  resolvePermission: (
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ) => void;
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
 * Arranca un turno. Devuelve el handle SÍNCRONAMENTE; el bucle de eventos corre
 * en segundo plano (fire-and-forget con captura de errores). Al terminar llama a
 * `onDone`.
 */
export function runChatTurn(params: RunTurnParams): ChatTurn {
  const { ws, cwd, userText, resumeSessionId, model, permissionMode } = params;

  const send = (msg: OutMsg): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const abort = new AbortController();
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
    // Cualquier permiso que quedara colgando se deniega (turno cerrado).
    for (const { resolve } of pending.values()) {
      resolve({ behavior: 'deny', message: 'Turno finalizado' });
    }
    pending.clear();
    params.onDone();
  };

  // canUseTool: sólo lo invoca el SDK cuando hace falta prompt (Edit/Write/Bash
  // en 'default'; nada en 'bypassPermissions'). Aquí bloqueamos hasta la decisión.
  const canUseTool: CanUseTool = (toolName, input, { signal, toolUseID }) =>
    new Promise<PermissionResult>((resolve) => {
      const requestId = toolUseID;
      pending.set(requestId, { resolve, input });
      send({ type: 'permission_request', requestId, toolName, input });
      // Si se aborta el turno mientras esperamos, denegamos para no colgar el SDK.
      signal.addEventListener(
        'abort',
        () => {
          if (pending.delete(requestId)) {
            resolve({ behavior: 'deny', message: 'Interrumpido' });
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
      const q = query({ prompt: userText, options });
      activeQuery = q;
      for await (const msg of q) {
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
    interrupt: () => {
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
      if (!entry) return;
      pending.delete(requestId);
      if (decision === 'allow') {
        // updatedInput SIEMPRE presente (record): el del cliente o el original.
        entry.resolve({ behavior: 'allow', updatedInput: updatedInput ?? entry.input });
      } else {
        entry.resolve({ behavior: 'deny', message: 'Rechazado por el usuario' });
      }
    },
  };
}
