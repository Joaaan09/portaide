// Configuración de entorno: carga .env y expone las variables tipadas.
// PORT por defecto 4100 — elegido para no chocar con 3000/3900/4000/5000
// de otros proyectos del VPS.
import 'dotenv/config';
import path from 'node:path';

const nodeEnv = process.env.NODE_ENV || 'development';

/** true en producción (NPM termina TLS por delante). */
export const isProduction = nodeEnv === 'production';

// --- SESSION_SECRET (firma del JWT de sesión, CLAUDE.md §11) --------------
// Obligatorio en producción: el borde de seguridad no puede arrancar sin él.
// En desarrollo se admite un fallback constante (con warning) para no frenar
// el trabajo local; NUNCA debe usarse ese valor en producción.
const DEV_SESSION_SECRET = 'portaide-dev-secret-inseguro-cambiar-en-prod';
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProduction) {
    throw new Error(
      '[env] SESSION_SECRET es obligatorio en producción — el borde de seguridad (CLAUDE.md §11) no arranca sin él.'
    );
  }
  console.warn(
    '[env] SESSION_SECRET no definido — usando un fallback SOLO de desarrollo. No lo uses en producción.'
  );
  sessionSecret = DEV_SESSION_SECRET;
}

// --- Credenciales del usuario único (login por env, ver decisiones.md) ----
// Requeridas para que el login funcione. Si faltan, se avisa y el endpoint de
// login responde 503 (auth deshabilitada) en vez de romper el arranque.
const authEmail = process.env.AUTH_EMAIL || undefined;
const authPassword = process.env.AUTH_PASSWORD || undefined;
if (!authEmail || !authPassword) {
  console.warn(
    '[env] AUTH_EMAIL/AUTH_PASSWORD no definidos — login DESHABILITADO (POST /api/auth/login → 503) hasta configurarlos.'
  );
}

// --- Cookie de sesión -----------------------------------------------------
// Secure por defecto en producción; en dev (http) debe ir a false o el
// navegador descarta la cookie. Se puede forzar con COOKIE_SECURE.
const cookieSecureEnv = process.env.COOKIE_SECURE;
const cookieSecure =
  cookieSecureEnv !== undefined ? cookieSecureEnv === 'true' : isProduction;

export const env = {
  /** Puerto HTTP del backend. */
  port: Number(process.env.PORT) || 4100,
  /** Entorno de ejecución. */
  nodeEnv,
  /** Ruta del fichero SQLite (única persistencia). Default: ./data/portaide.db
   *  resuelto desde el cwd; en Docker se fija a /app/data/portaide.db. */
  sqlitePath: process.env.SQLITE_PATH || path.resolve(process.cwd(), 'data', 'portaide.db'),
  /** Secreto de firma del JWT de sesión (HS256). */
  sessionSecret,
  /** Email del usuario único autorizado (login). */
  authEmail,
  /** Contraseña en claro del usuario único: se hashea en memoria al arrancar. */
  authPassword,
  /** Raíz navegable del filesystem (workspace por defecto). */
  fsRoot: process.env.FS_ROOT || '/home/kuoyii/servers',
  /** Flag Secure de la cookie de sesión. */
  cookieSecure,
  /** Nombre de la cookie de sesión. */
  cookieName: process.env.COOKIE_NAME || 'portaide_session',
} as const;
