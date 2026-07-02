// Vista Login (DESIGN.md §15) — puerta del borde de seguridad (CLAUDE.md §11).
// Card centrada con marca + email/contraseña; maneja error y carga.
import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { ApiError } from '../../api/client'
import styles from './LoginView.module.css'

// Traduce el código de error del backend a un mensaje de UI (inglés, como el
// resto de la app / mockup). Mismo texto para email o contraseña mal.
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_credentials':
        return 'Invalid email or password.'
      case 'missing_fields':
        return 'Enter your email and password.'
      case 'too_many_attempts':
        return 'Too many attempts. Try again in a few minutes.'
      case 'auth_not_configured':
        return 'Login is not configured on the server.'
      default:
        return 'Could not sign in. Try again.'
    }
  }
  return 'Network error. Check your connection.'
}

export default function LoginView() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      await login(email, password)
      // Éxito: AuthProvider pasa a 'authed' y App remonta a la app.
    } catch (err) {
      setError(errorMessage(err))
      setLoading(false)
    }
  }

  return (
    <main className={styles.screen}>
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.card}>
        <div className={styles.brand}>
          <img
            className={styles.logo}
            src="/portaide-icon.svg"
            alt=""
            width={44}
            height={44}
            aria-hidden="true"
          />
          <h1 className={styles.wordmark}>PortaIDE</h1>
          <p className={styles.tagline}>Code on your VPS from anywhere.</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className={styles.input}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              disabled={loading}
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className={styles.input}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              enterKeyHint="go"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button className={styles.submit} type="submit" disabled={!canSubmit}>
            {loading && <span className={styles.spinner} aria-hidden="true" />}
            <span>{loading ? 'Signing in…' : 'Sign in'}</span>
          </button>
        </form>
      </div>
    </main>
  )
}
