// Configuración de entorno: carga .env y expone las variables tipadas.
// PORT por defecto 4100 — elegido para no chocar con 3000/3900/4000/5000
// de otros proyectos del VPS.
import 'dotenv/config';

export const env = {
  /** Puerto HTTP del backend. */
  port: Number(process.env.PORT) || 4100,
  /** URI de MongoDB. Opcional: sin ella la app funciona (sin persistencia). */
  mongodbUri: process.env.MONGODB_URI || undefined,
  /** Entorno de ejecución. */
  nodeEnv: process.env.NODE_ENV || 'development',
} as const;

export const isProduction = env.nodeEnv === 'production';
