// Punto de entrada: servidor HTTP + WebSocket.
// El WS en /ws es un esqueleto (eco/ping); el pty real y el puente al CLI
// `claude` llegan en Fase 3.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectMongo } from './db/mongo.js';

const app = createApp();
const server = http.createServer(app);

// --- WebSocket (esqueleto) ---------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'hello', service: 'portaide' }));

  socket.on('message', (data) => {
    // Eco mínimo para validar la tubería móvil ⇄ nginx ⇄ backend.
    socket.send(JSON.stringify({ type: 'echo', data: data.toString() }));
  });

  // `ws` responde a los pings del cliente con pong automáticamente;
  // aquí no hace falta nada más por ahora.
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
