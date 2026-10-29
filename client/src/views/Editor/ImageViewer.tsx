// Visor de imágenes del Editor (DESIGN.md §7.1). Pinta la imagen activa y deja
// pasar a la anterior/siguiente de su MISMA carpeta (orden del explorer) sin
// volver a Files: swipe horizontal en el escenario, barra `n / N ‹ ›` o flechas
// del teclado. La pestaña "se mueve" por la carpeta (replaceFile), no se abre
// una por imagen.
//
// Las imágenes se traen con fetch como blob (la cookie viaja sola, mismo origen)
// y se precargan la anterior y la siguiente: /fs/raw responde `no-store`, así
// que un `new Image()` de precarga no garantiza que el <img> lo reutilice.
import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { listDir, fsRawUrl, isImagePath, ApiError } from '../../api/client'
import DownloadLink from '../../components/DownloadLink/DownloadLink'
import { basename, errText } from './fsText'
import styles from './EditorView.module.css'
import previewStyles from './Preview.module.css'

type Dir = 'next' | 'prev'

/** Carpeta de una ruta POSIX ('/a/b/c.png' → '/a/b'). */
function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/** Une una carpeta con el nombre de un hijo (como joinPath del explorer). */
function joinPath(parent: string, name: string): string {
  return parent.endsWith('/') ? parent + name : `${parent}/${name}`
}

// Umbrales del swipe (px / px·ms⁻¹).
const SLOP = 10 // movimiento mínimo antes de decidir eje
const COMMIT_MAX = 90 // distancia que confirma el paso (o 22 % del ancho, lo menor)
const FLICK_MIN = 30 // distancia mínima de un flick
const FLICK_SPEED = 0.3 // velocidad final que cuenta como flick (la de Hammer.js)
const EDGE_RESIST = 0.25 // sin vecina en esa dirección: la imagen apenas se mueve
const FLICK_WINDOW = 100 // ms de movimiento reciente con los que se mide la velocidad

// Blobs retenidos: la ventana actual ± 1 siempre, más los usados hace poco hasta
// este tope (ir y volver no re-descarga). Son bytes, no bitmaps decodificados.
const MAX_BLOBS = 5

interface Slot {
  ctrl: AbortController
  promise: Promise<string>
  url?: string
}

/**
 * Caché LRU pequeña de blobs (object URLs) por ruta. `load` deduplica peticiones
 * y marca la ruta como reciente; `trim` aborta/revoca las más antiguas que no
 * estén en la ventana actual hasta quedar en MAX_BLOBS.
 */
function useImageBlobs() {
  const slots = useRef(new Map<string, Slot>())

  const drop = useCallback((path: string) => {
    const slot = slots.current.get(path)
    if (!slot) return
    slot.ctrl.abort()
    if (slot.url) URL.revokeObjectURL(slot.url)
    slots.current.delete(path)
  }, [])

  const load = useCallback((path: string): Promise<string> => {
    const hit = slots.current.get(path)
    if (hit) {
      slots.current.delete(path) // el orden del Map es la recencia
      slots.current.set(path, hit)
      return hit.promise
    }
    const ctrl = new AbortController()
    const slot: Slot = { ctrl, promise: Promise.resolve('') }
    slot.promise = fetch(fsRawUrl(path), { credentials: 'include', signal: ctrl.signal }).then(
      async (res) => {
        if (!res.ok) {
          const data: unknown = await res.json().catch(() => null)
          const code =
            data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
              ? data.error
              : 'request_failed'
          throw new ApiError(res.status, code)
        }
        const blob = await res.blob()
        if (ctrl.signal.aborted) throw new DOMException('aborted', 'AbortError')
        slot.url = URL.createObjectURL(blob)
        return slot.url
      }
    )
    // Un fallo no se queda en caché: volver a la imagen lo reintenta.
    slot.promise.catch(() => {
      if (slots.current.get(path) === slot) slots.current.delete(path)
    })
    slots.current.set(path, slot)
    return slot.promise
  }, [])

  const trim = useCallback(
    (keep: Set<string>) => {
      for (const p of [...slots.current.keys()]) {
        if (slots.current.size <= MAX_BLOBS) break
        if (!keep.has(p)) drop(p)
      }
    },
    [drop]
  )

  useEffect(() => {
    const map = slots.current
    return () => {
      for (const p of [...map.keys()]) drop(p)
    }
  }, [drop])

  return { load, trim }
}

