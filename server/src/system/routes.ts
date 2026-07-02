// Router del panel "System" de Settings. Se monta DEBAJO del gate de auth en
// app.ts → requiere sesión (CLAUDE.md §11). Devuelve datos REALES del proceso, del
// CLI `claude` y de la base de datos (SQLite) para pintar el estado del backend en la UI.
import { Router } from 'express';
import { FS_ROOT } from '../fs/paths.js';
import { getDb } from '../db/sqlite.js';
import { getClaudeVersion } from './claudeVersion.js';

export const systemRouter = Router();

/** Forma EXACTA de la respuesta (contrato consumido por el cliente en Settings). */
interface SystemInfo {
  backend: { uptimeSeconds: number; node: string };
  claude: { version: string | null };
  workspace: { fsRoot: string };
  database: { engine: 'sqlite'; ok: boolean };
}

/** ¿Responde la DB a un SELECT trivial? (embebida: debería salvo corrupción). */
function isDbOk(): boolean {
  try {
    getDb().prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

// --- GET /api/system ------------------------------------------------------
systemRouter.get('/', async (_req, res) => {
  const claudeVersion = await getClaudeVersion();
  const info: SystemInfo = {
    backend: {
      uptimeSeconds: Math.floor(process.uptime()),
      node: process.version,
    },
    claude: { version: claudeVersion },
    // Reutiliza la MISMA raíz que usa el guard anti path-traversal (fs/paths.ts).
    workspace: { fsRoot: FS_ROOT },
    // SQLite embebido: ok si un SELECT trivial no lanza.
    database: { engine: 'sqlite', ok: isDbOk() },
  };
  res.json(info);
});
