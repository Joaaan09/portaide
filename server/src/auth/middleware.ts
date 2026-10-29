// Middleware de autenticación HTTP: lee la cookie de sesión, valida el JWT y
// deja `req.user` para los handlers, o responde 401. Protege todo lo que se
// monte tras él (ver app.ts, CLAUDE.md §11).
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { verifyToken } from './session.js';
import { isCrossSite } from './site.js';

// Extiende el Request de Express con el usuario de la sesión.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { email: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isCrossSite(req)) {
    res.status(403).json({ error: 'cross_site' });
    return;
  }
  const token = req.cookies?.[env.cookieName];
  const session = typeof token === 'string' ? verifyToken(token) : null;
  if (!session) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.user = { email: session.email };
  next();
}
