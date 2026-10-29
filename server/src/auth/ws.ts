// Autenticación del upgrade de WebSocket: parsea la cabecera Cookie del request
// de upgrade y valida el JWT de sesión. Reutilizable por las WS de terminal/chat
// (futuras). CLAUDE.md §11: nada de pty/chat sin sesión válida.
import type { IncomingMessage } from 'node:http';
import { env } from '../config/env.js';
import { verifyToken } from './session.js';
import { isCrossSite } from './site.js';

/** Sesión resuelta desde la cookie del upgrade. */
export interface WsSession {
  email: string;
}

/**
 * Extrae una cookie por nombre de una cabecera `Cookie` cruda. Evitamos añadir
 * el paquete `cookie` para una necesidad tan acotada (una sola cookie, cuyo
 * valor —un JWT— es URL-safe).
 */
function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * Valida el request de upgrade. Devuelve la sesión o null si no hay cookie
 * válida — en cuyo caso el llamante debe rechazar el upgrade (no abrir el WS).
 */
export function authenticateUpgrade(req: IncomingMessage): WsSession | null {
  // Los WS no tienen CORS: sin esto, una página de otro sitio (o el iframe de
  // la vista previa de HTML) podría abrir /ws/terminal si viajara la cookie.
  if (isCrossSite(req)) return null;
  const header = req.headers.cookie;
  if (!header) return null;
  const token = readCookie(header, env.cookieName);
  if (!token) return null;
  const session = verifyToken(token);
  return session ? { email: session.email } : null;
}
