// Router de la lista de sesiones de chat (pestañas). Se monta DEBAJO del gate de
// auth en app.ts → todo requiere sesión (CLAUDE.md §11). La conversación viva va
// por el WS /ws/chat; esto gestiona la META (títulos, open) y el HILO persistido
// de las pestañas (modelo "cerrar ≠ borrar" + historial).
import { Router } from 'express';
import { resolveSafe } from '../fs/paths.js';
import { listEngineSessions, readEngineThread } from './engineHistory.js';
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  upsertSession,
} from './store.js';

export const chatRouter = Router();

// --- GET /api/chat/engine/sessions?cwd=<path> ----------------------------
// Historial REAL del engine (Claude Code / CLI): conversaciones del proyecto
// abierto que viven como transcripts .jsonl en ~/.claude/projects (incluidas las
// de VS Code). Solo lectura; el cwd se valida bajo FS_ROOT. [] si cwd inválido.
chatRouter.get('/engine/sessions', (req, res) => {
  const abs = resolveSafe(req.query.cwd);
  if (!abs) {
    res.json({ sessions: [] });
    return;
  }
  res.json({ sessions: listEngineSessions(abs) });
});

// --- GET /api/chat/engine/sessions/:id?cwd=<path> ------------------------
// Transcript de UNA sesión del engine convertido a log de eventos (LogEvent[]),
// listo para que el cliente lo repinte y se reanude con `resume` (claudeSessionId).
chatRouter.get('/engine/sessions/:id', (req, res) => {
  const abs = resolveSafe(req.query.cwd);
  if (!abs) {
    res.status(400).json({ error: 'bad_cwd' });
    return;
  }
  const session = readEngineThread(abs, req.params.id);
  if (!session) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ session });
});

// --- GET /api/chat/sessions ----------------------------------------------
// Query ?scope=open|all (default open). 'open' = pestañas abiertas (orden
// estable); 'all' = historial completo (más recientes primero).
chatRouter.get('/sessions', async (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'open';
  const sessions = await listSessions(scope);
  res.json({ sessions });
});

// --- GET /api/chat/sessions/:id ------------------------------------------
// Detalle de una sesión INCLUYENDO su hilo de mensajes (thread).
chatRouter.get('/sessions/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ session });
});

// --- POST /api/chat/sessions ---------------------------------------------
chatRouter.post('/sessions', async (req, res) => {
  const body = (req.body ?? {}) as { title?: unknown; cwd?: unknown };
  const title = typeof body.title === 'string' ? body.title : 'new chat';
  const cwd = typeof body.cwd === 'string' ? body.cwd : null;
  const session = await createSession(title, cwd);
  res.status(201).json({ session });
});

// --- PATCH /api/chat/sessions/:id ----------------------------------------
// UPSERT (crear-o-actualizar). El cliente genera el UUID localmente y
// materializa la fila en el PRIMER PATCH (sin POST), así que SIEMPRE deja la
// fila: no hay 404. Sólo se aplican los campos presentes y con el tipo correcto;
// los ausentes/ inválidos se ignoran (y en el alta toman defaults). El cliente
// usa esto para persistir claudeSessionId, el hilo, el título y open/cerrado.
chatRouter.patch('/sessions/:id', async (req, res) => {
  const body = (req.body ?? {}) as {
    title?: unknown;
    claudeSessionId?: unknown;
    thread?: unknown;
    open?: unknown;
  };

  const patch: {
    title?: string;
    claudeSessionId?: string | null;
    thread?: unknown[];
    open?: boolean;
  } = {};

  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.claudeSessionId === 'string' || body.claudeSessionId === null) {
    patch.claudeSessionId = body.claudeSessionId;
  }
  if (Array.isArray(body.thread)) patch.thread = body.thread;
  if (typeof body.open === 'boolean') patch.open = body.open;

  await upsertSession(req.params.id, patch);
  res.json({ ok: true });
});

// --- DELETE /api/chat/sessions/:id ---------------------------------------
// Borrado REAL (no "cerrar": para cerrar sin borrar se usa PATCH open=false).
chatRouter.delete('/sessions/:id', async (req, res) => {
  const ok = await deleteSession(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
});
