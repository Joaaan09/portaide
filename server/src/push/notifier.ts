// Cableado de los avisos push a los hooks del chat (chat/runtime.ts).
//
// Dos momentos, y solo dos (en iOS TODA notificación suena y vibra: se notifica
// poco y bien — decisiones.md · "Notificaciones push en iOS"):
//
//   1. "Sigue trabajando" — el usuario se fue (cerró la app / bloqueó el móvil)
//      y el turno sigue vivo. El debounce (~20 s) lo aplica el runtime.
//   2. "Terminó" / "Falló" — el turno acabó sin nadie mirando esa sesión.
//
// Ambos avisos comparten `tag` = sessionId: el de "terminó" REEMPLAZA al de
// "trabajando" en el centro de notificaciones en vez de acumularse.
import { runtimeManager } from '../chat/runtime.js';
import { sendPush, isPushEnabled, type PushPayload } from './service.js';

/** Título legible de la sesión para el cuerpo del aviso. */
function sessionLabel(title: string | undefined): string {
  const clean = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Conversación sin título';
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
}

/** Registra los hooks del RuntimeManager. Llamar UNA vez al arrancar (index.ts). */
export function wirePushNotifications(): void {
  runtimeManager.onBusyWithoutSubscribers((sessionId, title) => {
    const payload: PushPayload = {
      kind: 'working',
      title: 'Claude sigue trabajando',
      body: sessionLabel(title),
      tag: sessionId,
      sessionId,
    };
    void sendPush(payload, (prefs) => prefs.working);
  });

  runtimeManager.onIdleWithoutSubscribers((sessionId, title, status) => {
    const failed = status === 'error';
    const payload: PushPayload = {
      kind: failed ? 'error' : 'done',
      title: failed ? 'Claude se ha detenido por un error' : 'Claude ha terminado',
      body: sessionLabel(title),
      tag: sessionId,
      sessionId,
    };
    // El aviso de "terminó" es el que justifica todo el sistema: se manda a quien
    // lo tenga activado (por defecto, todos).
    void sendPush(payload, (prefs) => prefs.done);
  });

  if (!isPushEnabled()) {
    console.log('[push] hooks del chat cableados, pero sin claves VAPID no se enviará nada.');
  }
}
