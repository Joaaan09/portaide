// useKeyboardInset — publica en <html> la variable CSS `--kb-inset` con la altura
// que el teclado virtual del móvil solapa sobre la layout viewport.
//
// Por qué hace falta: el marco de la app está anclado con `position: fixed;
// inset: 0` a la layout viewport (AppShell), que NO se encoge al abrir el teclado
// del sistema; este se dibuja ENCIMA de la parte baja. Cualquier cosa pegada al
// borde inferior (p. ej. la barra de teclas especiales del Terminal) queda, por
// tanto, detrás del teclado e invisible. Con esta var, esa superficie puede
// reservar el hueco y levantarse por encima.
//
// Se apoya en `window.visualViewport` (soportado por todos los navegadores
// móviles actuales). Si no existe, no hace nada: `--kb-inset` queda en 0px y el
// comportamiento es el de antes (sin regresión, solo sin arreglo).
import { useEffect } from 'react'

// Por debajo de este umbral lo tratamos como "sin teclado": descarta el ruido de
// redondeo sub-píxel y los cambios de la barra de URL del navegador (un teclado
// real siempre es bastante más alto que esto).
const KB_MIN_PX = 80

export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const root = document.documentElement
    let raf = 0

    const measure = (): void => {
      raf = 0
      // Solape del teclado sobre el fondo de la layout viewport. `offsetTop` cubre
      // el caso en que el navegador desplaza la visual viewport al enfocar.
      const overlap = window.innerHeight - vv.height - vv.offsetTop
      const inset = overlap > KB_MIN_PX ? Math.round(overlap) : 0
      root.style.setProperty('--kb-inset', `${inset}px`)
    }

    // visualViewport puede emitir en ráfaga durante la animación del teclado;
    // coalescemos en un rAF para tocar el layout una sola vez por frame.
    const schedule = (): void => {
      if (raf) return
      raf = requestAnimationFrame(measure)
    }

    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    measure()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      root.style.removeProperty('--kb-inset')
    }
  }, [])
}
