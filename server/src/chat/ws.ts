// Handler de una conexión WebSocket de chat (/ws/chat). El upgrade ya pasó el
// gate de autenticación (CLAUDE.md §11) antes de llegar aquí. Este módulo lleva
// el estado por-conexión (modelo y permission mode actuales, turno vivo) y
// enruta los mensajes del cliente al puente del Agent SDK (bridge.ts).
//
// Un turno a la vez por conexión: el stream server→cliente no lleva sessionId,
// así que el cliente atribuye los eventos al turno en curso. El `cwd` y el
// `sessionId` (claudeSessionId a reanudar) viajan en cada `user_message`.
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { WsSession } from '../auth/ws.js';
import { FS_ROOT, resolveSafe } from '../fs/paths.js';
import { runChatTurn, type ChatPermissionMode, type ChatTurn } from './bridge.js';

const VALID_MODES: ReadonlySet<ChatPermissionMode> = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
]);

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

interface ClientMessage {
  type?: unknown;
  text?: unknown;
  cwd?: unknown;
  sessionId?: unknown;
  requestId?: unknown;
  decision?: unknown;
  updatedInput?: unknown;
  model?: unknown;
  mode?: unknown;
}

export function handleChatConnection(
  ws: WebSocket,
  _req: IncomingMessage,
  _session: WsSession
): void {
  // Estado por-conexión: se aplican al ARRANCAR el próximo turno; si hay turno
  // vivo, también se cambian en caliente vía el handle.
  let currentModel: string | undefined;
  let currentMode: ChatPermissionMode = 'default';
  let turn: ChatTurn | null = null;

  const send = (msg: unknown): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return; // ignora tramas no-JSON
    }

    switch (msg.type) {
      case 'user_message': {
        if (typeof msg.text !== 'string' || msg.text.trim().length === 0) return;
        if (turn) {
          // Un turno a la vez: el cliente deshabilita el envío mientras streamea.
          send({ type: 'error', message: 'Ya hay un turno en curso' });
          return;
        }
        const cwd = safeCwd(msg.cwd);
        const resumeSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : undefined;
        turn = runChatTurn({
          ws,
          cwd,
          userText: msg.text,
          resumeSessionId,
          model: currentModel,
          permissionMode: currentMode,
          onSession: () => {
            /* el cliente guarda el sessionId; aquí no hace falta retenerlo */
          },
          onDone: () => {
            turn = null;
          },
        });
        return;
      }
      case 'permission_decision': {
        if (typeof msg.requestId !== 'string') return;
        const decision = msg.decision === 'allow' ? 'allow' : 'deny';
        const updatedInput =
          msg.updatedInput && typeof msg.updatedInput === 'object'
            ? (msg.updatedInput as Record<string, unknown>)
            : undefined;
        turn?.resolvePermission(msg.requestId, decision, updatedInput);
        return;
      }
      case 'set_model': {
        currentModel = typeof msg.model === 'string' && msg.model ? msg.model : undefined;
        turn?.setModel(currentModel);
        return;
      }
      case 'set_permission_mode': {
        if (typeof msg.mode === 'string' && VALID_MODES.has(msg.mode as ChatPermissionMode)) {
          currentMode = msg.mode as ChatPermissionMode;
          turn?.setPermissionMode(currentMode);
        }
        return;
      }
      case 'interrupt': {
        turn?.interrupt();
        return;
      }
      default:
        return;
    }
  });

  const cleanup = (): void => {
    turn?.interrupt();
    turn = null;
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
