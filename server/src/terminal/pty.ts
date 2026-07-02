// Handler de una conexión WebSocket de terminal (/ws/terminal). El upgrade ya
// pasó el gate de autenticación (CLAUDE.md §11) antes de llegar aquí: este
// módulo solo se ocupa de puentear un pty real con el socket.
//
// Protocolo JSON:
//   cliente → server: {type:'input', data}            (write al pty)
//                     {type:'resize', cols, rows}      (redimensiona el pty)
//   server → cliente: {type:'output', data}           (salida del pty)
//                     {type:'exit', code}              (el pty terminó)
import { URL } from 'node:url';
import type { IncomingMessage } from 'node:http';
import { spawn, type IPty } from 'node-pty';
import type { WebSocket } from 'ws';
import type { WsSession } from '../auth/ws.js';
import { resolveCwd } from './cwd.js';

// Dimensiones iniciales razonables: el cliente reajusta con fit apenas monta.
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// Cota defensiva para el resize (evita valores absurdos desde el cliente).
const MAX_DIM = 1000;

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
function clampDim(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  if (n < 1) return null;
  return Math.min(n, MAX_DIM);
}

interface ClientMessage {
  type?: unknown;
  data?: unknown;
  cols?: unknown;
  rows?: unknown;
}

/**
 * Puentea un pty con el WebSocket ya autenticado. Al salir el pty cierra el WS;
 * al cerrarse el WS mata el pty. Toda escritura tras el cierre queda protegida.
 */
export function handleTerminalConnection(
  ws: WebSocket,
  req: IncomingMessage,
  _session: WsSession
): void {
  const url = new URL(req.url ?? '', 'http://localhost');
  const cwd = resolveCwd(url.searchParams.get('cwd') ?? undefined);

  let term: IPty;
  try {
    term = spawn(resolveShell(), ['-l'], {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd,
      // env del proceso + TERM correcto para colores/secuencias.
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } catch (err) {
    console.error('[terminal] no se pudo lanzar el pty:', err);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: -1 }));
    }
    ws.close();
    return;
  }

  // `closed` cubre tanto el exit del pty como el cierre del WS: una vez true,
  // no se escribe ni al socket ni al pty (protección tras exit).
  let closed = false;

  const onData = term.onData((data) => {
    if (!closed && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  const onExit = term.onExit(({ exitCode }) => {
    if (closed) return;
    closed = true;
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    }
    ws.close();
  });

  ws.on('message', (raw) => {
    if (closed) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return; // ignora tramas no-JSON
    }

    if (msg.type === 'input' && typeof msg.data === 'string') {
      term.write(msg.data);
    } else if (msg.type === 'resize') {
      const cols = clampDim(msg.cols);
      const rows = clampDim(msg.rows);
      if (cols !== null && rows !== null) term.resize(cols, rows);
    }
  });

  const cleanup = (): void => {
    onData.dispose();
    onExit.dispose();
    if (!closed) {
      closed = true;
      try {
        term.kill();
      } catch {
        /* el proceso ya no existe */
      }
    }
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
