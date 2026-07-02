// SettingsRow — fila de una card de Settings (DESIGN.md §10). Dos disposiciones:
// - 'inline'  (default): label a la izquierda, contenido/valor a la derecha.
// - 'stacked': label arriba, contenido debajo a lo ancho (para controles anchos
//   como los swatches de tema).
import type { ReactNode } from 'react'
import styles from './SettingsView.module.css'

interface SettingsRowProps {
  label: string
  children?: ReactNode
  layout?: 'inline' | 'stacked'
}

export default function SettingsRow({ label, children, layout = 'inline' }: SettingsRowProps) {
  return (
    <div className={layout === 'stacked' ? styles.rowStacked : styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      {children}
    </div>
  )
}
