// Handler de una conexión WebSocket de terminal (/ws/terminal). El upgrade ya
// pasó el gate de autenticación (CLAUDE.md §11) antes de llegar aquí.
//
// Este WS es un TRANSPORTE MULTIPLEXADO (mismo patrón que /ws/chat): cada trama
// lleva `sessionId` (el UUID de pestaña que genera el cliente) y una misma
// conexión atiende N terminales a la vez. El pty NO vive aquí, vive en el
// TerminalRuntime (runtime.ts), que es independiente del socket. Por eso:
//   - Cerrar el socket solo DESUSCRIBE (la shell y sus procesos siguen vivos).
//   - Al reengancharse se recibe un `snapshot` con el scrollback perdido.
//
// Protocolo (cliente→server), todas con `sessionId`:
//   attach{sessionId, cwd?, cols?, rows?}  → crea o reengancha; responde snapshot + suscribe
//   input{sessionId, data}                 → write al pty
//   resize{sessionId, cols, rows}          → redimensiona el pty
//   detach{sessionId}                      → desuscribe (NUNCA mata el pty)
//   kill{sessionId}                        → mata el pty y elimina la sesión (SIGHUP
//       y, si la shell lo ignora, SIGKILL: cerrar es explícito y no se negocia)
//
// Protocolo (server→cliente):
//   snapshot{sessionId, data, alive, exitCode, cwd} → scrollback acumulado (para repintar).
//       `alive:false` = la shell murió mientras no mirabas: `data` es su salida
//       final y `exitCode` su código de salida. Esa sesión ya NO existe (no se
//       revive sola: si quieres otra shell, el cliente abre una pestaña nueva).
//   data{sessionId, data}                  → stream vivo
//   exit{sessionId, exitCode}              → esa sesión ha terminado. Dos casos:
//       · exitCode: number → el pty terminó por su cuenta (ese es su código de salida).
//       · exitCode: null   → cierre EXPLÍCITO (`kill`): el server lo emite en el acto,
//         sin esperar al `exit` real del pty (puede tardar si la shell ignora el SIGHUP),
//         así que no hay código de salida que dar. A partir de ese `exit` el runtime
//         viejo queda MUDO: nada de lo que haga su pty llega ya al cliente, y el
//         mismo `sessionId` puede reusarse en el acto para abrir una shell nueva.
//   error{sessionId, message}              → no se pudo atender (p.ej. límite de sesiones)
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { WsSession } from '../auth/ws.js';
import { clampDim, terminalRuntimeManager } from './runtime.js';

interface ClientMessage {
  type?: unknown;
  sessionId?: unknown;
  data?: unknown;
  cwd?: unknown;
  cols?: unknown;
  rows?: unknown;
}

/**
 * Puentea el socket con los TerminalRuntime. El socket es solo transporte: al
 * cerrarse desuscribe sus sesiones, nunca mata ptys.
 */
export function handleTerminalConnection(
  ws: WebSocket,
  _req: IncomingMessage,
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
    if (!sessionId) return; // todas las tramas del protocolo llevan sessionId

    switch (msg.type) {
      case 'attach': {
        const ok = terminalRuntimeManager.attach(ws, sessionId, {
          cwd: typeof msg.cwd === 'string' ? msg.cwd : undefined,
          cols: clampDim(msg.cols),
          rows: clampDim(msg.rows),
        });
        // ok=false → o se rechazó (trama `error`) o la sesión estaba muerta y solo
        // se entregó su snapshot final: en ninguno de los dos casos hay suscripción.
        if (ok) attached.add(sessionId);
        return;
      }

      case 'input': {
        if (typeof msg.data !== 'string') return;
        terminalRuntimeManager.write(sessionId, msg.data);
        return;
      }

      case 'resize': {
        const cols = clampDim(msg.cols);
        const rows = clampDim(msg.rows);
        if (cols !== null && rows !== null) {
          terminalRuntimeManager.resize(sessionId, cols, rows);
        }
        return;
      }

      case 'detach': {
        attached.delete(sessionId);
        terminalRuntimeManager.detach(ws, sessionId);
        return;
      }

      case 'kill': {
        attached.delete(sessionId);
        terminalRuntimeManager.kill(sessionId);
        return;
      }

      default:
        return;
    }
  });

  // Cierre/error del socket: SOLO desuscribe de sus sesiones. NUNCA mata el pty
  // (ese es justo el bug que arreglamos: la shell sigue viva en su runtime).
  const cleanup = (): void => {
    for (const id of attached) terminalRuntimeManager.detach(ws, id);
    attached.clear();
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
