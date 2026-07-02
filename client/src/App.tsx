// Raíz de la app: providers globales + shell + isla de navegación.
// La isla va como hermana del shell (position: fixed) para no depender
// del overflow:hidden del marco.
import { ThemeProvider } from './theme/ThemeProvider'
import { NavigationProvider } from './navigation/NavigationProvider'
import AppShell from './components/AppShell/AppShell'
import NavIsland from './components/NavIsland/NavIsland'

export default function App() {
  return (
    <ThemeProvider>
      <NavigationProvider>
        <AppShell />
        <NavIsland />
      </NavigationProvider>
    </ThemeProvider>
  )
}
