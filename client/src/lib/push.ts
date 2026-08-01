// Web Push en el cliente: registro del Service Worker, alta/baja de la
// suscripción y preferencias. Sin React (lo consume Settings y App).
//
// Restricciones de iOS que condicionan TODO este módulo (decisiones.md ·
// "Notificaciones push en iOS"):
//   1. Safari solo entrega push si la PWA está INSTALADA en la pantalla de inicio
//      (iOS 16.4+). En una pestaña normal, `PushManager` puede no existir: hay que
//      detectarlo y explicarlo, nunca fallar en silencio.
//   2. `Notification.requestPermission()` tiene que salir de un GESTO del usuario
//      (un botón), jamás al cargar la app.
//   3. No hay notificaciones silenciosas: todo push suena y vibra. Por eso el
//      filtrado de qué avisos quiere el usuario se hace en el SERVIDOR (prefs) y
//      "está trabajando" viene desactivado por defecto.
import { api } from '../api/client'

/** Qué avisos quiere este dispositivo. */
export interface PushPrefs {
  /** "Claude ha terminado" — activado por defecto. */
  done: boolean
  /** "Claude sigue trabajando" — desactivado por defecto (en iOS suena). */
  working: boolean
}

export const DEFAULT_PREFS: PushPrefs = { done: true, working: false }

/** Motivos por los que activar el push puede fallar (la UI los traduce). */
export type PushErrorCode =
  | 'unsupported' // el navegador no expone Notification/SW/PushManager
  | 'not_standalone' // iOS en pestaña de Safari: hay que instalar la PWA
  | 'denied' // el usuario denegó el permiso (o ya estaba denegado)
  | 'server_disabled' // el backend no tiene claves VAPID
  | 'failed' // fallo al registrar el SW o al suscribirse

export class PushError extends Error {
  readonly code: PushErrorCode
  constructor(code: PushErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'PushError'
    this.code = code
  }
}

const LS_PREFS = 'portaide:push:prefs'
/** Misma clave que usa el chat para su pestaña activa (solo se ESCRIBE aquí). */
const LS_CHAT_ACTIVE = 'portaide:chat:activeId'

// --- Preferencias (espejo local para pintar la UI al instante) --------------

export function readPrefs(): PushPrefs {
  try {
    const raw = window.localStorage.getItem(LS_PREFS)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<PushPrefs>
    return {
      done: typeof parsed.done === 'boolean' ? parsed.done : DEFAULT_PREFS.done,
      working: typeof parsed.working === 'boolean' ? parsed.working : DEFAULT_PREFS.working,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function writePrefs(prefs: PushPrefs): void {
  try {
    window.localStorage.setItem(LS_PREFS, JSON.stringify(prefs))
  } catch {
    /* modo privado / cuota: la fuente de verdad es el servidor */
  }
}

// --- Capacidades del entorno ------------------------------------------------

/** ¿La app corre como PWA instalada (requisito de iOS para recibir push)? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone === true
}

/** ¿El navegador tiene las tres piezas necesarias (SW + Push + Notification)? */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Permiso actual, o 'unsupported' si el navegador no tiene Notification. */
export function getPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

// --- Service Worker ---------------------------------------------------------

/**
 * Registra `/sw.js` (idempotente: el navegador reutiliza el registro existente).
 * Se llama al arrancar la app; no pide permisos ni suscribe nada por sí solo.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch {
    return null
  }
}

/** Registro ya activo y listo (o null si no hay SW). */
async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await registerServiceWorker())
  if (!reg) return null
  // `ready` garantiza que hay un SW ACTIVO antes de tocar pushManager.
  return navigator.serviceWorker.ready
}

// --- Suscripción ------------------------------------------------------------

interface PushConfig {
  enabled: boolean
  publicKey: string | null
}

export const getPushConfig = (): Promise<PushConfig> => api.get<PushConfig>('/push/public-key')

/** base64url (VAPID) → Uint8Array, que es lo que espera `applicationServerKey`. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(normalized)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

/** ¿La suscripción existente se hizo con OTRA clave VAPID (rotación)? */
function keyChanged(sub: PushSubscription, publicKey: string): boolean {
  const current = sub.options.applicationServerKey
  if (!current) return true
  const expected = urlBase64ToUint8Array(publicKey)
  const actual = new Uint8Array(current)
  if (actual.length !== expected.length) return true
  return actual.some((byte, i) => byte !== expected[i])
}

/** Suscripción actual de este navegador, o null. */
export async function getSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await readyRegistration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

/** ¿Este dispositivo ya está suscrito? */
export async function isSubscribed(): Promise<boolean> {
  return (await getSubscription()) !== null
}

/**
 * Activa las notificaciones. DEBE llamarse desde un gesto del usuario (iOS exige
 * que `requestPermission` salga de un click). Pide permiso → registra el SW →
 * se suscribe → guarda la suscripción y las prefs en el servidor.
 */
export async function enablePush(prefs: PushPrefs): Promise<void> {
  if (!pushSupported()) {
    // En iOS, fuera de la PWA instalada ni siquiera existe PushManager: el motivo
    // real es ese, y es el que hay que contarle al usuario.
    throw new PushError(isStandalone() ? 'unsupported' : 'not_standalone')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushError('denied')

  const config = await getPushConfig()
  if (!config.enabled || !config.publicKey) throw new PushError('server_disabled')

  const reg = await readyRegistration()
  if (!reg) throw new PushError('failed', 'no se pudo registrar el service worker')

  let sub = await reg.pushManager.getSubscription()
  // Suscripción vieja con otra clave VAPID → se descarta y se rehace.
  if (sub && keyChanged(sub, config.publicKey)) {
    try {
      await api.post('/push/unsubscribe', { endpoint: sub.endpoint })
    } catch {
      /* el servidor la limpiará al primer 410 */
    }
    await sub.unsubscribe()
    sub = null
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      // Obligatorio (y además iOS no admite push silencioso).
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey) as BufferSource,
    })
  }

  await api.post('/push/subscribe', { subscription: sub.toJSON(), prefs })
  writePrefs(prefs)
}

