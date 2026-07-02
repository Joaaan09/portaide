// Sesión = JWT HS256 firmado con SESSION_SECRET, guardado en cookie httpOnly.
// exp 30 días (herramienta personal de un solo usuario).
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/** Datos que viajan en el token de sesión. */
export interface SessionPayload {
  email: string;
}

const EXPIRES_IN = '30d';

/** Emite un JWT firmado para el usuario dado. */
export function issueToken(payload: SessionPayload): string {
  return jwt.sign({ email: payload.email }, env.sessionSecret, {
    algorithm: 'HS256',
    expiresIn: EXPIRES_IN,
  });
}

/**
 * Verifica y decodifica un token. Devuelve el payload o null si es inválido,
 * está expirado o mal formado (captura cualquier error de jwt.verify).
 */
export function verifyToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.sessionSecret, { algorithms: ['HS256'] });
    if (typeof decoded === 'object' && decoded !== null && typeof decoded.email === 'string') {
      return { email: decoded.email };
    }
    return null;
  } catch {
    return null;
  }
}
