// NotificationsPanel — Settings → Notificaciones (DESIGN.md §10.1).
// Gobierna las notificaciones Web Push del chat: estado del permiso, alta/baja de
// la suscripción, qué avisos se quieren y un envío de prueba.
//
// Reglas de plataforma que se ven en esta UI (decisiones.md · "Notificaciones
// push en iOS"): el permiso SOLO se pide desde el botón (gesto del usuario), y si
// la PWA no está instalada en la pantalla de inicio iOS no entrega nada — se
// explica, no se falla en silencio.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import Switch from '../../components/Switch/Switch'
import {
  PushError,
  disablePush,
  enablePush,
  getPermission,
  isStandalone,
  isSubscribed,
  pushSupported,
  readPrefs,
  sendTestPush,
  syncPrefs,
  type PushErrorCode,
  type PushPrefs,
} from '../../lib/push'
import SettingsRow from './SettingsRow'
import shared from './SettingsView.module.css'
import styles from './NotificationsPanel.module.css'

/** Mensajes de error por código (DESIGN.md §10.1: sobrios, sin alarmismo). */
const ERROR_TEXT: Record<PushErrorCode, string> = {
  unsupported: 'Este navegador no admite notificaciones push.',
  not_standalone: 'Añade PortaIDE a la pantalla de inicio para poder activarlas.',
  denied: 'Permiso denegado. Actívalo en los ajustes de notificaciones del sistema.',
  server_disabled: 'El servidor no tiene claves VAPID configuradas.',
  failed: 'No se pudieron activar las notificaciones.',
}

/** Errores del backend en el envío de prueba. */
function testErrorText(code: string): string {
  if (code === 'no_subscriptions') return 'No hay ningún dispositivo suscrito.'
  if (code === 'push_disabled') return 'El servidor no tiene el push configurado.'
  return 'No se pudo enviar la notificación de prueba.'
}

export default function NotificationsPanel() {
  const supported = pushSupported()
  const standalone = isStandalone()

  const [permission, setPermission] = useState(getPermission())
  const [subscribed, setSubscribed] = useState(false)
  const [prefs, setPrefs] = useState<PushPrefs>(() => readPrefs())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<PushErrorCode | null>(null)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)

  const testTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Estado real de la suscripción de ESTE navegador (el permiso no basta: la
  // suscripción puede haberse dado de baja desde otro sitio).
  useEffect(() => {
    let alive = true
    void isSubscribed().then((value) => {
      if (alive) setSubscribed(value)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (testTimer.current) clearTimeout(testTimer.current)
    }
  }, [])

  /** El resultado de la prueba se limpia solo (no es estado permanente). */
  const flashTest = useCallback((value: { ok: boolean; text: string }) => {
    setTest(value)
    if (testTimer.current) clearTimeout(testTimer.current)
    testTimer.current = setTimeout(() => setTest(null), 6000)
  }, [])

  const handleEnable = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await enablePush(prefs)
      setSubscribed(true)
    } catch (err) {
      setError(err instanceof PushError ? err.code : 'failed')
    } finally {
      setPermission(getPermission())
      setBusy(false)
    }
  }

  const handleDisable = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await disablePush()
      setSubscribed(false)
    } catch {
      setError('failed')
    } finally {
      setBusy(false)
    }
  }

  /** Cambio de toggle: optimista, y se revierte si el servidor no lo acepta. */
  const handleToggle = (key: keyof PushPrefs, value: boolean): void => {
    const previous = prefs
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    void syncPrefs(next).catch(() => {
      setPrefs(previous)
      setError('failed')
    })
  }

  const handleTest = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await sendTestPush()
      flashTest(
        result.sent > 0
          ? { ok: true, text: `Enviada a ${result.sent} dispositivo${result.sent === 1 ? '' : 's'}.` }
          : { ok: false, text: 'No se pudo entregar en ningún dispositivo.' }
      )
    } catch (err) {
      flashTest({ ok: false, text: testErrorText(err instanceof ApiError ? err.code : '') })
    } finally {
      setBusy(false)
    }
  }

  // --- Estado que se pinta en la primera fila ---
  let statusText = 'Desactivadas'
  let statusClass = ''
  if (!supported) {
    statusText = 'No disponible'
    statusClass = shared.stateBad
  } else if (permission === 'denied') {
    statusText = 'Permiso denegado'
    statusClass = shared.stateBad
  } else if (subscribed) {
    statusText = 'Activadas'
    statusClass = shared.stateOk
  }

  const canEnable = supported && permission !== 'denied' && !busy

  return (
    <>
      <SettingsRow label="Estado">
        <span className={`${shared.rowValue} ${statusClass}`}>{statusText}</span>
      </SettingsRow>

      {/* iOS solo entrega push a la PWA instalada: se explica siempre que no lo esté. */}
      {!standalone && (
        <p className={styles.hint}>
          En iPhone las notificaciones solo llegan con la app instalada:{' '}
          <span className={styles.gesture}>Compartir › Añadir a pantalla de inicio</span>.
        </p>
      )}

      <div className={shared.rowAction}>
        {subscribed ? (
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={busy}
            onClick={() => {
              void handleDisable()
            }}
          >
            {busy ? 'Desactivando…' : 'Desactivar notificaciones'}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={!canEnable}
            onClick={() => {
              void handleEnable()
            }}
          >
            {busy ? 'Activando…' : 'Activar notificaciones'}
          </button>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {ERROR_TEXT[error]}
          </p>
        )}
      </div>

      <div className={subscribed ? styles.toggleRow : `${styles.toggleRow} ${styles.toggleRowOff}`}>
        <span className={styles.toggleText}>
          <span id="push-done" className={shared.rowLabel}>
            Terminó
          </span>
          <span className={styles.help}>Cuando Claude acaba el turno o falla.</span>
        </span>
        <Switch
          checked={prefs.done}
          disabled={!subscribed}
          labelledBy="push-done"
          onChange={(next) => handleToggle('done', next)}
        />
      </div>

      <div className={subscribed ? styles.toggleRow : `${styles.toggleRow} ${styles.toggleRowOff}`}>
        <span className={styles.toggleText}>
          <span id="push-working" className={shared.rowLabel}>
            Está trabajando
          </span>
          <span className={styles.help}>Si sales con un turno en marcha. En iOS suena y vibra.</span>
        </span>
        <Switch
          checked={prefs.working}
          disabled={!subscribed}
          labelledBy="push-working"
          onChange={(next) => handleToggle('working', next)}
        />
      </div>

      <div className={shared.rowAction}>
        <button
          type="button"
          className={styles.secondaryBtn}
          disabled={!subscribed || busy}
          onClick={() => {
            void handleTest()
          }}
        >
          Enviar notificación de prueba
        </button>
        {test && (
          <p className={test.ok ? styles.testOk : styles.testBad} role="status">
            {test.text}
          </p>
        )}
      </div>
    </>
  )
}
