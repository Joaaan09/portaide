// Historial de conversaciones del ENGINE (Claude Code / CLI `claude`), no solo
// las creadas dentro de PortaIDE. El engine persiste cada sesión como un
// transcript `.jsonl` en ~/.claude/projects/<cwd-sanitizado>/<sessionId>.jsonl
// (las mismas que se ven en VS Code). Este módulo:
//   - LISTA las sesiones de un proyecto (título, fecha, rama).
//   - CONVIERTE un transcript a `LogEvent[]` — EXACTAMENTE el mismo formato de
//     log que el SessionRuntime produce en vivo (runtime.ts), para que el cliente
//     lo repinte con su lógica de ensamblado normal (sin caso especial) y se pueda
//     reanudar con `resume` usando el sessionId del engine.
//
// Solo lectura del FS del host (montado en el contenedor). El cwd llega validado
// bajo FS_ROOT por el router; aquí además se blinda el sessionId contra traversal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LogEvent } from './runtime.js';

/** Raíz de los transcripts del engine (HOME del contenedor = /home/kuoyii). */
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Nombre de directorio que usa el engine para un cwd: todo carácter no
 * alfanumérico → '-'. Ej.: `/home/kuoyii/servers/portaide` →
 * `-home-kuoyii-servers-portaide` (verificado contra los dirs reales).
 */
function projectDir(absCwd: string): string {
  return path.join(PROJECTS_DIR, absCwd.replace(/[^a-zA-Z0-9]/g, '-'));
}

/** sessionId seguro como nombre de fichero (evita `..`, `/`, etc.). */
function safeSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && !id.includes('..');
}

/** Metadatos de una sesión del engine (para la lista del panel). */
export interface EngineSessionMeta {
  id: string;
  title: string;
  updatedAt: string;
  gitBranch: string | null;
  messageCount: number;
}

/** Transcript convertido al log de eventos que consume el cliente. */
export interface EngineThread {
  id: string;
  title: string;
  /** sessionId del engine → se pasa como `resume` para continuar la conversación. */
  claudeSessionId: string;
  thread: LogEvent[];
}

/** Forma mínima de una línea del `.jsonl` (solo lo que leemos). */
interface JsonlLine {
  type?: string;
  message?: { role?: string; content?: unknown };
  timestamp?: string;
  gitBranch?: string;
  aiTitle?: string;
}

interface ContentBlock {
  type?: string;
  text?: unknown;
  thinking?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
  is_error?: unknown;
}

function parseLines(file: string): JsonlLine[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: JsonlLine[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as JsonlLine);
    } catch {
      /* línea corrupta: se ignora */
    }
  }
  return out;
}

/** Aplana el `content` de un tool_result (string | bloques {text}) a texto plano. */
function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          const t = (part as { text?: unknown }).text;
          return typeof t === 'string' ? t : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

/** Primer texto del usuario (fallback de título si no hay aiTitle). */
function firstUserText(lines: JsonlLine[]): string {
  for (const l of lines) {
    if (l.type !== 'user') continue;
    const c = l.message?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      for (const b of c as ContentBlock[]) {
        if (b?.type === 'text' && typeof b.text === 'string') return b.text;
      }
    }
  }
  return '';
}

function snippet(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'sin título';
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
}

/**
 * Lista las sesiones del engine para un proyecto (cwd ya resuelto bajo FS_ROOT).
 * Devuelve [] si el proyecto no tiene transcripts. Más recientes primero.
 */
