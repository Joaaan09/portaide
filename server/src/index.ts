// Punto de entrada: servidor HTTP + WebSocket.
// El WS enruta por path tras un gate de autenticación común (CLAUDE.md §11: el
// upgrade valida la cookie de sesión ANTES de abrir el socket):
//   /ws           → eco (esqueleto para validar la tubería móvil ⇄ backend)
//   /ws/terminal  → pty real (shell del VPS por WebSocket)
// El puente al CLI `claude` (/ws/chat) llega en Fase 3.
import http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectMongo } from './db/mongo.js';
import { authenticateUpgrade } from './auth/ws.js';
import { handleTerminalConnection } from './terminal/pty.js';

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

  // Rutas WS conocidas: /ws (eco) y /ws/terminal (pty). El resto: 404.
  if (pathname !== '/ws' && pathname !== '/ws/terminal') {
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

// --- Arranque ------------------------------------------------------------
connectMongo();

server.listen(env.port, () => {
  console.log(`[portaide] servidor escuchando en http://localhost:${env.port} (${env.nodeEnv})`);
});

// Cierre limpio (Docker envía SIGTERM al parar el contenedor)
function shutdown(signal: string): void {
  console.log(`[portaide] ${signal} recibido — cerrando…`);
  wss.close();
  server.close(() => process.exit(0));
  // Cortafuegos: si algo queda colgado, salir igualmente
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
