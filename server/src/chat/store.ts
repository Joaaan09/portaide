// Store de la LISTA de sesiones de chat (pestañas). Usa MongoDB si está
// conectado; si no (o si una operación falla), degrada a un store en memoria sin
// romper — la conversación viva no depende de esto (decisiones.md "Puente del
// Chat": lean, Mongo opcional).
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { ChatSessionModel } from '../models/ChatSession.js';

/** Forma que consume el cliente (id como string, fechas ISO). */
export interface ChatSessionDto {
  id: string;
  title: string;
  claudeSessionId: string | null;
  cwd: string | null;
  createdAt: string;
  updatedAt: string;
}

/** ¿Hay conexión Mongo lista para usar? (1 = connected). */
function mongoReady(): boolean {
  return mongoose.connection.readyState === 1;
}

// --- Fallback en memoria (proceso) ---------------------------------------
const memory = new Map<string, ChatSessionDto>();

function memCreate(title: string, cwd: string | null): ChatSessionDto {
  const now = new Date().toISOString();
  const dto: ChatSessionDto = {
    id: randomUUID(),
    title,
    claudeSessionId: null,
    cwd,
    createdAt: now,
    updatedAt: now,
  };
  memory.set(dto.id, dto);
  return dto;
}

function memList(): ChatSessionDto[] {
  return [...memory.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// --- Mapeo de documento Mongo → DTO --------------------------------------
function toDto(doc: {
  _id: unknown;
  title: string;
  claudeSessionId?: string | null;
  cwd?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}): ChatSessionDto {
  return {
    id: String(doc._id),
    title: doc.title,
    claudeSessionId: doc.claudeSessionId ?? null,
    cwd: doc.cwd ?? null,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    updatedAt: (doc.updatedAt ?? new Date()).toISOString(),
  };
}

/** Lista las sesiones (más recientes primero). */
export async function listSessions(): Promise<ChatSessionDto[]> {
  if (!mongoReady()) return memList();
  try {
    const docs = await ChatSessionModel.find().sort({ updatedAt: -1 }).lean().exec();
    return docs.map(toDto);
  } catch {
    return memList();
  }
}

/** Crea una sesión con título y cwd. */
export async function createSession(title: string, cwd: string | null): Promise<ChatSessionDto> {
  const safeTitle = title.trim() || 'new chat';
  if (!mongoReady()) return memCreate(safeTitle, cwd);
  try {
    const doc = await ChatSessionModel.create({ title: safeTitle, cwd });
    return toDto(doc.toObject());
  } catch {
    return memCreate(safeTitle, cwd);
  }
}

/** Borra una sesión por id. Devuelve true si existía. */
export async function deleteSession(id: string): Promise<boolean> {
  if (!mongoReady()) return memory.delete(id);
  try {
    const res = await ChatSessionModel.deleteOne({ _id: id }).exec();
    return res.deletedCount > 0;
  } catch {
    return memory.delete(id);
  }
}
