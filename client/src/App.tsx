// Raíz de la app: tema (siempre) → auth (gate) → shell + navegación.
// El ThemeProvider envuelve por fuera para que el login y el splash respeten
// el tema activo (CLAUDE.md §11: nada de app sin sesión válida).
import { ThemeProvider } from './theme/ThemeProvider'
import { AppearanceProvider } from './theme/AppearanceProvider'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { NavigationProvider } from './navigation/NavigationProvider'
import { WorkspaceProvider } from './workspace/WorkspaceProvider'
import { OpenFilesProvider } from './openfiles/OpenFilesProvider'
import AppShell from './components/AppShell/AppShell'
import NavIsland from './components/NavIsland/NavIsland'
import PullToRefresh from './components/PullToRefresh/PullToRefresh'
import Splash from './components/Splash/Splash'
import LoginView from './views/Login/LoginView'

// Decide qué renderizar según el estado de sesión.
function AuthGate() {
  const { status } = useAuth()

  if (status === 'loading') return <Splash />
  if (status === 'anon') return <LoginView />

  // Autenticado: la app completa (isla de nav como hermana del shell, fixed).
  // WorkspaceProvider + OpenFilesProvider van DENTRO de NavigationProvider para
  // que openFile() pueda navegar a la vista Editor.
  return (
    <NavigationProvider>
      <WorkspaceProvider>
        <OpenFilesProvider>
          {/* Pull-to-refresh solo alrededor del shell scrollable; la isla de nav
              (fixed, abajo) queda fuera para no disparar el gesto por error. */}
          <PullToRefresh>
            <AppShell />
          </PullToRefresh>
          <NavIsland />
        </OpenFilesProvider>
      </WorkspaceProvider>
    </NavigationProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AppearanceProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </AppearanceProvider>
    </ThemeProvider>
  )
}
