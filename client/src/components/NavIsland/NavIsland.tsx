// NavIsland — "isla dinámica" de navegación (DESIGN.md §5, mockup canónico).
// Cerrada: píldora flotante con la vista activa. Un tap la expande a la fila
// de 5 pestañas sobre un scrim que cierra al tocar (o con Escape).
//
// La píldora es ARRASTRABLE (Pointer Events): el usuario la mueve a donde quiera
// y la posición se recuerda en localStorage. La colocación real se aplica por
// `transform` inline sobre el <nav> (centrado en un punto), no por CSS bottom/center.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useNavigation, VIEWS, type ViewId } from '../../navigation/NavigationProvider'
import styles from './NavIsland.module.css'

type Point = { x: number; y: number }

const POS_KEY = 'portaide:island:pos'
const DRAG_THRESHOLD = 8 // px de movimiento antes de considerar ARRASTRE (vs TAP)
const EDGE_MARGIN = 8 // separación mínima al borde / safe-area
const BOTTOM_GAP = 20 // hueco por defecto respecto al borde inferior (= mockup)

function loadSavedPos(): Point | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof (parsed as Point).x === 'number' &&
      typeof (parsed as Point).y === 'number'
    ) {
      return { x: (parsed as Point).x, y: (parsed as Point).y }
    }
  } catch {
    /* localStorage no disponible o JSON corrupto → posición por defecto */
  }
  return null
}

function savePos(p: Point) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p))
  } catch {
    /* almacenamiento no disponible (modo privado): la posición no persiste */
  }
}

function clampValue(v: number, min: number, max: number) {
  // Si el hueco es más pequeño que el contenido (p.ej. pantalla estrecha con las
  // 5 pestañas abiertas), centramos en el eje en vez de forzar un borde.
  if (min > max) return (min + max) / 2
  return Math.min(Math.max(v, min), max)
}

export default function NavIsland() {
  const { view, setView } = useNavigation()
  const [open, setOpen] = useState(false)
  // Centro de la isla en coords de viewport. null hasta medir en el primer layout.
  const [pos, setPos] = useState<Point | null>(null)
  const [dragging, setDragging] = useState(false)

  const pillRef = useRef<HTMLButtonElement>(null)
  const activeTabRef = useRef<HTMLButtonElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  // Solo devolvemos el foco a la píldora si la isla llegó a estar abierta
  // (evita robar el foco en el primer render)
  const wasOpen = useRef(false)

  const sizeRef = useRef({ w: 0, h: 0 })
  const insetsRef = useRef({ top: 0, right: 0, bottom: 0, left: 0 })
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startCx: number
    startCy: number
    moved: boolean
    last: Point | null
  } | null>(null)
  // True tras un arrastre para suprimir el click que dispara el navegador al soltar
  // (así arrastrar no abre la isla). El teclado no pasa por aquí.
  const justDraggedRef = useRef(false)

  const active = VIEWS.find((tab) => tab.id === view) ?? VIEWS[0]

  // ---- Medición: tamaño de la isla e insets de safe-area ----

  const readInsets = useCallback(() => {
    const probe = probeRef.current
    if (!probe) return
    const cs = getComputedStyle(probe)
    insetsRef.current = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    }
  }, [])

  const measure = useCallback(() => {
    const nav = navRef.current
    if (!nav) return
    // offsetWidth/Height = caja de layout SIN transform (evita medir la escala de
    // la animación de apertura de las pestañas).
    sizeRef.current = { w: nav.offsetWidth, h: nav.offsetHeight }
  }, [])

  const clampCenter = useCallback((c: Point): Point => {
    const { w, h } = sizeRef.current
    const ins = insetsRef.current
    const vw = window.innerWidth
    const vh = window.innerHeight
    const halfW = w / 2
    const halfH = h / 2
    return {
      x: clampValue(c.x, ins.left + EDGE_MARGIN + halfW, vw - ins.right - EDGE_MARGIN - halfW),
      y: clampValue(c.y, ins.top + EDGE_MARGIN + halfH, vh - ins.bottom - EDGE_MARGIN - halfH),
    }
  }, [])

  const defaultCenter = useCallback((): Point => {
    const { h } = sizeRef.current
    const ins = insetsRef.current
    return {
      x: window.innerWidth / 2,
      y: window.innerHeight - ins.bottom - BOTTOM_GAP - h / 2,
    }
  }, [])

  // Inicialización: medir, leer insets y fijar posición (guardada o por defecto)
  // ANTES del primer paint (useLayoutEffect) para que no se vea ningún salto.
  useLayoutEffect(() => {
    readInsets()
    measure()
    const saved = loadSavedPos()
    setPos(clampCenter(saved ?? defaultCenter()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-clampar cuando cambia el tamaño de la isla (abrir/cerrar → pestañas más anchas)
  useEffect(() => {
    const nav = navRef.current
    if (!nav || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      measure()
      setPos((prev) => (prev ? clampCenter(prev) : prev))
    })
    ro.observe(nav)
    return () => ro.disconnect()
  }, [clampCenter, measure])

  // Re-clampar al cambiar tamaño/orientación de la ventana (que no quede fuera)
  useEffect(() => {
    const onResize = () => {
      readInsets()
      measure()
      setPos((prev) => (prev ? clampCenter(prev) : prev))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [clampCenter, measure, readInsets])

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

  // ---- Arrastre (Pointer Events): distingue TAP de ARRASTRE ----

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return // solo botón primario / toque
    justDraggedRef.current = false
    let center = pos
    if (!center) {
      const rect = pillRef.current?.getBoundingClientRect()
      center = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCx: center.x,
      startCy: center.y,
      moved: false,
      last: null,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* algún navegador puede rechazar la captura; el arrastre degrada a no-op */
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved) {
      // Umbral: por debajo seguimos considerándolo un posible TAP
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return
      drag.moved = true
      justDraggedRef.current = true
      setDragging(true)
    }
    const next = clampCenter({ x: drag.startCx + dx, y: drag.startCy + dy })
    drag.last = next
    setPos(next)
  }

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* la captura pudo liberarse sola */
    }
    if (drag.moved) {
      setDragging(false)
      if (drag.last) savePos(drag.last)
    }
    // Si no se movió (TAP), no hacemos nada aquí: el onClick abre la isla.
  }

  const onPillClick = () => {
    // Suprime el click sintético que sigue a un arrastre (no debe abrir la isla).
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      return
    }
    setOpen(true)
  }

  const navStyle: CSSProperties = pos
    ? {
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%)`,
        visibility: 'visible',
      }
    : { visibility: 'hidden' }

  return (
    <>
      {open && (
        // Capa de cierre por tap; Escape cubre la ruta de teclado
        <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      {/* Sonda invisible: expone env(safe-area-inset-*) como padding legible por JS */}
      <span ref={probeRef} className={styles.safeProbe} aria-hidden="true" />

      <nav
        ref={navRef}
        className={dragging ? `${styles.island} ${styles.islandDragging}` : styles.island}
        style={navStyle}
        aria-label="Vistas de la aplicación"
      >
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
            className={dragging ? `${styles.pill} ${styles.pillDragging}` : styles.pill}
            aria-expanded={open}
            aria-label={`Cambiar de vista (actual: ${active.label}). Mantén y arrastra para mover.`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={onPillClick}
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
