// Raíz de la app: tema (siempre) → auth (gate) → shell + navegación.
// El ThemeProvider envuelve por fuera para que el login y el splash respeten
// el tema activo (CLAUDE.md §11: nada de app sin sesión válida).
import { ThemeProvider } from './theme/ThemeProvider'
import { AppearanceProvider } from './theme/AppearanceProvider'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { NavigationProvider } from './navigation/NavigationProvider'
import { NavModeProvider } from './navigation/NavModeProvider'
import { WorkspaceProvider } from './workspace/WorkspaceProvider'
import { OpenFilesProvider } from './openfiles/OpenFilesProvider'
import AppShell from './components/AppShell/AppShell'
import NavDrawer from './components/NavDrawer/NavDrawer'
import BottomBar from './components/BottomBar/BottomBar'
import PullToRefresh from './components/PullToRefresh/PullToRefresh'
import Splash from './components/Splash/Splash'
import LoginView from './views/Login/LoginView'

// Decide qué renderizar según el estado de sesión.
function AuthGate() {
  const { status } = useAuth()

  if (status === 'loading') return <Splash />
  if (status === 'anon') return <LoginView />

  // Autenticado: la app completa. La navegación (drawer o barra inferior según
  // navMode) se monta como hermana del shell, fixed. WorkspaceProvider +
  // OpenFilesProvider van DENTRO de NavigationProvider para que openFile() pueda
  // navegar a la vista Editor.
  return (
    <NavigationProvider>
      <WorkspaceProvider>
        <OpenFilesProvider>
          {/* Pull-to-refresh solo alrededor del shell scrollable; la navegación
              (fixed) queda fuera para no disparar el gesto por error. */}
          <PullToRefresh>
            <AppShell />
          </PullToRefresh>
          {/* Solo una de las dos se renderiza (según navMode); la otra retorna null. */}
          <NavDrawer />
          <BottomBar />
        </OpenFilesProvider>
      </WorkspaceProvider>
    </NavigationProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AppearanceProvider>
        <NavModeProvider>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </NavModeProvider>
      </AppearanceProvider>
    </ThemeProvider>
  )
}
