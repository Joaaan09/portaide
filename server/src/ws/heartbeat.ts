// Heartbeat (ping/pong) de los WebSocket del servidor.
//
// Por qué: en móvil, cuando la pantalla se apaga o se pierde la red, el TCP queda
// medio-abierto (half-open). El socket sigue en `readyState === OPEN` para el
// servidor aunque al otro lado no haya nadie: se acumulan "subscribers fantasma"
// que hacen creer a los runtimes (chat y terminal) que alguien está mirando —
// bloqueando, entre otras cosas, el TTL de sesiones huérfanas.
//
// Solución estándar: cada ciclo se manda `ping` a cada socket y se marca
// `isAlive = false`; el `pong` del cliente (que los navegadores responden solos, a
// nivel de protocolo) lo devuelve a `true`. Si al ciclo siguiente sigue en `false`
// → nadie contestó → `terminate()` (cierre duro, que dispara el 'close' y con él
// la limpieza/detach de los handlers).
import type { WebSocket, WebSocketServer } from 'ws';

/** Intervalo por defecto entre pings. */
const DEFAULT_INTERVAL_MS = 30_000;

/** Fuente de sockets: un WebSocketServer (usa `clients`) o un Set propio. */
export type HeartbeatTarget = WebSocketServer | Set<WebSocket>;

/** Socket con la marca de vida del ciclo anterior. */
type TrackedSocket = WebSocket & { isAlive?: boolean };

function socketsOf(target: HeartbeatTarget): Iterable<WebSocket> {
  return target instanceof Set ? target : target.clients;
}

/**
 * Arranca el heartbeat sobre los sockets de `target`. Devuelve la función para
 * pararlo (cierre limpio del proceso). El timer va `unref()`: no mantiene vivo
 * el proceso por sí solo.
 *
 * Nota: un socket recién abierto tiene `isAlive === undefined` (≠ false), así que
 * sobrevive a su primer ciclo aunque aún no haya contestado a ningún ping.
 */
export function startHeartbeat(
  target: HeartbeatTarget,
  intervalMs: number = DEFAULT_INTERVAL_MS
): () => void {
  // Sockets a los que ya les enganchamos el listener de 'pong' (una sola vez).
  const hooked = new WeakSet<WebSocket>();

  const timer = setInterval(() => {
    for (const ws of socketsOf(target)) {
      const sock = ws as TrackedSocket;
      if (sock.readyState !== sock.OPEN) continue;

      if (sock.isAlive === false) {
        // No contestó al ping del ciclo anterior: conexión zombi.
        sock.terminate();
        continue;
      }

      if (!hooked.has(sock)) {
        hooked.add(sock);
        sock.on('pong', () => {
          sock.isAlive = true;
        });
      }

      sock.isAlive = false;
      try {
        sock.ping();
      } catch {
        sock.terminate(); // socket roto: fuera
      }
    }
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}
