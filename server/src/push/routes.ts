// Router de Web Push. Se monta DEBAJO del gate de auth en app.ts → todo requiere
// sesión válida (CLAUDE.md §11): una suscripción push es un canal directo al
// móvil del usuario, no puede darse de alta desde fuera.
//
//   GET  /api/push/public-key   → clave pública VAPID + si el push está operativo
//   POST /api/push/subscribe    → alta/actualización de la suscripción + prefs
//   POST /api/push/unsubscribe  → baja por endpoint
//   POST /api/push/test         → aviso de prueba (no espera a ningún turno)
import { Router } from 'express';
import { getPublicKey, isPushEnabled, sendPush } from './service.js';
import {
  countSubscriptions,
  deleteSubscription,
  upsertSubscription,
  DEFAULT_PREFS,
  type PushPrefs,
} from './store.js';

export const pushRouter = Router();

/** Valida la forma de la suscripción que manda el navegador. */
function parseSubscription(
  raw: unknown
): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  if (!raw || typeof raw !== 'object') return null;
  const sub = raw as { endpoint?: unknown; keys?: unknown };
  if (typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) return null;
  if (!sub.keys || typeof sub.keys !== 'object') return null;
  const keys = sub.keys as { p256dh?: unknown; auth?: unknown };
  if (typeof keys.p256dh !== 'string' || !keys.p256dh) return null;
  if (typeof keys.auth !== 'string' || !keys.auth) return null;
  return { endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** Prefs del cuerpo con defaults (terminó = sí, trabajando = no). */
function parsePrefs(raw: unknown): PushPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const p = raw as { done?: unknown; working?: unknown };
  return {
    done: typeof p.done === 'boolean' ? p.done : DEFAULT_PREFS.done,
    working: typeof p.working === 'boolean' ? p.working : DEFAULT_PREFS.working,
  };
}

// --- GET /api/push/public-key --------------------------------------------
// `enabled:false` = el servidor no tiene claves VAPID: la UI lo dice en vez de
// dejar al usuario pulsando un botón que nunca funcionará.
pushRouter.get('/public-key', (_req, res) => {
  res.json({ enabled: isPushEnabled(), publicKey: getPublicKey() });
});

// --- POST /api/push/subscribe --------------------------------------------
// Alta O actualización (UPSERT por endpoint): el cliente reenvía la misma
// suscripción cuando cambia un toggle, así que este endpoint también es el que
// guarda las preferencias.
pushRouter.post('/subscribe', (req, res) => {
  const body = (req.body ?? {}) as { subscription?: unknown; prefs?: unknown };
  const subscription = parseSubscription(body.subscription);
  if (!subscription) {
    res.status(400).json({ error: 'bad_subscription' });
    return;
  }
  upsertSubscription(subscription, parsePrefs(body.prefs));
  res.status(201).json({ ok: true, enabled: isPushEnabled() });
});

// --- POST /api/push/unsubscribe ------------------------------------------
pushRouter.post('/unsubscribe', (req, res) => {
  const body = (req.body ?? {}) as { endpoint?: unknown };
  if (typeof body.endpoint !== 'string' || !body.endpoint) {
    res.status(400).json({ error: 'bad_endpoint' });
    return;
  }
  const existed = deleteSubscription(body.endpoint);
  res.json({ ok: true, existed });
});

// --- POST /api/push/test --------------------------------------------------
// Prueba de extremo a extremo sin esperar a un turno. Ignora las prefs a
// propósito (lo acaba de pedir el usuario con el dedo) y usa un tag propio para
// no pisar el aviso real de ninguna sesión.
pushRouter.post('/test', async (_req, res) => {
  if (!isPushEnabled()) {
    res.status(503).json({ error: 'push_disabled' });
    return;
  }
  if (countSubscriptions() === 0) {
    res.status(409).json({ error: 'no_subscriptions' });
    return;
  }
  const result = await sendPush(
    {
      kind: 'test',
      title: 'PortaIDE',
      body: 'Notificación de prueba — el push funciona.',
      tag: 'portaide-test',
    },
    () => true
  );
  res.json({ ok: result.sent > 0, ...result });
});
