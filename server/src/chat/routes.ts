// Router de la lista de sesiones de chat (pestañas). Se monta DEBAJO del gate de
// auth en app.ts → todo requiere sesión (CLAUDE.md §11). La conversación viva va
// por el WS /ws/chat; esto gestiona la META (títulos, open) y el HILO persistido
// de las pestañas (modelo "cerrar ≠ borrar" + historial).
import { Router } from 'express';
import { resolveDirSafe, resolveSafe } from '../fs/paths.js';
import { listEngineSessions, readEngineThread } from './engineHistory.js';
import { runtimeManager } from './runtime.js';
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

// --- POST /api/chat/engine/sessions/:id/open  body {cwd} -----------------
// Abre UNA sesión del engine como pestaña: convierte su transcript a LogEvent[]
// y lo MATERIALIZA aquí mismo (SQLite + runtime), reusando el sessionId del
// engine como id de pestaña (dedup natural) y como `resume`. El hilo NO viaja
// al cliente y de vuelta: antes iba GET → PATCH con el hilo entero, y los
// transcripts largos (>1 MB) chocaban con el límite de body de nginx (413) →
// pestaña vacía sin aviso. Ahora el cliente solo hace `attach` (snapshot por WS).
// Idempotente: si la pestaña ya tiene hilo propio, no se toca (solo se reabre).
chatRouter.post('/engine/sessions/:id/open', async (req, res) => {
  const body = (req.body ?? {}) as { cwd?: unknown };
  // Es el ancla del proyecto: como en el PATCH, directorio existente bajo FS_ROOT.
  const abs = resolveDirSafe(body.cwd);
  if (!abs) {
    res.status(400).json({ error: 'bad_cwd' });
    return;
  }
  const engine = readEngineThread(abs, req.params.id);
  if (!engine) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const seeded = await runtimeManager.get(engine.id).seedFromEngine({
    events: engine.thread,
    claudeSessionId: engine.claudeSessionId,
    cwd: abs,
    title: engine.title,
  });
  let title = engine.title;
  if (!seeded) {
    await upsertSession(engine.id, { open: true });
    // Ya era una pestaña: su título (quizá renombrado en PortaIDE) manda.
    title = (await getSession(engine.id))?.title ?? title;
  }
  res.json({
    session: { id: engine.id, title, claudeSessionId: engine.claudeSessionId, cwd: abs },
  });
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
    cwd?: unknown;
    thread?: unknown;
    open?: unknown;
  };

  const patch: {
    title?: string;
    claudeSessionId?: string | null;
    cwd?: string | null;
    thread?: unknown[];
    open?: boolean;
  } = {};

  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.claudeSessionId === 'string' || body.claudeSessionId === null) {
    patch.claudeSessionId = body.claudeSessionId;
  }
  // `cwd` = carpeta del proyecto de la conversación. Se valida bajo FS_ROOT y se
  // exige que sea un directorio existente: una ruta basura no puede anclar una
  // sesión (400 explícito, no un ancla silenciosa a la raíz).
  if (body.cwd !== undefined) {
    if (body.cwd === null) {
      patch.cwd = null;
    } else {
      const abs = resolveDirSafe(body.cwd);
      if (!abs) {
        res.status(400).json({ error: 'bad_cwd' });
        return;
      }
      patch.cwd = abs;
    }
  }
  if (Array.isArray(body.thread)) patch.thread = body.thread;
  if (typeof body.open === 'boolean') patch.open = body.open;

  // El ancla de proyecto solo se puede fijar mientras la conversación NO haya
  // arrancado. Con hilo ya escrito se IGNORA (el resto del patch sí se aplica):
  // moverla partiría su historial en ~/.claude/projects. Se ignora en vez de
  // 400 para no romper flujos que mandan `thread` y `cwd` juntos (materializar
  // una conversación del engine ya existente).
  if (patch.cwd !== undefined) {
    const existing = await getSession(req.params.id);
    if (existing && existing.thread.length > 0) delete patch.cwd;
  }

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
