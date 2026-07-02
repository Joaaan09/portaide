// SettingsGroup — bloque "lista agrupada" de Settings (DESIGN.md §10): eyebrow
// mono en --faint + card --surface con filas separadas por 1px --border.
import type { ReactNode } from 'react'
import styles from './SettingsView.module.css'

interface SettingsGroupProps {
  /** Título del grupo (se pinta como eyebrow en mayúsculas). */
  label: string
  children: ReactNode
}

export default function SettingsGroup({ label, children }: SettingsGroupProps) {
  const eyebrowId = `settings-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section className={styles.section} aria-labelledby={eyebrowId}>
      <p id={eyebrowId} className={styles.eyebrow}>
        {label}
      </p>
      <div className={styles.card}>{children}</div>
    </section>
  )
}
