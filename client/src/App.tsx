// Raíz de la app: tema (siempre) → auth (gate) → shell + navegación.
// El ThemeProvider envuelve por fuera para que el login y el splash respeten
// el tema activo (CLAUDE.md §11: nada de app sin sesión válida).
import { ThemeProvider } from './theme/ThemeProvider'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { NavigationProvider } from './navigation/NavigationProvider'
import AppShell from './components/AppShell/AppShell'
import NavIsland from './components/NavIsland/NavIsland'
import Splash from './components/Splash/Splash'
import LoginView from './views/Login/LoginView'

// Decide qué renderizar según el estado de sesión.
function AuthGate() {
  const { status } = useAuth()

  if (status === 'loading') return <Splash />
  if (status === 'anon') return <LoginView />

  // Autenticado: la app completa (isla de nav como hermana del shell, fixed).
  return (
    <NavigationProvider>
      <AppShell />
      <NavIsland />
    </NavigationProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ThemeProvider>
  )
}