interface SlideProps {
  path: string
  load: (path: string) => Promise<string>
  /** Lado por el que entra (tras pasar de imagen); null = sin animación. */
  enter: Dir | null
  slideRef: RefObject<HTMLDivElement | null>
}

/** Una imagen con su estado de carga. Montada con `key={path}`. */
function ImageSlide({ path, load, enter, slideRef }: SlideProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reason, setReason] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    load(path)
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        setReason(errText(err))
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [path, load])

  return (
    <div
      ref={slideRef}
      className={styles.imageSlide}
      data-enter={state === 'ready' && enter ? enter : undefined}
    >
      {state === 'error' ? (
        <div className={styles.overlay}>
          <p className={styles.overlayText}>
            no se pudo mostrar la imagen{reason ? ` · ${reason}` : ''}
          </p>
          <DownloadLink
            className={styles.retry}
            path={path}
            name={basename(path)}
            ariaLabel={`Descargar ${basename(path)}`}
          >
            ⤓ Descargar
          </DownloadLink>
        </div>
      ) : (
        <>
          {state === 'loading' && (
            <div className={styles.overlay}>
              <span className={styles.spinner} aria-hidden="true" />
              <p className={styles.overlayText}>cargando {basename(path)}…</p>
            </div>
          )}
          {src && (
            <img
              className={styles.image}
              src={src}
              alt={basename(path)}
              draggable={false}
              onLoad={() => setState('ready')}
              onError={() => setState('error')}
              data-hidden={state === 'loading' ? '' : undefined}
            />
          )}
        </>
      )}
    </div>
  )
}

interface ImageViewerProps {
  path: string
  /** Pasa a otra imagen de la carpeta (la pestaña actual se mueve a `to`). */
  onNavigate: (to: string) => void
}

