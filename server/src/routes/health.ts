// Salud del servicio (PÚBLICO): la usan el HEALTHCHECK de Docker y el compose.
import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'portaide', uptime: process.uptime() });
});
