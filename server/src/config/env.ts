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

// --- Web Push (VAPID) -----------------------------------------------------
// Notificaciones "sigue trabajando" / "terminó" con el móvil apagado. Las tres
// variables son necesarias: sin ellas el push queda DESACTIVADO (log claro), pero
// el servidor arranca igual — es una función opcional, no parte del borde.
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || undefined;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || undefined;
const vapidSubject = process.env.VAPID_SUBJECT || undefined;
const pushEnabled = Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);
if (!pushEnabled) {
  console.warn(
    '[env] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT incompletos — notificaciones push DESACTIVADAS (genera un par con `npx web-push generate-vapid-keys`).'
  );
}

// --- GitHub (Source Control, DESIGN §8.1) ---------------------------------
// Token para push/pull por HTTPS. Opcional: sin él, el panel de git sigue
// funcionando en local (status/commit/ramas) y solo las operaciones de red
// avisan de que falta. Se valida el formato porque el token viaja al
// credential helper por env y un salto de línea rompería el protocolo de git.
const githubTokenRaw = process.env.GITHUB_TOKEN?.trim() || undefined;
let githubToken = githubTokenRaw;
if (githubToken && !/^[\x21-\x7e]+$/.test(githubToken)) {
  console.warn(
    '[env] GITHUB_TOKEN contiene espacios o caracteres no imprimibles — IGNORADO (revísalo, probablemente se coló un salto de línea).'
  );
  githubToken = undefined;
}
if (!githubToken) {
  console.warn('[env] GITHUB_TOKEN no definido — push/pull desde el panel de git DESACTIVADOS.');
}

// Identidad con la que firmar los commits creados desde PortaIDE. Opcional: si
// falta, git usa la config del sistema (~/.gitconfig del usuario del backend).
const gitAuthorName = process.env.GIT_AUTHOR_NAME?.trim() || undefined;
const gitAuthorEmail = process.env.GIT_AUTHOR_EMAIL?.trim() || undefined;

// --- Cookie de sesión -----------------------------------------------------
// Secure por defecto en producción; en dev (http) debe ir a false o el
// navegador descarta la cookie. Se puede forzar con COOKIE_SECURE.
const cookieSecureEnv = process.env.COOKIE_SECURE;
const cookieSecure =
  cookieSecureEnv !== undefined ? cookieSecureEnv === 'true' : isProduction;

/** Parsea CHAT_MAX_CONCURRENT_TURNS: entero ≥0 (0 = sin límite); default 3.
 *  Tope defensivo de concurrencia: este VPS se congela por saturación de CPU
 *  cuando corren varias sesiones de Claude a la vez (ver decisiones.md). */
function parseMaxConcurrent(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 3;
}

/** Parsea un entero de env con mínimo defensivo; valor inválido → `fallback`. */
function parseIntEnv(raw: string | undefined, fallback: number, min: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

export const env = {
  /** Puerto HTTP del backend. */
  port: Number(process.env.PORT) || 4100,
  /** Interfaz de escucha. En Docker daba igual (red interna); con el backend en
   *  el HOST (systemd) el contenedor del frontend lo alcanza por `host-gateway`,
   *  así que hay que escuchar en una interfaz visible desde ahí. Default 0.0.0.0.
   *  OJO seguridad (CLAUDE.md §11): 0.0.0.0 deja el 4100 accesible desde fuera si
   *  no hay firewall — bloquéalo con UFW salvo las redes Docker (ver deploy/README.md). */
  host: process.env.HOST || '0.0.0.0',
  /** Máximo de turnos de chat corriendo simultáneamente (0 = sin límite; default 3). */
  chatMaxConcurrentTurns: parseMaxConcurrent(process.env.CHAT_MAX_CONCURRENT_TURNS),
  /** Scrollback que guarda cada terminal en memoria para el `snapshot` al reengancharse
   *  (bytes; default 256 KiB, mínimo 1 KiB). */
  terminalScrollbackBytes: parseIntEnv(process.env.TERMINAL_SCROLLBACK_BYTES, 262_144, 1_024),
  /** Tiempo que sobrevive un pty sin nadie mirando antes de que el reaper lo mate
   *  (ms; default 2h, mínimo 1min). Generoso a propósito: permite dejar tareas
   *  largas corriendo con el móvil apagado. */
  terminalOrphanTtlMs: parseIntEnv(process.env.TERMINAL_ORPHAN_TTL_MS, 7_200_000, 60_000),
  /** Máximo de sesiones de terminal (ptys) vivas a la vez (default 6, mínimo 1).
   *  Tope defensivo: este VPS se congela por saturación de CPU. */
  terminalMaxSessions: parseIntEnv(process.env.TERMINAL_MAX_SESSIONS, 6, 1),
  /** Espera antes de avisar por push de "sigue trabajando" al irse el usuario
   *  (ms; default 20s, mínimo 1s). Debounce: una reconexión rápida lo cancela. */
  pushWorkingDelayMs: parseIntEnv(process.env.PUSH_WORKING_DELAY_MS, 20_000, 1_000),
  /** Claves VAPID del Web Push (undefined = push desactivado). */
  vapidPublicKey,
  vapidPrivateKey,
  /** `mailto:` de contacto que exige el protocolo VAPID. */
  vapidSubject,
  /** true solo si las tres variables VAPID están presentes. */
  pushEnabled,
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
  /** Token de GitHub para push/pull (undefined = operaciones de red desactivadas).
   *  NUNCA se envía al cliente ni se escribe en logs (CLAUDE.md §11). */
  githubToken,
  /** true si hay token utilizable (esto sí puede viajar al cliente). */
  githubTokenPresent: Boolean(githubToken),
  /** Nombre/email con los que firmar los commits (undefined = config del sistema). */
  gitAuthorName,
  gitAuthorEmail,
  /** Flag Secure de la cookie de sesión. */
  cookieSecure,
  /** Nombre de la cookie de sesión. */
  cookieName: process.env.COOKIE_NAME || 'portaide_session',
} as const;
