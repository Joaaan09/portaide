// Store de la LISTA de sesiones de chat (pestañas). Persistencia en SQLite
// (better-sqlite3, síncrono) vía db/sqlite.ts: SIEMPRE disponible al ser
// embebida, sin fallback en memoria. Guarda la META (título, cwd,
// claudeSessionId, open, timestamps) y el HILO de mensajes serializado (columna
// `thread`), para el modelo "cerrar ≠ borrar" + historial. El contexto vivo del
// engine sigue en ~/.claude y se reanuda con `resume` (decisiones.md "Puente del
// Chat"); `thread` es la copia renderizable del hilo. Las firmas siguen siendo
// async aunque por dentro sean síncronas, para no tocar chat/routes.ts.
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

/**
 * Forma que consume el cliente en META/lista (id como string, fechas ISO).
 * NO incluye `thread` a propósito: la lista es ligera; el hilo se pide con
 * getSession(id) (GET /sessions/:id).
 */
export interface ChatSessionDto {
  id: string;
  title: string;
  claudeSessionId: string | null;
  cwd: string | null;
  open: boolean;
  createdAt: string;
  updatedAt: string;
}

/** DTO de detalle: la META + el hilo de mensajes ya parseado. */
export type ChatSessionWithThread = ChatSessionDto & { thread: unknown[] };

/** Forma cruda de una fila SQLite (columnas snake_case, NULL → null). */
interface ChatSessionRow {
  id: string;
  title: string;
  claude_session_id: string | null;
  cwd: string | null;
  thread: string | null;
  open: number;
  created_at: string;
  updated_at: string;
}

/** Mapea una fila SQLite (snake_case) al DTO de META (camelCase). */
function toDto(row: ChatSessionRow): ChatSessionDto {
  return {
    id: row.id,
    title: row.title,
    claudeSessionId: row.claude_session_id,
    cwd: row.cwd,
    open: row.open !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Parsea el hilo con tolerancia: null/JSON inválido/no-array → []. */
function parseThread(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Lista las sesiones (SÓLO columnas de META, sin `thread`: la lista es ligera).
 * - scope 'open' (por defecto): sólo pestañas abiertas, orden estable por
 *   created_at ASC (para que las pestañas no bailen).
 * - scope 'all': historial completo, más recientes primero (updated_at DESC).
 */
export async function listSessions(
  scope: 'open' | 'all' = 'open'
): Promise<ChatSessionDto[]> {
  const cols =
    'id, title, claude_session_id, cwd, open, created_at, updated_at';
  const sql =
    scope === 'open'
      ? `SELECT ${cols} FROM chat_sessions WHERE open = 1 ORDER BY created_at ASC`
      : `SELECT ${cols} FROM chat_sessions ORDER BY updated_at DESC`;
  // Las filas de META no traen `thread`; toDto no lo usa, así que el cast es seguro.
  const rows = getDb().prepare(sql).all() as ChatSessionRow[];
  return rows.map(toDto);
}

/** Devuelve una sesión con su hilo parseado, o null si no existe. */
export async function getSession(id: string): Promise<ChatSessionWithThread | null> {
  const row = getDb()
    .prepare('SELECT * FROM chat_sessions WHERE id = ?')
    .get(id) as ChatSessionRow | undefined;
  if (!row) return null;
  return { ...toDto(row), thread: parseThread(row.thread) };
}

/** Crea una sesión con título y cwd. Nace abierta (open=1) y con hilo vacío. */
export async function createSession(title: string, cwd: string | null): Promise<ChatSessionDto> {
  const now = new Date().toISOString();
  const row: ChatSessionRow = {
    id: randomUUID(),
    title: title.trim() || 'new chat',
    claude_session_id: null,
    cwd,
    thread: null,
    open: 1,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO chat_sessions (id, title, claude_session_id, cwd, thread, open, created_at, updated_at)
       VALUES (@id, @title, @claude_session_id, @cwd, @thread, @open, @created_at, @updated_at)`
    )
    .run(row);
  return toDto(row);
}

/**
 * UPSERT (crear-o-actualizar) de una sesión por `id`. El cliente genera el UUID
 * localmente y materializa la fila en el PRIMER PATCH (sin usar POST), así que
 * esta operación SIEMPRE deja la fila (no hay 404):
 * - Si NO existe → INSERT con defaults (title ?? 'new chat', claudeSessionId ??
 *   null, cwd ?? null, thread ?? null, open ?? true, created_at = updated_at = now).
 * - Si existe → UPDATE PARCIAL: SÓLO los campos presentes en `patch` (via
 *   `excluded.*`) + siempre `updated_at`. Los ausentes se conservan.
 * `thread` se serializa a JSON; `open` a 0/1. INSERT ... ON CONFLICT DO UPDATE
 * lo resuelve en una sola sentencia atómica.
 */
export async function upsertSession(
  id: string,
  patch: {
    title?: string;
    claudeSessionId?: string | null;
    /** Carpeta del proyecto de la conversación (ancla; ver chat/runtime.ts). */
    cwd?: string | null;
    thread?: unknown[];
    open?: boolean;
  }
): Promise<void> {
  const now = new Date().toISOString();

  // Valores del INSERT (rama "no existía"): defaults sensatos. `excluded.*` en
  // el DO UPDATE referencia justamente estos valores.
  const params = {
    id,
    title: patch.title ?? 'new chat',
    claude_session_id: patch.claudeSessionId ?? null,
    cwd: patch.cwd ?? null,
    thread: patch.thread !== undefined ? JSON.stringify(patch.thread) : null,
    open: patch.open === undefined ? 1 : patch.open ? 1 : 0,
    created_at: now,
    updated_at: now,
  };

  // SET dinámico de la rama "ya existía": SÓLO campos presentes + updated_at.
  const sets: string[] = [];
  if (patch.title !== undefined) sets.push('title = excluded.title');
  if (patch.claudeSessionId !== undefined) {
    sets.push('claude_session_id = excluded.claude_session_id');
  }
  if (patch.cwd !== undefined) sets.push('cwd = excluded.cwd');
  if (patch.thread !== undefined) sets.push('thread = excluded.thread');
  if (patch.open !== undefined) sets.push('open = excluded.open');
  sets.push('updated_at = excluded.updated_at');

  getDb()
    .prepare(
      `INSERT INTO chat_sessions (id, title, claude_session_id, cwd, thread, open, created_at, updated_at)
       VALUES (@id, @title, @claude_session_id, @cwd, @thread, @open, @created_at, @updated_at)
       ON CONFLICT(id) DO UPDATE SET ${sets.join(', ')}`
    )
    .run(params);
}

/** Borra una sesión por id. Devuelve true si existía. */
export async function deleteSession(id: string): Promise<boolean> {
  const res = getDb().prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  return res.changes > 0;
}
