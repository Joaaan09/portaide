// Vista Settings (CLAUDE.md §3, DESIGN.md §10/§15). Solo la sección "Account"
// es funcional (email de la sesión + logout); el resto llega en Fase 2.
import { useAuth } from '../../auth/AuthProvider'
import styles from './SettingsView.module.css'

export default function SettingsView() {
  const { email, logout } = useAuth()

  return (
    <main className={styles.view}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
      </header>

      <div className={styles.body}>
        {/* --- Account (sección real) --- */}
        <section className={styles.section} aria-labelledby="settings-account">
          <p id="settings-account" className={styles.eyebrow}>
            Account
          </p>
          <div className={styles.card}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Signed in as</span>
              <span className={styles.rowValue}>{email ?? '—'}</span>
            </div>
            <div className={styles.rowAction}>
              <button
                type="button"
                className={styles.logout}
                onClick={() => {
                  void logout()
                }}
              >
                Log out
              </button>
            </div>
          </div>
        </section>

        {/* --- Resto: stub (Fase 2) --- */}
        <section className={styles.section}>
          <p className={styles.eyebrow}>VPS Connection · Claude Code · Appearance</p>
          <p className={styles.note}>
            Próximamente — Fase 2: conexión al VPS, configuración de Claude Code (modelo, permisos)
            y apariencia (tema, tamaño de fuente).
          </p>
        </section>
      </div>
    </main>
  )
}
