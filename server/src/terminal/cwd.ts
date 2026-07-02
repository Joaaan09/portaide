// Resolución y validación del directorio de trabajo del pty. El terminal da una
// shell completa (CLAUDE.md §11): el `cwd` que llega del cliente NUNCA se usa a
// ciegas — se ancla a `env.fsRoot` para evitar traversal fuera del workspace.
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

/** realpath tolerante: null si la ruta no existe o no es accesible. */
function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Devuelve un `cwd` seguro para lanzar el pty a partir de un valor opcional del
 * query (`?cwd=`). Reglas:
 *  - Sin valor → raíz (`env.fsRoot`).
 *  - Rutas relativas se interpretan contra la raíz; las absolutas se validan igual.
 *  - Debe existir, ser un directorio y quedar DENTRO de la raíz (resuelto por
 *    realpath, para que un symlink no permita escapar). Si algo falla → raíz.
 */
export function resolveCwd(requested: string | undefined): string {
  // Ancla canónica: la raíz resuelta por realpath (o el path normalizado si
  // realpath fallara por alguna razón de permisos).
  const root = safeRealpath(path.resolve(env.fsRoot)) ?? path.resolve(env.fsRoot);

  if (!requested) return root;

  const candidate = path.resolve(root, requested);
  const real = safeRealpath(candidate);
  if (!real) return root; // no existe / sin acceso

  // ¿Queda dentro de la raíz? (rel vacío = la raíz misma; rel con `..` = fuera)
  const rel = path.relative(root, real);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!inside) return root;

  try {
    if (fs.statSync(real).isDirectory()) return real;
  } catch {
    /* condición de carrera / permisos → raíz */
  }
  return root;
}
