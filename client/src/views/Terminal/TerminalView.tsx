// Vista Terminal (CLAUDE.md §3, DESIGN.md §9): shell real del VPS por pty.
// Orquesta las pestañas, la barra de teclas especiales y la política de
// modificadores sticky. El estado (pestañas, conexión) NO vive aquí: vive en el
// `terminalStore` (singleton fuera de React) para sobrevivir al remontaje de la
// vista — AppShell la monta con key={view} — y a bloquear el móvil.
import '@xterm/xterm/css/xterm.css'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import TerminalPane, { type TerminalHandle } from './TerminalPane'
import TerminalTabs from './TerminalTabs'
import KeyBar from './KeyBar'
import { applyModifiers, NO_MODS, type Modifiers } from './keys'
import { tabStatus, terminalStore, type ConnStatus, type TabStatus } from './terminalStore'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useKeyboardInset } from '../../hooks/useKeyboardInset'
import ConnBanner, { useDelayedFlag } from '../../components/ConnBanner/ConnBanner'
import styles from './TerminalView.module.css'

export default function TerminalView() {
  const snap = useSyncExternalStore(terminalStore.subscribe, terminalStore.getSnapshot)
  const { workspace } = useWorkspace()
  // Publica `--kb-inset`: cuánto solapa el teclado del móvil. `.view` lo usa para
  // encoger su columna y que la barra de teclas no quede tapada por el teclado.
  useKeyboardInset()
  const [modifiers, setModifiers] = useState<Modifiers>(NO_MODS)
  const [themeVersion, setThemeVersion] = useState(0)

  const { tabs, activeId, conn } = snap

  // Registro de handles imperativos por pestaña (para dirigir la terminal activa).
  const handlesRef = useRef<Map<string, TerminalHandle>>(new Map())
  // Espejo de los modificadores para leerlos en callbacks sin cerrar sobre estado viejo.
  const modifiersRef = useRef<Modifiers>(NO_MODS)
  modifiersRef.current = modifiers

  // El cwd de los nuevos ptys es el workspace activo (se manda en el `attach`).
  useEffect(() => {
    terminalStore.setCwd(workspace)
  }, [workspace])

  const registerHandle = useCallback((id: string, handle: TerminalHandle | null): void => {
    if (handle) handlesRef.current.set(id, handle)
    else handlesRef.current.delete(id)
  }, [])

  // Reaplicar el tema de xterm cuando cambia data-theme (Settings → Appearance).
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeVersion((v) => v + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const clearMods = useCallback((): void => {
    setModifiers((m) => (m.ctrl || m.alt ? NO_MODS : m))
  }, [])

  const focusActive = useCallback((): void => {
    handlesRef.current.get(activeId)?.focus()
  }, [activeId])

  // Entrada tecleada en la terminal: aplica modificadores armados y desármalos.
  const handleInput = useCallback(
    (id: string, data: string): void => {
      terminalStore.sendInput(id, applyModifiers(data, modifiersRef.current))
      clearMods()
    },
    [clearMods]
  )

  // --- Teclas especiales -------------------------------------------------
  const onSeq = useCallback(
    (seq: string): void => {
      terminalStore.sendInput(activeId, seq)
      clearMods()
      focusActive()
    },
    [activeId, clearMods, focusActive]
  )

  const onChar = useCallback(
    (char: string): void => {
      terminalStore.sendInput(activeId, applyModifiers(char, modifiersRef.current))
      clearMods()
      focusActive()
    },
    [activeId, clearMods, focusActive]
  )

  const onToggleMod = useCallback((mod: 'ctrl' | 'alt'): void => {
    setModifiers((m) => ({ ...m, [mod]: !m[mod] }))
  }, [])

  // --- Estado de conexión (patrón compartido, DESIGN.md §6.3) --------------
  // Los puntos de las pestañas usan la MISMA histéresis que la tira: `shownConn`
  // va por detrás de `conn` al caerse y al instante al recuperarse, así que un
  // microcorte no los hace parpadear.
  const degraded = useDelayedFlag(conn !== 'open')
  const shownConn: ConnStatus = degraded ? conn : 'open'

  const statuses: Record<string, TabStatus> = {}
  for (const tab of tabs) statuses[tab.id] = tabStatus(tab, shownConn)

  return (
    <main className={styles.view}>
      <h1 className={styles.srOnly}>Terminal</h1>
      <TerminalTabs
        tabs={tabs}
        activeId={activeId}
        statuses={statuses}
        onSelect={terminalStore.selectTab}
        onAdd={terminalStore.addTab}
        onClose={terminalStore.closeTab}
      />

      {/* Sin esto, un socket caído parece una terminal "parada". Con la conexión
          sana no ocupa NADA: solo se pinta lo anormal (DESIGN.md §6.3/§9.1). */}
      <ConnBanner status={conn} onRetry={terminalStore.reconnectNow} />

      <div className={styles.panes}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeId
          return (
            <div
              key={tab.id}
              className={isActive ? styles.pane : styles.paneHidden}
              aria-hidden={isActive ? undefined : true}
            >
              <TerminalPane
                id={tab.id}
                active={isActive}
                themeVersion={themeVersion}
                alive={tab.alive}
                exitCode={tab.exitCode}
                onInput={(data) => handleInput(tab.id, data)}
                registerHandle={registerHandle}
              />
            </div>
          )
        })}
      </div>

      <KeyBar
        modifiers={modifiers}
        onSeq={onSeq}
        onChar={onChar}
        onToggleMod={onToggleMod}
      />
    </main>
  )
}
