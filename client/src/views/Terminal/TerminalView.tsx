// Vista Terminal (CLAUDE.md §3, DESIGN.md §9): shell real del VPS por pty.
// Orquesta las pestañas (cada una = un TerminalPane con su propio WebSocket a
// /ws/terminal), la barra de teclas especiales y la política de modificadores
// sticky. La cookie de sesión viaja sola (mismo origen).
import '@xterm/xterm/css/xterm.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import TerminalPane, { type ConnStatus, type TerminalHandle } from './TerminalPane'
import TerminalTabs, { type TermTab } from './TerminalTabs'
import KeyBar from './KeyBar'
import { applyModifiers, NO_MODS, type Modifiers } from './keys'
import styles from './TerminalView.module.css'

function makeId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `t${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`
}

function makeInitialTabs(): TermTab[] {
  return [{ id: makeId(), title: 'shell' }]
}

export default function TerminalView() {
  const [tabs, setTabs] = useState<TermTab[]>(makeInitialTabs)
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id)
  const [statuses, setStatuses] = useState<Record<string, ConnStatus>>({})
  const [modifiers, setModifiers] = useState<Modifiers>(NO_MODS)
  const [themeVersion, setThemeVersion] = useState(0)

  // Registro de handles imperativos por pestaña (para dirigir la terminal activa).
  const handlesRef = useRef<Map<string, TerminalHandle>>(new Map())
  // Espejo de los modificadores para leerlos en callbacks sin cerrar sobre estado viejo.
  const modifiersRef = useRef<Modifiers>(NO_MODS)
  modifiersRef.current = modifiers
  // Contador monótono para nombrar pestañas nuevas ("shell 2", "shell 3"…).
  const tabSeqRef = useRef(1)

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
      handlesRef.current.get(id)?.send(applyModifiers(data, modifiersRef.current))
      clearMods()
    },
    [clearMods]
  )

  const handleStatus = useCallback((id: string, status: ConnStatus): void => {
    setStatuses((s) => ({ ...s, [id]: status }))
  }, [])

  // --- Teclas especiales -------------------------------------------------
  const onSeq = useCallback(
    (seq: string): void => {
      handlesRef.current.get(activeId)?.send(seq)
      clearMods()
      focusActive()
    },
    [activeId, clearMods, focusActive]
  )

  const onChar = useCallback(
    (char: string): void => {
      handlesRef.current.get(activeId)?.send(applyModifiers(char, modifiersRef.current))
      clearMods()
      focusActive()
    },
    [activeId, clearMods, focusActive]
  )

  const onToggleMod = useCallback((mod: 'ctrl' | 'alt'): void => {
    setModifiers((m) => ({ ...m, [mod]: !m[mod] }))
  }, [])

  // --- Pestañas ----------------------------------------------------------
  const addTab = useCallback((): void => {
    tabSeqRef.current += 1
    const id = makeId()
    setTabs((prev) => [...prev, { id, title: `shell ${tabSeqRef.current}` }])
    setActiveId(id)
  }, [])

  const closeTab = useCallback(
    (id: string): void => {
      if (tabs.length <= 1) return // siempre queda al menos una terminal
      setTabs((prev) => prev.filter((t) => t.id !== id))
      // Si cerramos la activa, pasar a la vecina (izquierda, si la hay).
      setActiveId((cur) => {
        if (cur !== id) return cur
        const idx = tabs.findIndex((t) => t.id === id)
        const rest = tabs.filter((t) => t.id !== id)
        return (rest[Math.max(0, idx - 1)] ?? rest[0]).id
      })
      handlesRef.current.delete(id)
      setStatuses((s) => {
        const n = { ...s }
        delete n[id]
        return n
      })
    },
    [tabs]
  )

  return (
    <main className={styles.view}>
      <h1 className={styles.srOnly}>Terminal</h1>
      <TerminalTabs
        tabs={tabs}
        activeId={activeId}
        statuses={statuses}
        onSelect={setActiveId}
        onAdd={addTab}
        onClose={closeTab}
      />

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
                onInput={(data) => handleInput(tab.id, data)}
                onStatus={(status) => handleStatus(tab.id, status)}
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
