// Rutas de autenticación. login/logout son públicas; /me va protegida con
// requireAuth. El login está rate-limited por IP para frenar fuerza bruta.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { isAuthConfigured, verifyCredentials } from './credentials.js';
import { issueToken } from './session.js';
import { requireAuth } from './middleware.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// 10 intentos por IP cada 15 min. `standardHeaders` expone RateLimit-* al cliente.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' },
});

export const authRouter = Router();

authRouter.post('/login', loginLimiter, async (req, res) => {
  // Login no configurado en el servidor → 503 (no es culpa del cliente).
  if (!isAuthConfigured()) {
    res.status(503).json({ error: 'auth_not_configured' });
    return;
  }

  const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
  const { email, password } = body;
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  const ok = await verifyCredentials(email, password);
  if (!ok) {
    // Mismo mensaje para email o contraseña mal: no filtramos cuál falló.
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }

  const sessionEmail = email.trim().toLowerCase();
  const token = issueToken({ email: sessionEmail });
  res.cookie(env.cookieName, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: THIRTY_DAYS_MS,
  });
  res.json({ email: sessionEmail });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(env.cookieName, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ email: req.user?.email });
});
