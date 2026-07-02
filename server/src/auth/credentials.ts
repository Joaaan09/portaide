// Credenciales del usuario único (CLAUDE.md §11, decisiones.md 2026-07-02).
// La contraseña se hashea con bcryptjs (10 rounds) EN MEMORIA al arrancar:
// nunca se guarda en claro, ni se loguea la contraseña ni el hash.
import bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const BCRYPT_ROUNDS = 10;

// Hash calculado una vez al importar el módulo (arranque). null si no hay
// AUTH_PASSWORD configurada (login queda deshabilitado → 503 en la ruta).
const passwordHash = env.authPassword ? bcrypt.hashSync(env.authPassword, BCRYPT_ROUNDS) : null;
const authEmail = env.authEmail ? env.authEmail.trim().toLowerCase() : null;

/** ¿Está el login operativo? (email + contraseña configurados en el entorno). */
export function isAuthConfigured(): boolean {
  return passwordHash !== null && authEmail !== null;
}

/**
 * Compara dos cadenas en tiempo constante. Hashea ambas a un digest de longitud
 * fija (SHA-256) para que `timingSafeEqual` no lance por longitudes distintas y
 * para no filtrar la longitud del secreto por el tiempo de comparación.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verifica email (case-insensitive, tiempo constante) + contraseña (bcrypt).
 * bcrypt.compare se ejecuta SIEMPRE (aunque el email no cuadre) para no filtrar
 * por tiempo si el email existe o no.
 */
export async function verifyCredentials(email: string, password: string): Promise<boolean> {
  if (!passwordHash || !authEmail) return false;
  const emailMatch = timingSafeEqualStr(email.trim().toLowerCase(), authEmail);
  const passwordMatch = await bcrypt.compare(password, passwordHash);
  return emailMatch && passwordMatch;
}