/** Da de baja este dispositivo (servidor primero, luego el navegador). */
export async function disablePush(): Promise<void> {
  const sub = await getSubscription()
  if (!sub) return
  try {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint })
  } catch {
    /* si el servidor no responde, al menos se corta en el navegador */
  }
  await sub.unsubscribe()
}

/** Propaga un cambio de toggle al servidor (el filtrado es server-side). */
export async function syncPrefs(prefs: PushPrefs): Promise<void> {
  writePrefs(prefs)
  const sub = await getSubscription()
  if (!sub) return
  await api.post('/push/subscribe', { subscription: sub.toJSON(), prefs })
}

export interface PushTestResult {
  ok: boolean
  sent: number
  removed: number
  failed: number
}

/** Aviso de prueba (no espera a ningún turno). */
export const sendTestPush = (): Promise<PushTestResult> =>
  api.post<PushTestResult>('/push/test')

// --- Navegación desde la notificación --------------------------------------

/**
 * Deja `sessionId` como pestaña activa del chat. El store del chat lee esta clave
 * al cargar la lista de sesiones, así que solo tiene efecto garantizado en un
 * arranque en frío; con la app ya abierta, además se emite el evento
 * `portaide:open-chat-session` (ver PushNavigation).
 */
export function setActiveChatSession(sessionId: string): void {
  try {
    window.localStorage.setItem(LS_CHAT_ACTIVE, sessionId)
  } catch {
    /* modo privado / cuota: se navega igual a la vista de Chat */
  }
}

/**
 * Arranque en frío desde una notificación: el SW abre `/?chat=<sessionId>`.
 * Se deja el id como pestaña activa del chat ANTES de que el store cargue la
 * lista y se limpia la URL (la app no usa rutas). Devuelve el id si lo había.
 */
export function consumeChatDeepLink(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('chat')
    if (!sessionId) return null
    setActiveChatSession(sessionId)
    params.delete('chat')
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
    return sessionId
  } catch {
    return null
  }
}

/**
 * App ya abierta: el SW manda `portaide:open-chat` al tocar la notificación.
 * Devuelve la función de baja del listener.
 */
export function onPushNavigate(handler: (sessionId: string | null) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {}
  const listener = (event: MessageEvent): void => {
    const data = event.data as { type?: unknown; sessionId?: unknown } | null
    if (!data || data.type !== 'portaide:open-chat') return
    handler(typeof data.sessionId === 'string' ? data.sessionId : null)
  }
  navigator.serviceWorker.addEventListener('message', listener)
  return () => navigator.serviceWorker.removeEventListener('message', listener)
}
