// Modelo de una sesión de chat = una pestaña de la cabecera del Chat (DESIGN.md
// §6). Persiste sólo la META (título, cwd, claudeSessionId), NO los mensajes: el
// contexto de la conversación ya lo guarda el engine en ~/.claude y se reanuda
// con `resume` (decisiones.md "Puente del Chat"). Mongo es opcional: si está
// caído, el store degrada a memoria (ver chat/store.ts).
import mongoose, { type InferSchemaType, type Model } from 'mongoose';

const chatSessionSchema = new mongoose.Schema(
  {
    /** Título mostrado en la pestaña (p.ej. el primer mensaje, recortado). */
    title: { type: String, required: true },
    /** session_id de Claude para reanudar (`resume`); se rellena tras el 1er turno. */
    claudeSessionId: { type: String, default: null },
    /** Carpeta de trabajo activa con la que se abrió la conversación. */
    cwd: { type: String, default: null },
  },
  { timestamps: true } // createdAt / updatedAt
);

export type ChatSessionDoc = InferSchemaType<typeof chatSessionSchema>;

// `mongoose.models.X ?? model(...)` evita "OverwriteModelError" en hot-reload
// (tsx watch). Se tipa explícitamente para que `.find`/`.create` sean invocables
// (si no, la unión con el Model genérico de `models.X` los hace no-callable).
export const ChatSessionModel: Model<ChatSessionDoc> =
  (mongoose.models.ChatSession as Model<ChatSessionDoc> | undefined) ??
  mongoose.model<ChatSessionDoc>('ChatSession', chatSessionSchema);
