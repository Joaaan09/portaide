// Conexión a MongoDB — OPCIONAL y con reintentos.
// En desarrollo la UI no necesita DB: si no hay MONGODB_URI se avisa y la app
// sigue funcionando. Nunca hacemos process.exit por falta de DB en dev.
import mongoose from 'mongoose';
import { env } from '../config/env.js';

const RETRY_DELAY_MS = 5_000;

/**
 * Intenta conectar a Mongo en segundo plano. Si falla, reintenta cada
 * RETRY_DELAY_MS sin bloquear el arranque del servidor HTTP.
 */
export function connectMongo(): void {
  if (!env.mongodbUri) {
    console.warn(
      '[mongo] MONGODB_URI no definida — arrancando SIN base de datos (ok en dev; sesiones/ajustes no persisten).'
    );
    return;
  }

  const uri = env.mongodbUri;
  let attempt = 0;

  const tryConnect = async (): Promise<void> => {
    attempt += 1;
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
      console.log('[mongo] conectado');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mongo] fallo de conexión (intento ${attempt}): ${message} — reintento en ${RETRY_DELAY_MS / 1000}s`
      );
      setTimeout(tryConnect, RETRY_DELAY_MS);
    }
  };

  mongoose.connection.on('disconnected', () => {
    console.warn('[mongo] desconectado (mongoose reintentará por su cuenta)');
  });

  void tryConnect();
}
