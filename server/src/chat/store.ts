// Store de la LISTA de sesiones de chat (pestañas). Persistencia en SQLite
// (better-sqlite3, síncrono) vía db/sqlite.ts: SIEMPRE disponible al ser
// embebida, sin fallback en memoria. Guarda sólo la META (título, cwd,
// claudeSessionId, timestamps), NO los mensajes — el contexto lo guarda el
// engine en ~/.claude y se reanuda con `resume` (decisiones.md "Puente del
// Chat"). Las firmas siguen siendo async aunque por dentro sean síncronas, para
// no tocar chat/routes.ts.
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

/** Forma que consume el cliente (id como string, fechas ISO). */
export interface ChatSessionDto {
  id: string;
  title: string;
  claudeSessionId: string | null;
  cwd: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Forma cruda de una fila SQLite (columnas snake_case, NULL → null). */
interface ChatSessionRow {
  id: string;
  title: string;
  claude_session_id: string | null;
  cwd: string | null;
  created_at: string;
  updated_at: string;
}

/** Mapea una fila SQLite (snake_case) al DTO (camelCase). */
function toDto(row: ChatSessionRow): ChatSessionDto {
  return {
    id: row.id,
    title: row.title,
    claudeSessionId: row.claude_session_id,
    cwd: row.cwd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lista las sesiones (más recientes primero). */
export async function listSessions(): Promise<ChatSessionDto[]> {
  const rows = getDb()
    .prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC')
    .all() as ChatSessionRow[];
  return rows.map(toDto);
}

/** Crea una sesión con título y cwd. */
export async function createSession(title: string, cwd: string | null): Promise<ChatSessionDto> {
  const now = new Date().toISOString();
  const row: ChatSessionRow = {
    id: randomUUID(),
    title: title.trim() || 'new chat',
    claude_session_id: null,
    cwd,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO chat_sessions (id, title, claude_session_id, cwd, created_at, updated_at)
       VALUES (@id, @title, @claude_session_id, @cwd, @created_at, @updated_at)`
    )
    .run(row);
  return toDto(row);
}

/** Borra una sesión por id. Devuelve true si existía. */
export async function deleteSession(id: string): Promise<boolean> {
  const res = getDb().prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  return res.changes > 0;
}
