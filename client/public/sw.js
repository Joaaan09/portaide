/* PortaIDE — Service Worker.
 *
 * ALCANCE DELIBERADAMENTE MÍNIMO: este SW existe SOLO para recibir Web Push.
 * No cachea nada, no intercepta `fetch` y NO convierte la app en offline-first
 * (PortaIDE sin servidor no sirve para nada: el filesystem, el pty y Claude viven
 * en el VPS). Cualquier precaching aquí solo añadiría versiones "pegadas".
 *
 * iOS (16.4+): Safari únicamente entrega push si la PWA está instalada en la
 * pantalla de inicio, y NO existe el push silencioso: cada trama que llega DEBE
 * acabar en un `showNotification` o el navegador penaliza la suscripción. Por eso
 * aquí siempre se muestra algo, incluso si el payload viene vacío o corrupto.
 */

// Activación inmediata: al ser un SW sin caché no hay nada que migrar, y así una
// versión nueva no espera a que se cierren todas las pestañas.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/** Aviso de reserva si el payload no se puede leer (nunca dejar al usuario sin nada). */
const FALLBACK = {
  kind: 'done',
  title: 'PortaIDE',
  body: 'Novedades en tu conversación con Claude.',
  tag: 'portaide',
}

self.addEventListener('push', (event) => {
  let payload = FALLBACK
  try {
    const data = event.data ? event.data.json() : null
    if (data && typeof data === 'object') {
      payload = {
        kind: typeof data.kind === 'string' ? data.kind : FALLBACK.kind,
        title: typeof data.title === 'string' && data.title ? data.title : FALLBACK.title,
        body: typeof data.body === 'string' ? data.body : '',
        tag: typeof data.tag === 'string' && data.tag ? data.tag : FALLBACK.tag,
        sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
      }
    }
  } catch {
    payload = FALLBACK
  }

  // `tag` = sessionId: el aviso de "terminó" REEMPLAZA al de "sigue trabajando"
  // de esa misma sesión en vez de acumularse. `renotify` solo cuando el estado
  // final merece volver a sonar (terminó / falló), no al repetir "trabajando".
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      renotify: payload.kind === 'done' || payload.kind === 'error',
      icon: '/icon-192.png',
      badge: '/favicon-48.png',
      data: { sessionId: payload.sessionId, kind: payload.kind },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const sessionId = (event.notification.data && event.notification.data.sessionId) || null

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      // ¿La PWA ya está abierta? Se enfoca y se le pide navegar al Chat de esa
      // sesión por postMessage (la app no usa rutas: la vista es estado en memoria).
      for (const client of clientList) {
        if (new URL(client.url).origin !== self.location.origin) continue
        client.postMessage({ type: 'portaide:open-chat', sessionId })
        if ('focus' in client) {
          await client.focus()
          return
        }
      }

      // Arranque en frío: la sesión viaja en la URL y el cliente la consume al
      // montar (client/src/lib/push.ts · consumeChatDeepLink).
      const url = sessionId ? `/?chat=${encodeURIComponent(sessionId)}` : '/'
      await self.clients.openWindow(url)
    })()
  )
})