export default function ImageViewer({ path, onNavigate }: ImageViewerProps) {
  const { load, trim } = useImageBlobs()
  const slideRef = useRef<HTMLDivElement | null>(null)
  const dir = dirname(path)

  // Imágenes hermanas (orden del backend = orden del explorer), una vez por carpeta.
  const [siblings, setSiblings] = useState<{ dir: string; paths: string[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    listDir(dir)
      .then((res) => {
        if (cancelled) return
        const paths = res.entries
          .filter((e) => e.type === 'file' && isImagePath(e.name))
          .map((e) => joinPath(dir, e.name))
        setSiblings({ dir, paths })
      })
      .catch(() => {
        if (!cancelled) setSiblings({ dir, paths: [] }) // sin listado: visor sin navegación
      })
    return () => {
      cancelled = true
    }
  }, [dir])

  const paths = siblings?.dir === dir ? siblings.paths : []
  const idx = paths.indexOf(path)
  const hasNav = idx !== -1 && paths.length > 1
  const prevPath = hasNav && idx > 0 ? paths[idx - 1]! : null
  const nextPath = hasNav && idx < paths.length - 1 ? paths[idx + 1]! : null

  // Precarga de las vecinas (la siguiente primero: es la dirección habitual).
  // La actual la pide su ImageSlide (los efectos del hijo corren antes).
  useEffect(() => {
    if (nextPath) load(nextPath).catch(() => {})
    if (prevPath) load(prevPath).catch(() => {})
    trim(new Set([path, prevPath, nextPath].filter((p): p is string => !!p)))
  }, [path, prevPath, nextPath, load, trim])

  // Dirección de entrada, ligada a la ruta destino: cambiar de pestaña a otra
  // imagen no debe animar como si se hubiera pasado.
  const [enter, setEnter] = useState<{ path: string; dir: Dir } | null>(null)

  const go = useCallback(
    (d: Dir) => {
      const target = d === 'next' ? nextPath : prevPath
      if (!target) return false
      setEnter({ path: target, dir: d })
      onNavigate(target)
      return true
    },
    [nextPath, prevPath, onNavigate]
  )

  // Flechas ←/→ mientras el visor está montado, salvo si el foco está en un campo
  // de texto o alguien ya las consumió (defaultPrevented).
  useEffect(() => {
    if (!hasNav) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const t = e.target as Element | null
      if (t?.closest?.('input, textarea, select, [contenteditable]')) return
      if (go(e.key === 'ArrowRight' ? 'next' : 'prev')) e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hasNav, go])

  // --- Swipe ---------------------------------------------------------------
  // El desplazamiento se aplica directo al DOM (sin render por cada pointermove).
  // `trail` = últimas muestras (dx, t) para medir la velocidad del final del gesto.
  const drag = useRef<{
    id: number
    x: number
    y: number
    dx: number
    on: boolean
    trail: { dx: number; t: number }[]
  } | null>(null)

  const release = () => {
    const el = slideRef.current
    if (!el) return
    delete el.dataset.dragging // vuelve la transición de CSS → regresa a su sitio
    el.style.transform = ''
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!hasNav || e.pointerType === 'mouse' || !e.isPrimary) return
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: 0,
      on: false,
      trail: [{ dx: 0, t: e.timeStamp }],
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.on) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null // gesto vertical: no es nuestro
        return
      }
      d.on = true
      e.currentTarget.setPointerCapture(e.pointerId)
      const el = slideRef.current
      if (el) {
        el.dataset.dragging = ''
        el.style.animation = 'none' // por si aún entraba la anterior
      }
    }
    d.dx = dx
    d.trail.push({ dx, t: e.timeStamp })
    while (d.trail.length > 2 && e.timeStamp - d.trail[0]!.t > FLICK_WINDOW) d.trail.shift()
    const blocked = dx > 0 ? !prevPath : !nextPath
    const el = slideRef.current
    if (el) el.style.transform = `translateX(${blocked ? dx * EDGE_RESIST : dx}px)`
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (!d.on) return
    const dist = Math.abs(d.dx)
    const first = d.trail[0]!
    const speed = Math.abs(d.dx - first.dx) / Math.max(e.timeStamp - first.t, 1)
    const width = e.currentTarget.clientWidth
    const commit = dist > Math.min(COMMIT_MAX, width * 0.22) || (dist > FLICK_MIN && speed > FLICK_SPEED)
    if (commit && go(d.dx < 0 ? 'next' : 'prev')) return // la nueva ImageSlide se monta limpia
    release()
  }

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return
    const on = drag.current.on
    drag.current = null
    if (on) release()
  }

  return (
    <div className={previewStyles.viewer}>
      {hasNav && (
        <div className={previewStyles.bar} role="toolbar" aria-label="Imágenes de la carpeta">
          <span className={previewStyles.barInfo} aria-live="polite">
            <span className={previewStyles.barNum}>{idx + 1}</span>
            <span className={previewStyles.barFaint}> / {paths.length}</span>
          </span>
          <div className={previewStyles.barGroup}>
            <button
              type="button"
              className={`${previewStyles.barBtn} ${previewStyles.barBtnNav}`}
              onClick={() => go('prev')}
              disabled={!prevPath}
              aria-label="Imagen anterior"
            >
              ‹
            </button>
            <button
              type="button"
              className={`${previewStyles.barBtn} ${previewStyles.barBtnNav}`}
              onClick={() => go('next')}
              disabled={!nextPath}
              aria-label="Imagen siguiente"
            >
              ›
            </button>
          </div>
        </div>
      )}
      <div
        className={styles.imageStage}
        data-ptr="off"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <ImageSlide
          key={path}
          path={path}
          load={load}
          enter={enter?.path === path ? enter.dir : null}
          slideRef={slideRef}
        />
      </div>
    </div>
  )
}
