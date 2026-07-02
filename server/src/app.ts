// App Express: middlewares base y rutas HTTP de la API.
// Las rutas de FS/editor y la auth llegan en fases posteriores (CLAUDE.md §11:
// nada de FS/pty/chat sin sesión válida — pendiente de decidir el mecanismo).
import express from 'express';

export function createApp(): express.Express {
  const app = express();

  app.use(express.json());

  // Salud del servicio (la usan el HEALTHCHECK de Docker y el compose)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'portaide', uptime: process.uptime() });
  });

  return app;
}
