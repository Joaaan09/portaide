// Punto de entrada: servidor HTTP + WebSocket.
// El WS en /ws es un esqueleto (eco), ya AUTENTICADO: el upgrade valida la
// cookie de sesión antes de abrir el socket (CLAUDE.md §11). El pty real y el
// puente al CLI `claude` llegan en Fase 3.
import http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectMongo } from './db/mongo.js';
import { authenticateUpgrade } from './auth/ws.js';

const app = createApp();
const server = http.createServer(app);

// --- WebSocket (esqueleto, autenticado) ---------------------------------
// noServer: gestionamos el upgrade a mano para (1) validar la cookie ANTES de
// abrir el socket y (2) poder enrutar por path en el futuro (/ws/terminal,
// /ws/chat). De momento solo existe el eco en /ws.
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');

  if (pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  // GATE de seguridad: sin sesión válida se rechaza el upgrade (no se abre WS).
  const session = authenticateUpgrade(req);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, session);
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
