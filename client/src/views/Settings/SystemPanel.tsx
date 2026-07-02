// SystemPanel — estado real del backend (GET /api/system) para Settings → System
// (DESIGN.md §10; sustituye al 'VPS Connection' del mock — v1 no usa SSH). Filas
// display: label a la izquierda, valor mono a la derecha. Estados de carga
// (skeleton) y error (mensaje discreto) sin bloquear el resto de la vista.
import { useEffect, useState } from 'react'
import { getSystemInfo, type SystemInfo } from '../../api/client'
import SettingsRow from './SettingsRow'
import styles from './SettingsView.module.css'

/** Segundos de uptime → texto legible ("3d 1h", "4h 12m", "5m 20s", "42s"). */
function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: SystemInfo }

/** Etiquetas de las filas (también sirven de plantilla del skeleton). */
const ROW_LABELS = ['Backend', 'Node', 'Claude CLI', 'Workspace', 'Database'] as const

export default function SystemPanel() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    getSystemInfo()
      .then((data) => {
        if (alive) setState({ status: 'ready', data })
      })
      .catch(() => {
        if (alive) setState({ status: 'error' })
      })
    return () => {
      alive = false
    }
  }, [])

  if (state.status === 'loading') {
    return (
      <>
        {ROW_LABELS.map((label) => (
          <SettingsRow key={label} label={label}>
            <span className={styles.skeletonBar} aria-hidden="true" />
          </SettingsRow>
        ))}
      </>
    )
  }

  if (state.status === 'error') {
    return (
      <p className={styles.systemError} role="alert">
        Couldn&apos;t load system status.
      </p>
    )
  }

  const { backend, claude, workspace, database } = state.data
  return (
    <>
      <SettingsRow label="Backend">
        <span className={styles.rowValue}>{formatUptime(backend.uptimeSeconds)}</span>
      </SettingsRow>
      <SettingsRow label="Node">
        <span className={styles.rowValue}>{backend.node}</span>
      </SettingsRow>
      <SettingsRow label="Claude CLI">
        <span className={styles.rowValue}>{claude.version ?? '—'}</span>
      </SettingsRow>
      <SettingsRow label="Workspace">
        <span className={styles.rowValue}>{workspace.fsRoot}</span>
      </SettingsRow>
      <SettingsRow label="Database">
        <span className={`${styles.rowValue} ${database.ok ? styles.stateOk : styles.stateBad}`}>
          {database.ok ? 'SQLite' : 'Error'}
        </span>
      </SettingsRow>
    </>
  )
}
