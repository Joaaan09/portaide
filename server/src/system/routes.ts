// Router del panel "System" de Settings. Se monta DEBAJO del gate de auth en
// app.ts → requiere sesión (CLAUDE.md §11). Devuelve datos REALES del proceso, del
// CLI `claude` y de Mongo para pintar el estado del backend en la UI.
import { Router } from 'express';
import mongoose from 'mongoose';
import { FS_ROOT } from '../fs/paths.js';
import { getClaudeVersion } from './claudeVersion.js';

export const systemRouter = Router();

/** Forma EXACTA de la respuesta (contrato consumido por el cliente en Settings). */
interface SystemInfo {
  backend: { uptimeSeconds: number; node: string };
  claude: { version: string | null };
  workspace: { fsRoot: string };
  mongo: { connected: boolean };
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
    // readyState === 1 ⇒ 'connected' (mongoose). Cualquier otro estado ⇒ false.
    mongo: { connected: mongoose.connection.readyState === 1 },
  };
  res.json(info);
});
