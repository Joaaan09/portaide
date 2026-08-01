// Servicio de envío de Web Push (VAPID) — el "cartero" del sistema de avisos.
//
// Diseño (decisiones.md · "Notificaciones push en iOS"):
// - Un solo usuario ⇒ se envía a TODOS sus dispositivos suscritos, filtrando por
//   las preferencias de cada uno (`notify_done` / `notify_working`). El filtro es
//   server-side a la fuerza: iOS no tiene push silencioso, así que toda trama que
//   llegue al móvil se muestra sí o sí (el Service Worker no puede descartarla).
// - Sin claves VAPID el módulo queda DESACTIVADO: `sendPush` no falla, devuelve 0
//   enviados. El servidor arranca igual (el push es opcional, no parte del borde).
// - Higiene: un endpoint que responde 404/410 está muerto (PWA desinstalada,
//   suscripción caducada) → se borra de la tabla en el acto.
import webpush from 'web-push';
import { env } from '../config/env.js';
import {
  deleteSubscription,
  listSubscriptions,
  type PushPrefs,
} from './store.js';

/** Tipo de aviso. Lo usa el Service Worker para decidir el `renotify`. */
export type PushKind = 'working' | 'done' | 'error' | 'test';

/** Payload que viaja cifrado hasta el Service Worker (client/public/sw.js). */
export interface PushPayload {
  kind: PushKind;
  title: string;
  body: string;
  /** Mismo `tag` (= sessionId) para que "terminó" REEMPLACE a "sigue trabajando". */
  tag: string;
  /** Sesión de chat a la que navegar al tocar la notificación (si aplica). */
  sessionId?: string;
}

export interface PushSendResult {
  /** Entregas aceptadas por el servicio de push. */
  sent: number;
  /** Suscripciones muertas borradas en este envío (404/410). */
  removed: number;
  /** Fallos transitorios (se conservan para el próximo intento). */
  failed: number;
  /** Suscripciones que existen pero no querían este aviso (prefs). */
  skipped: number;
}

let configured = false;

/**
 * Configura VAPID una vez al arrancar (index.ts). Idempotente. Si falta alguna
 * de las tres variables, deja el push desactivado con un log claro y sigue.
 */
export function initPush(): void {
  if (configured) return;
  if (!env.pushEnabled || !env.vapidPublicKey || !env.vapidPrivateKey || !env.vapidSubject) {
    console.warn('[push] desactivado — faltan claves VAPID (ver .env.example).');
    return;
  }
  try {
    webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
    configured = true;
    console.log('[push] listo (VAPID configurado)');
  } catch (err) {
    // Subject mal formado (debe ser mailto: o https://) o claves inválidas.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[push] VAPID inválido — push DESACTIVADO: ${message}`);
  }
}

/** ¿Hay push operativo (claves válidas y configuradas)? */
export function isPushEnabled(): boolean {
  return configured;
}

/** Clave pública VAPID para el cliente (es pública por definición; no es secreta). */
export function getPublicKey(): string | null {
  return configured ? (env.vapidPublicKey ?? null) : null;
}

/** ¿El código HTTP del servicio de push significa "esta suscripción está muerta"? */
function isGone(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

/**
 * Envía un aviso a todos los dispositivos cuyas preferencias lo acepten.
 * `wants` decide por suscripción (p.ej. `(p) => p.done`). Nunca lanza: los
 * errores se registran y, si el endpoint está muerto, se borra.
 */
export async function sendPush(
  payload: PushPayload,
  wants: (prefs: PushPrefs) => boolean
): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, removed: 0, failed: 0, skipped: 0 };
  if (!configured) return result;

  let subs;
  try {
    subs = listSubscriptions();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[push] no se pudieron leer las suscripciones: ${message}`);
    return result;
  }

  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      if (!wants(sub.prefs)) {
        result.skipped += 1;
        return;
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body,
          // TTL 1h: si el móvil está sin red más de una hora, el aviso ya no
          // aporta nada (el estado real se ve al abrir la app). `urgency` normal.
          { TTL: 3600 }
        );
        result.sent += 1;
      } catch (err) {
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (isGone(statusCode)) {
          deleteSubscription(sub.endpoint);
          result.removed += 1;
          return;
        }
        result.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        // Nunca se logea el endpoint completo (contiene el id del dispositivo).
        console.warn(`[push] envío fallido (status ${statusCode ?? '?'}): ${message}`);
      }
    })
  );

  return result;
}
