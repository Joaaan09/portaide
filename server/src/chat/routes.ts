// Router de la lista de sesiones de chat (pestañas). Se monta DEBAJO del gate de
// auth en app.ts → todo requiere sesión (CLAUDE.md §11). La conversación viva va
// por el WS /ws/chat; esto sólo gestiona la META (títulos) de las pestañas.
import { Router } from 'express';
import { createSession, deleteSession, listSessions } from './store.js';

export const chatRouter = Router();

// --- GET /api/chat/sessions ----------------------------------------------
chatRouter.get('/sessions', async (_req, res) => {
  const sessions = await listSessions();
  res.json({ sessions });
});

// --- POST /api/chat/sessions ---------------------------------------------
chatRouter.post('/sessions', async (req, res) => {
  const body = (req.body ?? {}) as { title?: unknown; cwd?: unknown };
  const title = typeof body.title === 'string' ? body.title : 'new chat';
  const cwd = typeof body.cwd === 'string' ? body.cwd : null;
  const session = await createSession(title, cwd);
  res.status(201).json({ session });
});

// --- DELETE /api/chat/sessions/:id ---------------------------------------
chatRouter.delete('/sessions/:id', async (req, res) => {
  const ok = await deleteSession(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
});
