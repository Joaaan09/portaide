// ConnBanner — tira fina de estado de conexión (DESIGN.md §6.3). Patrón ÚNICO,
// compartido por el Chat (§6.3) y el Terminal (§9.1): mismo chasis, mismo copy,
// mismo motion y mismo retardo. Vive aquí para que cualquier cambio de §6.3 se
// haga en un solo sitio (CLAUDE.md §9: si un patrón de UI se repite, extráelo).
//
// Solo pinta algo cuando hay algo que decir: con la conexión sana la tira queda
// vacía (altura 0, cero ruido). Existe porque en móvil el WebSocket se queda
// zombi al volver del background y, sin esta señal, la vista parece "parada"
// aunque el trabajo siga vivo en el server.
import { useEffect, useState } from 'react'
import styles from './ConnBanner.module.css'

/** Estado del socket que entiende la tira. `error` se pinta como `closed`. */
export type ConnBannerStatus = 'connecting' | 'open' | 'closed' | 'error'

/** Retardo antes de anunciar un problema: un microcorte no debe pintar nada. */
export const CONN_DELAY_MS = 800

/**
 * Histéresis de §6.3: devuelve `true` solo si `active` se mantiene `delayMs`
 * seguidos, y vuelve a `false` al instante. Reconectar suele tardar ~200ms, así
 * que un microcorte (o el arranque de la app) no llega a pintar nada.
 *
 * Se exporta porque el Terminal la reutiliza para los puntos de sus pestañas:
 * la regla de "no chivar lo que se arregla solo" es la misma y se define aquí.
 */
export function useDelayedFlag(active: boolean, delayMs: number = CONN_DELAY_MS): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!active) {
      setOn(false)
      return
    }
    const t = window.setTimeout(() => setOn(true), delayMs)
    return () => window.clearTimeout(t)
  }, [active, delayMs])
  return on
}

interface ConnBannerProps {
  /** Estado del socket de la vista. */
  status: ConnBannerStatus
  /**
   * Mensaje de un fallo ajeno al socket (el Chat lo usa para "No se pudieron
   * cargar las conversaciones"). Solo se anuncia si el socket va bien: manda el
   * socket. Sin texto, no hay fallo que contar.
   */
  errorText?: string
  /** Sin handler la tira es informativa: no ofrece acción ni es pulsable. */
  onRetry?: () => void
  /** Etiqueta de la acción, a la derecha en `--accent`. */
  retryLabel?: string
}

export default function ConnBanner({
  status,
  errorText,
  onRetry,
  retryLabel = 'Reintentar',
}: ConnBannerProps) {
  // Prioridad: manda el socket; el fallo ajeno solo se comenta si el socket va bien.
  const down = status === 'closed' || status === 'error'
  const connecting = status === 'connecting'
  const failed = !down && !connecting && Boolean(errorText)
  const problem = down || connecting || failed

  const visible = useDelayedFlag(problem)

  // Reconectando es informativo (el server ya lo está intentando): sin acción.
  const actionable = Boolean(onRetry) && !connecting

  const label = connecting ? 'Reconectando…' : down ? 'Sin conexión con el servidor' : errorText

  const content = (
    <>
      <span
        className={`${styles.dot} ${down ? styles.dotDown : styles.dotWait}`}
        aria-hidden="true"
      />
      <span className={styles.label}>{label}</span>
      {actionable && <span className={styles.action}>{retryLabel}</span>}
    </>
  )

  // La región live vive SIEMPRE en el DOM (aunque vacía) para que el cambio de
  // estado se anuncie de verdad (DESIGN.md §6.3 / §12).
  return (
    <div className={styles.live} role="status" aria-live="polite">
      {!visible ? null : actionable ? (
        // Con acción: TODA la tira es el botón → target táctil de ancho
        // completo, cómodo a una mano (DESIGN.md §12).
        <button type="button" className={`${styles.bar} ${styles.barButton}`} onClick={onRetry}>
          {content}
        </button>
      ) : (
        <p className={styles.bar}>{content}</p>
      )}
    </div>
  )
}
