// NavIsland — "isla dinámica" de navegación (DESIGN.md §5, mockup canónico).
// Cerrada: píldora flotante con la vista activa. Un tap la expande a la fila
// de 5 pestañas sobre un scrim que cierra al tocar (o con Escape).
import { useEffect, useRef, useState } from 'react'
import { useNavigation, VIEWS, type ViewId } from '../../navigation/NavigationProvider'
import styles from './NavIsland.module.css'

export default function NavIsland() {
  const { view, setView } = useNavigation()
  const [open, setOpen] = useState(false)

  const pillRef = useRef<HTMLButtonElement>(null)
  const activeTabRef = useRef<HTMLButtonElement>(null)
  // Solo devolvemos el foco a la píldora si la isla llegó a estar abierta
  // (evita robar el foco en el primer render)
  const wasOpen = useRef(false)

  const active = VIEWS.find((tab) => tab.id === view) ?? VIEWS[0]

  // Escape cierra la isla (ruta de teclado equivalente al tap en el scrim)
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Gestión de foco: al abrir → pestaña activa; al cerrar → píldora
  useEffect(() => {
    if (open) {
      wasOpen.current = true
      activeTabRef.current?.focus()
    } else if (wasOpen.current) {
      pillRef.current?.focus()
    }
  }, [open])

  const selectView = (id: ViewId) => {
    setView(id)
    setOpen(false)
  }

  return (
    <>
      {open && (
        // Capa de cierre por tap; Escape cubre la ruta de teclado
        <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      <nav className={styles.island} aria-label="Vistas de la aplicación">
        {open ? (
          <div className={styles.tabs}>
            {VIEWS.map((tab) => {
              const isActive = tab.id === view
              return (
                <button
                  key={tab.id}
                  ref={isActive ? activeTabRef : undefined}
                  type="button"
                  className={isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => selectView(tab.id)}
                >
                  <span className={styles.tabIcon} aria-hidden="true">
                    {tab.icon}
                  </span>
                  <span className={styles.tabLabel}>{tab.label}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <button
            ref={pillRef}
            type="button"
            className={styles.pill}
            aria-expanded={open}
            aria-label={`Cambiar de vista (actual: ${active.label})`}
            onClick={() => setOpen(true)}
          >
            <span className={styles.pillIcon} aria-hidden="true">
              {active.icon}
            </span>
            <span className={styles.pillLabel}>{active.label}</span>
            {/* "Hamburguesa" de 2 líneas del mockup */}
            <span className={styles.burger} aria-hidden="true">
              <span className={styles.burgerLine} />
              <span className={styles.burgerLine} />
            </span>
          </button>
        )}
      </nav>
    </>
  )
}
