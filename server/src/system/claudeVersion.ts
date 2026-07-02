// Versión del CLI `claude` instalado en el VPS (CLAUDE.md §4). La leemos una vez
// ejecutando el binario y la CACHEAMOS en memoria: la versión no cambia en runtime,
// así no lanzamos un proceso hijo en cada request a /api/system.
//
// Degradación: si el binario no está, tarda demasiado o su salida no trae un
// número reconocible, devolvemos null (nunca lanzamos) para no tumbar el endpoint.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Timeout corto: `claude --version` es instantáneo; si se cuelga, degradamos a null. */
const VERSION_TIMEOUT_MS = 2_000;

/** Cache del resultado exitoso (null = aún sin resolver o último intento fallido). */
let cachedVersion: string | null = null;

/**
 * Devuelve el número de versión del CLI `claude` (p. ej. "2.1.197") o null si no
 * se puede determinar. Cachea el primer resultado exitoso; los fallos NO se
 * cachean, así un `claude` que aparezca más tarde se detecta en la próxima llamada.
 */
export async function getClaudeVersion(): Promise<string | null> {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const { stdout } = await execFileAsync('claude', ['--version'], {
      timeout: VERSION_TIMEOUT_MS,
    });
    // Salida típica: "2.1.197 (Claude Code)" → extraemos SOLO el semver.
    const version = stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
    if (version) {
      cachedVersion = version;
      return version;
    }
    return null;
  } catch {
    // No instalado, no en PATH o timeout → degradamos a null sin propagar.
    return null;
  }
}
