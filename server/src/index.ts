// Punto de entrada: servidor HTTP + WebSocket.
// El WS enruta por path tras un gate de autenticación común (CLAUDE.md §11: el
// upgrade valida la cookie de sesión ANTES de abrir el socket):
//   /ws           → eco (esqueleto para validar la tubería móvil ⇄ backend)
//   /ws/terminal  → pty real (shell del VPS por WebSocket)
//   /ws/chat      → puente del chat con Claude REAL (Agent SDK)
import http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { initDb } from './db/sqlite.js';
import { authenticateUpgrade } from './auth/ws.js';
import { handleTerminalConnection } from './terminal/pty.js';
import { handleChatConnection } from './chat/ws.js';
import { runtimeManager } from './chat/runtime.js';
import { terminalRuntimeManager } from './terminal/runtime.js';
import { startHeartbeat } from './ws/heartbeat.js';
import { initPush } from './push/service.js';
import { wirePushNotifications } from './push/notifier.js';

const app = createApp();
const server = http.createServer(app);

// --- WebSocket (autenticado, enrutado por path) -------------------------
// noServer: gestionamos el upgrade a mano para (1) validar la cookie ANTES de
// abrir el socket y (2) enrutar por path. Un único WebSocketServer sirve el
// handshake de ambas rutas; el eco solo se dispara si emitimos 'connection'
// (el pty no lo hace: llama directo a su handler).
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');

  // Rutas WS conocidas: /ws (eco), /ws/terminal (pty), /ws/chat (Claude). Resto: 404.
  if (pathname !== '/ws' && pathname !== '/ws/terminal' && pathname !== '/ws/chat') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  // GATE de seguridad, común a TODAS las rutas WS (CLAUDE.md §11): sin sesión
  // válida se rechaza el upgrade (no se abre el socket). Vale también para
  // /ws/terminal, que entrega una shell completa del VPS.
  const session = authenticateUpgrade(req);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    if (pathname === '/ws/terminal') {
      // pty real: no pasa por el eco (no emitimos 'connection').
      handleTerminalConnection(ws, req, session);
    } else if (pathname === '/ws/chat') {
      // Puente del chat con Claude: tampoco pasa por el eco.
      handleChatConnection(ws, req, session);
    } else {
      wss.emit('connection', ws, req, session);
    }
  });
});

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'hello', service: 'portaide' }));

  socket.on('message', (data) => {
    // Eco mínimo para validar la tubería móvil ⇄ nginx ⇄ backend.
    socket.send(JSON.stringify({ type: 'echo', data: data.toString() }));
  });

  // `ws` responde a los pings del cliente con pong automáticamente.
});

// --- Heartbeat de los WebSocket -------------------------------------------
// Un único `wss` atiende el handshake de las tres rutas (/ws, /ws/terminal,
// /ws/chat), así que `wss.clients` las cubre todas con una sola llamada. Detecta
// y cierra los sockets zombis del móvil (TCP medio-abierto), que si no quedarían
// como "subscribers fantasma" en los runtimes de chat y terminal.
const stopHeartbeat = startHeartbeat(wss);

// --- Arranque ------------------------------------------------------------
initDb();

// Notificaciones Web Push: configura VAPID (si hay claves) y engancha los avisos
// de "sigue trabajando" / "terminó" a los hooks del chat. Sin claves no rompe:
// queda desactivado con un log claro.
initPush();
wirePushNotifications();

server.listen(env.port, env.host, () => {
  console.log(
    `[portaide] servidor escuchando en http://${env.host}:${env.port} (${env.nodeEnv})`
  );
});

// Cierre limpio (Docker envía SIGTERM al parar el contenedor)
function shutdown(signal: string): void {
  console.log(`[portaide] ${signal} recibido — cerrando…`);
  // Aborta los turnos de chat vivos (viven en memoria, desacoplados del WS).
  runtimeManager.shutdown();
  // Mata los ptys vivos (también desacoplados del WS: sobreviven a la conexión).
  terminalRuntimeManager.shutdown();
  stopHeartbeat();
  wss.close();
  server.close(() => process.exit(0));
  // Cortafuegos: si algo queda colgado, salir igualmente
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
