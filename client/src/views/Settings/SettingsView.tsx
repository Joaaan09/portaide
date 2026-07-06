// Vista Settings (CLAUDE.md §3, DESIGN.md §10/§15). Grupos "lista agrupada":
// Account (sesión + logout), Appearance (tema + tamaño de fuente del editor) y
// System (estado real del backend). El mock trae 'VPS Connection', pero v1 no
// usa SSH: se sustituye por System (sin datos SSH).
import { useAuth } from '../../auth/AuthProvider'
import NavMenuButton from '../../components/NavMenuButton/NavMenuButton'
import SettingsGroup from './SettingsGroup'
import SettingsRow from './SettingsRow'
import ThemePicker from './ThemePicker'
import NavPicker from './NavPicker'
import FontSizeStepper from './FontSizeStepper'
import SystemPanel from './SystemPanel'
import styles from './SettingsView.module.css'

export default function SettingsView() {
  const { email, logout } = useAuth()

  return (
    <main className={styles.view}>
      <header className={styles.header}>
        <NavMenuButton />
        <h1 className={styles.title}>Settings</h1>
      </header>

      <div className={styles.body}>
        {/* --- Account --- */}
        <SettingsGroup label="Account">
          <SettingsRow label="Signed in as">
            <span className={styles.rowValue}>{email ?? '—'}</span>
          </SettingsRow>
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
        </SettingsGroup>

        {/* --- Appearance --- */}
        <SettingsGroup label="Appearance">
          <SettingsRow label="Theme" layout="stacked">
            <ThemePicker />
          </SettingsRow>
          <SettingsRow label="Editor font size">
            <FontSizeStepper />
          </SettingsRow>
          <SettingsRow label="Navigation" layout="stacked">
            <NavPicker />
          </SettingsRow>
        </SettingsGroup>

        {/* --- System (estado real del backend) --- */}
        <SettingsGroup label="System">
          <SystemPanel />
        </SettingsGroup>

        <p className={styles.footer}>PortaIDE</p>
      </div>
    </main>
  )
}
