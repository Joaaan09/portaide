// Conexión a SQLite (better-sqlite3) — SÍNCRONA y embebida. Es la ÚNICA
// persistencia de PortaIDE: guarda la META de las pestañas de chat (título,
// claudeSessionId, cwd, timestamps), NO los mensajes (el contexto lo guarda el
// engine en ~/.claude y se reanuda con `resume`, decisiones.md "Puente del
// Chat"). Al ser embebida SIEMPRE está disponible: no hay fallback en memoria.
// Si el fichero no abre, revienta al arrancar (mejor ruidoso que degradar en
// silencio).
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

let db: Database.Database | null = null;

/**
 * Abre la DB y crea el esquema si no existe. Debe llamarse UNA vez al arrancar
 * (index.ts), ANTES de servir peticiones. Si falla (dir no escribible, fichero
 * corrupto…), corta el arranque con process.exit(1): no queremos un proceso a
 * medias sin persistencia.
 */
export function initDb(): void {
  const file = env.sqlitePath;
  try {
    // Asegura el directorio del fichero (p.ej. ./data en dev, /app/data en Docker).
    fs.mkdirSync(path.dirname(file), { recursive: true });

    db = new Database(file);
    // WAL: mejores lecturas concurrentes y menos bloqueos (la API, el pty y el
    // chat comparten esta única conexión).
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        claude_session_id TEXT,
        cwd TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    console.log(`[sqlite] listo (${file})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sqlite] no se pudo abrir la base de datos en ${file}: ${message}`);
    process.exit(1);
  }
}

/** Handle de la DB ya inicializada. Lanza si se usa antes de initDb(). */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('[sqlite] getDb() llamado antes de initDb() — inicializa la DB al arrancar.');
  }
  return db;
}
