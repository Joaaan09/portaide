// Guard anti path-traversal de la FS API (CLAUDE.md §11: seguridad, no opcional).
// Toda ruta que entra por /api/fs se resuelve contra env.fsRoot y se verifica que
// quede DENTRO de la raíz. Sin esto, `?path=../../etc/passwd` escaparía el
// workspace y expondría el filesystem entero del VPS.
import path from 'node:path';
import { env } from '../config/env.js';

/** Raíz absoluta y normalizada del filesystem navegable (workspace por defecto). */
export const FS_ROOT = path.resolve(env.fsRoot);

/**
 * Resuelve `p` a una ruta absoluta garantizada DENTRO de FS_ROOT.
 * - `p` absoluta → se normaliza tal cual (resolviendo `..`).
 * - `p` relativa → se interpreta contra FS_ROOT.
 * Devuelve `null` si la ruta escapa la raíz (el handler responde 400
 * `path_outside_root`).
 *
 * Nota: es un check por ruta (path.resolve + startsWith). No sigue symlinks; un
 * symlink DENTRO de la raíz que apunte fuera podría escapar. Aceptable en v1
 * (herramienta de un solo usuario sobre su propio FS); anotado como riesgo.
 */
export function resolveSafe(p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0) return null;
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(FS_ROOT, p);
  if (abs === FS_ROOT || abs.startsWith(FS_ROOT + path.sep)) return abs;
  return null;
}