export function listEngineSessions(absCwd: string): EngineSessionMeta[] {
  const dir = projectDir(absCwd);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return []; // el proyecto no tiene carpeta en ~/.claude/projects
  }

  const metas: EngineSessionMeta[] = [];
  for (const f of files) {
    const id = f.slice(0, -'.jsonl'.length);
    if (!safeSessionId(id)) continue;
    const full = path.join(dir, f);
    const lines = parseLines(full);
    if (lines.length === 0) continue;

    let aiTitle: string | undefined;
    let lastTs: string | undefined;
    let gitBranch: string | null = null;
    let messageCount = 0;
    for (const l of lines) {
      if (l.type === 'ai-title' && typeof l.aiTitle === 'string' && l.aiTitle.trim()) {
        aiTitle = l.aiTitle;
      }
      if (typeof l.timestamp === 'string') lastTs = l.timestamp;
      if (typeof l.gitBranch === 'string' && l.gitBranch) gitBranch = l.gitBranch;
      if (l.type === 'user' || l.type === 'assistant') messageCount += 1;
    }

    let updatedAt = lastTs;
    if (!updatedAt) {
      try {
        updatedAt = fs.statSync(full).mtime.toISOString();
      } catch {
        updatedAt = new Date(0).toISOString();
      }
    }

    metas.push({
      id,
      title: aiTitle?.trim() || snippet(firstUserText(lines)),
      updatedAt,
      gitBranch,
      messageCount,
    });
  }

  // Más recientes primero (ISO 8601 ordena lexicográficamente por fecha).
  metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return metas;
}

/**
 * Convierte el transcript `.jsonl` de una sesión del engine a `LogEvent[]`
 * (mismo formato que emite el SessionRuntime en vivo). null si no existe o el id
 * no es válido. El cliente lo repinta con su ensamblado normal.
 */
export function readEngineThread(absCwd: string, sessionId: string): EngineThread | null {
  if (!safeSessionId(sessionId)) return null;
  const dir = path.resolve(projectDir(absCwd));
  const file = path.resolve(path.join(dir, `${sessionId}.jsonl`));
  // Defensa extra: el fichero debe quedar DENTRO del dir del proyecto.
  if (file !== dir && !file.startsWith(dir + path.sep)) return null;

  const lines = parseLines(file);
  if (lines.length === 0) return null;

  const thread: LogEvent[] = [];
  let aiTitle: string | undefined;
  let userSeq = 0;

  for (const l of lines) {
    if (l.type === 'ai-title') {
      if (typeof l.aiTitle === 'string' && l.aiTitle.trim()) aiTitle = l.aiTitle;
      continue;
    }

    if (l.type === 'user') {
      const c = l.message?.content;
      if (typeof c === 'string') {
        if (c.trim()) thread.push({ type: 'user', id: `u-${userSeq++}`, text: c });
        continue;
      }
      if (Array.isArray(c)) {
        // Un mensaje 'user' es texto del usuario O respuestas de tools (tool_result),
        // rara vez ambos. Se emite el texto primero (burbuja) y luego los resultados.
        const texts: string[] = [];
        const results: LogEvent[] = [];
        for (const b of c as ContentBlock[]) {
          if (b?.type === 'text' && typeof b.text === 'string') {
            texts.push(b.text);
          } else if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
            results.push({
              type: 'tool_result',
              id: b.tool_use_id,
              ok: b.is_error !== true,
              output: flattenContent(b.content),
            });
          }
        }
        const joined = texts.join('').trim();
        if (joined) thread.push({ type: 'user', id: `u-${userSeq++}`, text: joined });
        for (const r of results) thread.push(r);
      }
      continue;
    }

    if (l.type === 'assistant') {
      const c = l.message?.content;
      if (!Array.isArray(c)) continue;
      for (const b of c as ContentBlock[]) {
        if (b?.type === 'thinking' && typeof b.thinking === 'string') {
          if (b.thinking) {
            thread.push({ type: 'thinking', delta: b.thinking });
            thread.push({ type: 'thinking_done' });
          }
        } else if (b?.type === 'text' && typeof b.text === 'string') {
          if (b.text) thread.push({ type: 'text', delta: b.text });
        } else if (
          b?.type === 'tool_use' &&
          typeof b.id === 'string' &&
          typeof b.name === 'string'
        ) {
          thread.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
        }
      }
      thread.push({ type: 'assistant_done' });
      continue;
    }
    // queue-operation / attachment / file-history-snapshot / last-prompt: no renderizables.
  }

  return {
    id: sessionId,
    title: aiTitle?.trim() || snippet(firstUserText(lines)),
    claudeSessionId: sessionId,
    thread,
  };
}
