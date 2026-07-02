// Splash — pantalla sobria mientras se resuelve la sesión inicial
// (GET /api/auth/me). DESIGN.md §15: --bg + glow + spinner de acento.
import styles from './Splash.module.css'

export default function Splash() {
  return (
    <div className={styles.screen} role="status" aria-label="Cargando PortaIDE">
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.spinner} aria-hidden="true" />
    </div>
  )
}
