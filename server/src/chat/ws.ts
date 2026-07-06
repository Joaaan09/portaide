// Handler de una conexión WebSocket de chat (/ws/chat). El upgrade ya pasó el
// gate de autenticación (CLAUDE.md §11) antes de llegar aquí.
//
// Este WS es un TRANSPORTE MULTIPLEXADO (decisiones.md · "Chat en segundo plano"):
// cada trama lleva `sessionId` (el UUID de pestaña) y una misma conexión atiende
// N sesiones a la vez. El estado vivo del turno NO vive aquí, vive en el
// SessionRuntime (runtime.ts), que es independiente del socket. Por eso:
//   - Cerrar el socket solo DESUSCRIBE (no aborta ningún turno).
//   - Se pueden tener varias conversaciones trabajando en paralelo.
//   - Escribir mientras trabaja ENCOLA (lo gestiona el runtime).
//
// Protocolo (cliente→server), todas con `sessionId`:
//   attach{sessionId}                        → snapshot + suscripción a eventos vivos
//   detach{sessionId}                        → desuscripción (NO para el turno)
//   message{sessionId,localId,text,cwd?,model?,mode?,effort?,workflows?} → arranca/encola
//   stop{sessionId}                          → aborta el turno vivo + vacía cola
//   permission{sessionId,requestId,decision,updatedInput?} → resuelve un Approve/Reject (modo Ask)
//   set_model{sessionId,model} · set_permission_mode{sessionId,mode} → cambio en caliente
import fs from 'node:fs';
import type { IncomingMessage as HttpIncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { WsSession } from '../auth/ws.js';
import { FS_ROOT, resolveSafe } from '../fs/paths.js';
import type { ChatEffort, ChatPermissionMode } from './bridge.js';
import { runtimeManager } from './runtime.js';

const VALID_MODES: ReadonlySet<ChatPermissionMode> = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
]);

const VALID_EFFORT: ReadonlySet<ChatEffort> = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** Valida el effort del cliente; nivel desconocido (incl. 'auto') → undefined (default). */
function safeEffort(requested: unknown): ChatEffort | undefined {
  return typeof requested === 'string' && VALID_EFFORT.has(requested as ChatEffort)
    ? (requested as ChatEffort)
    : undefined;
}

/** Resuelve el cwd del cliente bajo FS_ROOT; si es inválido o no es dir → FS_ROOT. */
function safeCwd(requested: unknown): string {
  const abs = resolveSafe(requested);
  if (!abs) return FS_ROOT;
  try {
    if (fs.statSync(abs).isDirectory()) return abs;
  } catch {
    /* no existe / sin permisos → raíz */
  }
  return FS_ROOT;
}

/**
 * Modo de permiso por defecto = bypassPermissions (decisión del usuario, 2026-07-03):
 * "sin permisos" para que el trabajo en 2º plano no se bloquee esperando aprobación.
 * El Approve/Reject (modo 'default'/Ask) sigue disponible si el cliente lo pide.
 */
function safeMode(requested: unknown): ChatPermissionMode {
  return typeof requested === 'string' && VALID_MODES.has(requested as ChatPermissionMode)
    ? (requested as ChatPermissionMode)
    : 'bypassPermissions';
}

interface ClientMessage {
  type?: unknown;
  sessionId?: unknown;
  localId?: unknown;
  text?: unknown;
  cwd?: unknown;
  requestId?: unknown;
  decision?: unknown;
  updatedInput?: unknown;
  model?: unknown;
  mode?: unknown;
  effort?: unknown;
  workflows?: unknown;
}

export function handleChatConnection(
  ws: WebSocket,
  _req: HttpIncomingMessage,
  _session: WsSession
): void {
  // Sesiones a las que ESTE socket está suscrito (para desuscribir al cerrar).
  const attached = new Set<string>();

  const asId = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return; // ignora tramas no-JSON
    }

    const sessionId = asId(msg.sessionId);
    if (!sessionId) return; // todas las tramas del protocolo nuevo llevan sessionId

    switch (msg.type) {
      case 'attach': {
        attached.add(sessionId);
        void runtimeManager.get(sessionId).attach(ws);
        return;
      }

      case 'detach': {
        attached.delete(sessionId);
        runtimeManager.get(sessionId).detach(ws);
        return;
      }

      case 'message': {
        if (typeof msg.text !== 'string' || msg.text.trim().length === 0) return;
        const localId = asId(msg.localId) ?? `${sessionId}-${Date.now()}`;
        const incoming = {
          localId,
          text: msg.text,
          cwd: safeCwd(msg.cwd),
          model: typeof msg.model === 'string' && msg.model ? msg.model : undefined,
          permissionMode: safeMode(msg.mode),
          effort: safeEffort(msg.effort),
          enableWorkflows: msg.workflows === true,
        };
        const rt = runtimeManager.get(sessionId);
        // Auto-attach defensivo: si el socket aún no estaba suscrito, primero
        // suscribe (para recibir el stream) y LUEGO encola — en ese orden, para
        // que el snapshot no incluya la burbuja nueva y no se duplique.
        void (async () => {
          if (!attached.has(sessionId)) {
            attached.add(sessionId);
            await rt.attach(ws);
          }
          await rt.enqueueMessage(incoming);
        })();
        return;
      }

      case 'stop': {
        runtimeManager.get(sessionId).stop();
        return;
      }

      case 'permission': {
        if (typeof msg.requestId !== 'string') return;
        const decision = msg.decision === 'allow' ? 'allow' : 'deny';
        const updatedInput =
          msg.updatedInput && typeof msg.updatedInput === 'object'
            ? (msg.updatedInput as Record<string, unknown>)
            : undefined;
        runtimeManager.get(sessionId).resolvePermission(msg.requestId, decision, updatedInput);
        return;
      }

      case 'set_model': {
        const model = typeof msg.model === 'string' && msg.model ? msg.model : undefined;
        runtimeManager.get(sessionId).setModel(model);
        return;
      }

      case 'set_permission_mode': {
        if (typeof msg.mode === 'string' && VALID_MODES.has(msg.mode as ChatPermissionMode)) {
          runtimeManager.get(sessionId).setPermissionMode(msg.mode as ChatPermissionMode);
        }
        return;
      }

      default:
        return;
    }
  });

  // Cierre/err del socket: SOLO desuscribe de sus sesiones. NUNCA aborta el turno
  // (ese es justo el bug que arreglamos: el turno sigue vivo en el runtime).
  const cleanup = (): void => {
    for (const id of attached) runtimeManager.get(id).detach(ws);
    attached.clear();
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
