// FS API (CLAUDE.md §2): árbol, leer y escribir archivos del filesystem local
// del VPS. Se monta DEBAJO del gate de auth en app.ts → todo requiere sesión.
// Todas las rutas pasan por resolveSafe (guard anti path-traversal, paths.ts).
import { Router } from 'express';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { FS_ROOT, resolveSafe } from './paths.js';

export const fsRouter = Router();

// Tope de lectura: por encima devolvemos 413 en vez de cargar archivos enormes
// en memoria/red. ~2MB cubre cualquier archivo de código razonable.
const MAX_READ_BYTES = 2 * 1024 * 1024;

interface FsEntry {
  name: string;
  type: 'dir' | 'file';
  size?: number;
}

/** Mapea un error de node:fs a { status, error } JSON del backend. */
function fsErrorStatus(err: unknown): { status: number; error: string } {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'ENOENT':
      return { status: 404, error: 'not_found' };
    case 'EACCES':
    case 'EPERM':
      return { status: 403, error: 'forbidden' };
    case 'ENOTDIR':
      return { status: 400, error: 'not_a_directory' };
    case 'EISDIR':
      return { status: 400, error: 'not_a_file' };
    case 'EEXIST':
      return { status: 409, error: 'already_exists' };
    default:
      return { status: 500, error: 'fs_error' };
  }
}

// --- GET /api/fs/context -------------------------------------------------
// Raíz navegable + workspace por defecto (los consume el cliente al arrancar).
fsRouter.get('/context', (_req, res) => {
  res.json({ root: FS_ROOT, defaultWorkspace: FS_ROOT });
});

// --- GET /api/fs/list?path= ----------------------------------------------
// Lista una sola carpeta (árbol lazy + selector de carpeta). Carpetas primero,
// luego alfabético. `size` solo para archivos.
fsRouter.get('/list', async (req, res) => {
  const abs = resolveSafe(req.query.path);
  if (!abs) {
    res.status(400).json({ error: 'path_outside_root' });
    return;
  }
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'not_a_directory' });
      return;
    }
    const dirents = await fsp.readdir(abs, { withFileTypes: true });
    const entries: FsEntry[] = await Promise.all(
      dirents.map(async (d): Promise<FsEntry> => {
        // Symlinks: resolver para saber si apuntan a carpeta o archivo.
        if (d.isSymbolicLink()) {
          try {
            const target = await fsp.stat(path.join(abs, d.name));
            return target.isDirectory()
              ? { name: d.name, type: 'dir' }
              : { name: d.name, type: 'file', size: target.size };
          } catch {
            // Symlink roto → lo tratamos como archivo sin tamaño.
            return { name: d.name, type: 'file' };
          }
        }
        if (d.isDirectory()) return { name: d.name, type: 'dir' };
        // Archivo: intentar añadir el tamaño (no crítico si falla).
        try {
          const st = await fsp.stat(path.join(abs, d.name));
          return { name: d.name, type: 'file', size: st.size };
        } catch {
          return { name: d.name, type: 'file' };
        }
      })
    );
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ path: abs, entries });
  } catch (err) {
    const { status, error } = fsErrorStatus(err);
    res.status(status).json({ error });
  }
});

// --- GET /api/fs/read?path= ----------------------------------------------
// Lee un archivo utf8. Rechaza carpetas (400), archivos > ~2MB (413) y binarios
// (byte nulo o no-utf8 → 415).
fsRouter.get('/read', async (req, res) => {
  const abs = resolveSafe(req.query.path);
  if (!abs) {
    res.status(400).json({ error: 'path_outside_root' });
    return;
  }
  try {
    const stat = await fsp.stat(abs);
    if (stat.isDirectory()) {
      res.status(400).json({ error: 'not_a_file' });
      return;
    }
    if (stat.size > MAX_READ_BYTES) {
      res.status(413).json({ error: 'too_large' });
      return;
    }
    const buf = await fsp.readFile(abs);
    // Heurística de binario: un byte nulo casi nunca aparece en texto utf8.
    if (buf.includes(0)) {
      res.status(415).json({ error: 'binary_file' });
      return;
    }
    let content: string;
    try {
      // fatal:true → lanza si hay secuencias utf8 inválidas (binario).
      content = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      res.status(415).json({ error: 'binary_file' });
      return;
    }
    res.json({ path: abs, content });
  } catch (err) {
    const { status, error } = fsErrorStatus(err);
    res.status(status).json({ error });
  }
});

// --- PUT /api/fs/write ----------------------------------------------------
// Escribe contenido utf8 en un archivo (create-or-overwrite).
fsRouter.put('/write', async (req, res) => {
  const body = (req.body ?? {}) as { path?: unknown; content?: unknown };
  const abs = resolveSafe(body.path);
  if (!abs) {
    res.status(400).json({ error: 'path_outside_root' });
    return;
  }
  if (typeof body.content !== 'string') {
    res.status(400).json({ error: 'missing_content' });
    return;
  }
  try {
    await fsp.writeFile(abs, body.content, 'utf8');
    res.json({ ok: true, bytes: Buffer.byteLength(body.content, 'utf8') });
  } catch (err) {
    const { status, error } = fsErrorStatus(err);
    res.status(status).json({ error });
  }
});

// --- POST /api/fs/mkdir ---------------------------------------------------
// Crea una carpeta (recursiva: no falla si los padres ya existen).
fsRouter.post('/mkdir', async (req, res) => {
  const body = (req.body ?? {}) as { path?: unknown };
  const abs = resolveSafe(body.path);
  if (!abs) {
    res.status(400).json({ error: 'path_outside_root' });
    return;
  }
  try {
    await fsp.mkdir(abs, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    const { status, error } = fsErrorStatus(err);
    res.status(status).json({ error });
  }
});

// --- POST /api/fs/rename --------------------------------------------------
// Renombra/mueve. Origen y destino deben quedar DENTRO de la raíz.
fsRouter.post('/rename', async (req, res) => {
  const body = (req.body ?? {}) as { from?: unknown; to?: unknown };
  const from = resolveSafe(body.from);
  const to = resolveSafe(body.to);
  if (!from || !to) {
    res.status(400).json({ error: 'path_outside_root' });
    return;
  }
  try {
    await fsp.rename(from, to);
    res.json({ ok: true });
  } catch (err) {
    const { status, error } = fsErrorStatus(err);
    res.status(status).json({ error });
  }
});

// --- DELETE /api/fs/delete?path= -----------------------------------------
// Borra un archivo o carpeta (recursivo). Nunca la raíz.
fsRouter.delete('/delete', async (req, res) => {
  const abs = resolveSafe(req.query.path);
  if (!abs) {
    res.status(400).json({ error: 'path_outside_root' });
    return;
  }
  if (abs === FS_ROOT) {
    res.status(400).json({ error: 'cannot_delete_root' });
    return;
  }
  try {
    await fsp.rm(abs, { recursive: true, force: false });
    res.json({ ok: true });
  } catch (err) {
    const { status, error } = fsErrorStatus(err);
    res.status(status).json({ error });
  }
});
