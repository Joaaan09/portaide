// AuthProvider — estado global de sesión (CLAUDE.md §11).
// Al montar comprueba la sesión con GET /api/auth/me (401 → anónimo). Expone
// login/logout y el email de la sesión. Vive POR DEBAJO de ThemeProvider para
// que login y splash respeten el tema activo.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'

type AuthStatus = 'loading' | 'authed' | 'anon'

interface AuthContextValue {
  status: AuthStatus
  email: string | null
  /** Inicia sesión; lanza ApiError si las credenciales no son válidas. */
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [email, setEmail] = useState<string | null>(null)

  // Comprobación inicial de sesión (una vez al montar)
  useEffect(() => {
    let cancelled = false
    api
      .get<{ email: string }>('/auth/me')
      .then((data) => {
        if (cancelled) return
        setEmail(data.email)
        setStatus('authed')
      })
      .catch(() => {
        if (cancelled) return
        setEmail(null)
        setStatus('anon')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (emailInput: string, password: string) => {
    const data = await api.post<{ email: string }>('/auth/login', {
      email: emailInput,
      password,
    })
    setEmail(data.email)
    setStatus('authed')
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      // Pase lo que pase con la red, en el cliente pasamos a anónimo.
      setEmail(null)
      setStatus('anon')
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, email, login, logout }),
    [status, email, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
