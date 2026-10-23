// PullToRefresh — gesto de "tirar para recargar" portado del que ya funciona en
// total-grind (components/Layout.tsx). Diferencia clave con total-grind: allí el
// scroll vive en window (window.scrollY), pero PortaIDE es un app-shell donde el
// scroll vive DENTRO del <main>/.body de cada vista. Por eso, en vez de mirar
// window.scrollY, localizamos el contenedor scrollable real bajo el dedo y solo
// disparamos el pull cuando ese contenedor está arriba del todo (scrollTop 0).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './PullToRefresh.module.css'

// Umbrales del gesto (mismos valores que total-grind).
const START_SLOP = 10 // holgura inicial: ignora microtoques
const RESISTANCE = 0.4 // resistencia al arrastre (feel elástico)
const MAX_PULL = 60 // tope de desplazamiento del indicador (px)
const TRIGGER = 50 // a partir de aquí, al soltar → recarga
const RELOAD_DELAY = 700 // ms para ver el spinner antes de recargar

// La PWA instalada (standalone) no tiene el pull-to-refresh nativo del navegador,
// así que se lo damos nosotros. En una pestaña normal el navegador ya lo hace, y
// no queremos duplicarlo: mismo criterio que total-grind.
function isStandalone(): boolean {
  const mm = window.matchMedia?.('(display-mode: standalone)').matches
  const ios = (navigator as unknown as { standalone?: boolean }).standalone === true
  return Boolean(mm) || ios
}

// Ancestro scrollable vertical más cercano al punto de toque, sin salir del
// wrapper. Devuelve null si no hay ninguno (cabeceras, zonas no scrollables):
// en ese caso se considera "arriba del todo" y el pull es válido.
function scrollableAncestor(start: Element | null, boundary: Element): HTMLElement | null {
  let el = start as HTMLElement | null
  while (el && el !== boundary) {
    const oy = getComputedStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el
    el = el.parentElement
  }
  return null
}

/**
 * Zonas que se declaran fuera del gesto con `data-ptr="off"` (DESIGN.md §6.7).
 * Caso real: el hilo del Chat. Ahí "arriba del todo" es historia antigua y para
 * leerla arrastras hacia abajo — justo el gesto de recargar. Al llegar al tope,
 * el siguiente arrastre reiniciaba la app y reconstruía el hilo entero. En el
 * Chat la recarga además no aporta nada: el estado es autoritativo del servidor
 * y llega por el WebSocket.
 */
function pullDisabled(start: Element | null, boundary: Element): boolean {
  let el = start as HTMLElement | null
  while (el && el !== boundary) {
    if (el.dataset.ptr === 'off') return true
    el = el.parentElement
  }
  return false
}

interface PullToRefreshProps {
  children: ReactNode
}

export default function PullToRefresh({ children }: PullToRefreshProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Estado de trabajo del gesto (refs → no provocan render por cada touchmove).
  const startYRef = useRef(0)
  const validRef = useRef(false)
  const scrollElRef = useRef<HTMLElement | null>(null)
  const refreshingRef = useRef(false)

  useEffect(() => {
    refreshingRef.current = refreshing
  }, [refreshing])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !isStandalone()) return

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current) {
        validRef.current = false
        return
      }
      // Zona que se declara fuera del gesto (el hilo del Chat): ni siquiera se
      // arma, así que no hay indicador ni recarga por mucho que se arrastre.
      if (pullDisabled(e.target as Element, wrapper)) {
        validRef.current = false
        return
      }
      const sc = scrollableAncestor(e.target as Element, wrapper)
      // Válido solo si el contenedor scrollable activo está arriba del todo;
      // si ya hay scroll, es scroll normal de la vista, no un pull.
      if (sc && sc.scrollTop > 0) {
        validRef.current = false
        return
      }
      scrollElRef.current = sc
      startYRef.current = e.touches[0].clientY
      validRef.current = true
      setDragging(true)
    }

    const onMove = (e: TouchEvent) => {
      if (!validRef.current) return
      // Si el usuario empezó a scrollear la vista, cancela el pull.
      const sc = scrollElRef.current
      if (sc && sc.scrollTop > 0) {
        validRef.current = false
        setDistance(0)
        return
      }
      const diff = e.touches[0].clientY - startYRef.current
      if (diff <= 0) {
        setDistance(0)
        return
      }
      if (diff < START_SLOP) return
      // Frenar el rebote nativo mientras el pull está activo.
      if (e.cancelable) e.preventDefault()
      setDistance(Math.min((diff - START_SLOP) * RESISTANCE, MAX_PULL))
    }

    const onEnd = () => {
      setDragging(false)
      if (!validRef.current) return
      validRef.current = false
      setDistance((prev) => {
        if (prev >= TRIGGER) {
          setRefreshing(true)
          window.setTimeout(() => window.location.reload(), RELOAD_DELAY)
          return TRIGGER // mantener visible durante la recarga
        }
        return 0 // por debajo del umbral: vuelve arriba
      })
    }

    wrapper.addEventListener('touchstart', onStart, { passive: true })
    wrapper.addEventListener('touchmove', onMove, { passive: false })
    wrapper.addEventListener('touchend', onEnd, { passive: true })
    wrapper.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      wrapper.removeEventListener('touchstart', onStart)
      wrapper.removeEventListener('touchmove', onMove)
      wrapper.removeEventListener('touchend', onEnd)
      wrapper.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  const indicatorClass = dragging ? `${styles.indicator} ${styles.dragging}` : styles.indicator
  const spinnerClass = refreshing ? `${styles.spinner} ${styles.spinning}` : styles.spinner

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <div
        className={indicatorClass}
        style={{ transform: `translate(-50%, ${distance}px)`, opacity: Math.min(distance / 40, 1) }}
        aria-hidden="true"
      >
        <div
          className={spinnerClass}
          style={refreshing ? undefined : { transform: `rotate(${distance * 6}deg)` }}
        />
      </div>
      {children}
    </div>
  )
}
