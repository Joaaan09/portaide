// App Express: middlewares base y montaje de rutas de la API.
// El orden de montaje es el borde de seguridad (CLAUDE.md §11): todo lo que
// cuelga tras el GATE requiere sesión válida.
import express from 'express';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health.js';
import { authRouter } from './auth/routes.js';
import { requireAuth } from './auth/middleware.js';
import { fsRouter } from './fs/routes.js';
import { chatRouter } from './chat/routes.js';
import { systemRouter } from './system/routes.js';

export function createApp(): express.Express {
  const app = express();

  // NPM (Nginx Proxy Manager) termina TLS por delante. Confiar en 1 proxy para
  // que req.ip (rate-limit) y `secure` reflejen la conexión real del cliente.
  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(cookieParser());

  // --- Orden de montaje (CRÍTICO) -----------------------------------------
  app.use('/api/health', healthRouter); // PÚBLICO
  app.use('/api/auth', authRouter); // login/logout públicos; /me protegido dentro

  // GATE: todo lo que se monte DEBAJO de esta línea hereda requireAuth.
  app.use('/api', requireAuth);

  // Los routers de features (fs, terminal, chat) se montan AQUÍ DEBAJO para
  // heredar el gate de autenticación (llegan en fases posteriores).
  app.use('/api/fs', fsRouter); // filesystem local (árbol, leer, escribir)
  app.use('/api/chat', chatRouter); // lista de sesiones de chat (pestañas)
  app.use('/api/system', systemRouter); // panel System de Settings (estado real)

  return app;
}
