// Store de las suscripciones de Web Push. Persistencia en SQLite (better-sqlite3,
// síncrono) vía db/sqlite.ts, en el mismo estilo que chat/store.ts: mapeo
// snake_case (fila) → camelCase (DTO) y UPSERT por la PK.
//
// La PK es el `endpoint` que emite el servicio de push del navegador: reinstalar
// la PWA o rotar las claves genera un endpoint nuevo, y el viejo acaba
// devolviendo 404/410 → lo borra el servicio de envío (service.ts).
//
// A diferencia del store del chat, las firmas son SÍNCRONAS: better-sqlite3 lo es
// y aquí no hay historia previa que respetar.
import { getDb } from '../db/sqlite.js';

/** Qué avisos quiere ESTE dispositivo (el filtrado es server-side, ver sqlite.ts). */
export interface PushPrefs {
  /** "Claude ha terminado" (activado por defecto). */
  done: boolean;
  /** "Claude sigue trabajando" (DESACTIVADO por defecto: en iOS suena y vibra). */
  working: boolean;
}

/** Suscripción tal y como la consume el servicio de envío. */
export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  prefs: PushPrefs;
  createdAt: string;
  updatedAt: string;
}

/** Preferencias por defecto (§ decisiones.md: "terminó" sí, "trabajando" no). */
export const DEFAULT_PREFS: PushPrefs = { done: true, working: false };

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  notify_done: number;
  notify_working: number;
  created_at: string;
  updated_at: string;
}

function toRecord(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
    prefs: { done: row.notify_done !== 0, working: row.notify_working !== 0 },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Todas las suscripciones registradas (un solo usuario: son SUS dispositivos). */
export function listSubscriptions(): PushSubscriptionRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM push_subscriptions ORDER BY created_at ASC')
    .all() as PushSubscriptionRow[];
  return rows.map(toRecord);
}

/** Cuántos dispositivos hay suscritos (para el feedback de la UI). */
export function countSubscriptions(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM push_subscriptions')
    .get() as { n: number };
  return row.n;
}

/**
 * Alta o actualización de una suscripción por `endpoint`. Se usa tanto al
 * activar las notificaciones como al cambiar un toggle (el cliente reenvía la
 * misma suscripción con las prefs nuevas). Conserva `created_at` en el update.
 */
export function upsertSubscription(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  prefs: PushPrefs
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions
         (endpoint, p256dh, auth, notify_done, notify_working, created_at, updated_at)
       VALUES (@endpoint, @p256dh, @auth, @notify_done, @notify_working, @created_at, @updated_at)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         notify_done = excluded.notify_done,
         notify_working = excluded.notify_working,
         updated_at = excluded.updated_at`
    )
    .run({
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      notify_done: prefs.done ? 1 : 0,
      notify_working: prefs.working ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
}

/** Baja de una suscripción. Devuelve true si existía. */
export function deleteSubscription(endpoint: string): boolean {
  const res = getDb()
    .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
    .run(endpoint);
  return res.changes > 0;
}
