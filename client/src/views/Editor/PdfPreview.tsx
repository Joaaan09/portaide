// Visor de PDF (DESIGN.md §7.2). Trae el archivo de /api/fs/raw (cookie de
// mismo origen) y lo pinta con pdf.js página a página en <canvas>. No usamos
// <iframe>/<embed>: en el WebView de iOS un PDF embebido solo enseña la 1ª página.
//
// Memoria (iOS limita el total de canvas): solo se pintan las páginas cercanas
// al viewport; al alejarse se libera su bitmap. Placeholders con el tamaño real
// para que el scroll no salte. Zoom por botones (la PWA bloquea el pinch).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { ApiError, fsRawUrl } from '../../api/client'
import DownloadLink from '../../components/DownloadLink/DownloadLink'
import { basename, errText } from './fsText'
import { loadPdfjs } from './pdfjs'
import editorStyles from './EditorView.module.css'
import styles from './Preview.module.css'

// Zoom relativo al "ajustar al ancho" (1 = la página llena el ancho disponible).
const ZOOM_STEPS = [1, 1.25, 1.5, 2, 3]
const MAX_DPR = 2
// Tope de píxeles por lienzo: por encima se baja la resolución (memoria de iOS).
const MAX_CANVAS_PIXELS = 8_000_000
// Padding lateral del scroller (debe casar con .pdfPages en Preview.module.css).
const SIDE_PADDING = 12

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; pdf: PDFDocumentProxy; aspect: number }
  | { kind: 'error'; text: string }

/** Bytes del PDF vía /raw, con el código de error del backend si falla. */
async function fetchPdfBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(fsRawUrl(path), { credentials: 'include' })
  if (!res.ok) {
    let code = 'request_failed'
    try {
      const data: unknown = await res.json()
      const maybe = (data as { error?: unknown } | null)?.error
      if (typeof maybe === 'string') code = maybe
    } catch {
      // cuerpo no-JSON: nos quedamos con el genérico
    }
    throw new ApiError(res.status, code)
  }
  return new Uint8Array(await res.arrayBuffer())
}

function pdfErrText(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name
  if (name === 'PasswordException') return 'PDF protegido con contraseña'
  if (name === 'InvalidPDFException') return 'PDF dañado o no válido'
  return errText(err)
}

/** Suelta el bitmap de un canvas (WebKit no lo libera hasta que mide 0×0). */
function freeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

interface PdfPageProps {
  pdf: PDFDocumentProxy
  index: number // 1-based
  total: number
  width: number // ancho CSS de la página
  initialAspect: number // alto/ancho de la 1ª página, hasta conocer el propio
  rootRef: RefObject<HTMLDivElement | null>
}

function PdfPage({ pdf, index, total, width, initialAspect, rootRef }: PdfPageProps) {
  const holderRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null) // solo canvas, gestionado a mano
  const [near, setNear] = useState(false)
  const [aspect, setAspect] = useState(initialAspect)
  const [painted, setPainted] = useState(false)

  // ¿Está cerca del viewport? (margen de 1,5 pantallas arriba y abajo)
  useEffect(() => {
    const el = holderRef.current
    const root = rootRef.current
    if (!el || !root) return
    const io = new IntersectionObserver(([entry]) => setNear(!!entry?.isIntersecting), {
      root,
      rootMargin: '150% 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [rootRef])

  // Pintado: en un canvas NUEVO que sustituye al anterior solo al terminar → al
  // cambiar el zoom se ve el bitmap viejo estirado en vez de un hueco en blanco.
  useEffect(() => {
    const surface = surfaceRef.current
    if (!near || !surface || width <= 0) return
    let cancelled = false
    let task: RenderTask | null = null
    const canvas = document.createElement('canvas')
    canvas.className = styles.pdfCanvas!
    pdf
      .getPage(index)
      .then((page) => {
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        setAspect(base.height / base.width)
        const cssScale = width / base.width
        let ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR)
        const area = base.width * base.height * (cssScale * ratio) ** 2
        if (area > MAX_CANVAS_PIXELS) ratio *= Math.sqrt(MAX_CANVAS_PIXELS / area)
        const viewport = page.getViewport({ scale: cssScale * ratio })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        task = page.render({ canvas, viewport })
        return task.promise.then(() => {
          if (cancelled) return
          surface.querySelectorAll('canvas').forEach(freeCanvas)
          surface.replaceChildren(canvas)
          setPainted(true)
        })
      })
      .catch(() => {
        // cancelado (scroll/zoom) o página rota: se queda el placeholder
      })
    return () => {
      cancelled = true
      task?.cancel()
      if (!canvas.isConnected) freeCanvas(canvas)
    }
  }, [near, pdf, index, width])

  // Lejos del viewport (o desmontada) → fuera bitmap.
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const release = () => {
      surface.querySelectorAll('canvas').forEach(freeCanvas)
      surface.replaceChildren()
    }
    if (!near) {
      release()
      setPainted(false)
      return
    }
    return release
  }, [near])

  return (
    <div
      ref={holderRef}
      className={styles.pdfPage}
      style={{ width, height: Math.round(width * aspect) }}
      data-page={index}
      role="img"
      aria-label={`Página ${index} de ${total}`}
    >
      {!painted && (
        <span className={styles.pdfPageNum} aria-hidden="true">
          {index}
        </span>
      )}
      <div ref={surfaceRef} className={styles.pdfSurface} />
    </div>
  )
}

export default function PdfPreview({ path }: { path: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [zoomIdx, setZoomIdx] = useState(0)
  const [current, setCurrent] = useState(1)
  const [fitWidth, setFitWidth] = useState(0)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<{ x: number; y: number } | null>(null)
  const rafRef = useRef(0)

  // Carga: pdf.js (perezoso) + bytes en paralelo.
  useEffect(() => {
    let alive = true
    let task: PDFDocumentLoadingTask | null = null
    Promise.all([loadPdfjs(), fetchPdfBytes(path)])
      .then(async ([lib, data]) => {
        if (!alive) return
        // pdf.js 6 ya no compila código desde el PDF (sin eval) y no ejecuta su JS.
        task = lib.getDocument({ data })
        const pdf = await task.promise
        const first = (await pdf.getPage(1)).getViewport({ scale: 1 })
        if (alive) setState({ kind: 'ready', pdf, aspect: first.height / first.width })
      })
      .catch((err: unknown) => {
        if (alive) setState({ kind: 'error', text: pdfErrText(err) })
      })
    return () => {
      alive = false
      void task?.destroy()
      cancelAnimationFrame(rafRef.current)
    }
  }, [path])

  // Ancho disponible (rotación, split de pantalla…).
  const ready = state.kind === 'ready'
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setFitWidth(Math.max(0, el.clientWidth - SIDE_PADDING * 2)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready])

  // Tras cambiar el zoom, recoloca el scroll sobre el mismo punto del documento.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    const a = anchorRef.current
    if (!el || !a) return
    anchorRef.current = null
    el.scrollTop = a.y * el.scrollHeight - el.clientHeight / 2
    el.scrollLeft = a.x * el.scrollWidth - el.clientWidth / 2
  }, [zoomIdx])

  const zoomTo = (idx: number) => {
    const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx))
    if (next === zoomIdx) return
    const el = scrollerRef.current
    if (el) {
      anchorRef.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth),
        y: (el.scrollTop + el.clientHeight / 2) / Math.max(1, el.scrollHeight),
      }
    }
    setZoomIdx(next)
  }

  // Página actual = la última cuyo borde superior queda por encima del 1er tercio.
  const onScroll = () => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const el = scrollerRef.current
      if (!el) return
      const line = el.scrollTop + el.clientHeight / 3
      const pages = el.querySelectorAll<HTMLElement>('[data-page]')
      let lo = 0
      let hi = pages.length - 1
      let found = 0
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (pages[mid]!.offsetTop <= line) {
          found = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      setCurrent(found + 1)
    })
  }

  if (state.kind === 'error') {
    return (
      <div className={editorStyles.overlay}>
        <p className={editorStyles.overlayText}>no se pudo mostrar el PDF · {state.text}</p>
        <DownloadLink
          className={editorStyles.retry}
          path={path}
          name={basename(path)}
          ariaLabel={`Descargar ${basename(path)}`}
        >
          ⤓ Descargar
        </DownloadLink>
      </div>
    )
  }

  if (state.kind === 'loading') {
    return (
      <div className={editorStyles.overlay}>
        <span className={editorStyles.spinner} aria-hidden="true" />
        <p className={editorStyles.overlayText}>cargando {basename(path)}…</p>
      </div>
    )
  }

  const { pdf, aspect } = state
  const zoom = ZOOM_STEPS[zoomIdx]!
  const pageWidth = Math.floor(fitWidth * zoom)

  return (
    <div className={styles.viewer}>
      <div className={styles.bar} role="toolbar" aria-label="Controles del PDF">
        <span className={styles.barInfo}>
          <span className={styles.barNum}>{current}</span>
          <span className={styles.barFaint}> / {pdf.numPages}</span>
        </span>
        <div className={styles.zoom}>
          <button
            type="button"
            className={styles.barBtn}
            onClick={() => zoomTo(zoomIdx - 1)}
            disabled={zoomIdx === 0}
            aria-label="Alejar"
          >
            −
          </button>
          <button
            type="button"
            className={`${styles.barBtn} ${styles.zoomLabel}`}
            onClick={() => zoomTo(0)}
            disabled={zoomIdx === 0}
            aria-label={`Zoom ${Math.round(zoom * 100)} %. Ajustar al ancho`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className={styles.barBtn}
            onClick={() => zoomTo(zoomIdx + 1)}
            disabled={zoomIdx === ZOOM_STEPS.length - 1}
            aria-label="Acercar"
          >
            +
          </button>
        </div>
      </div>
      <div
        ref={scrollerRef}
        className={styles.pdfScroller}
        onScroll={onScroll}
        tabIndex={0}
        aria-label={`${basename(path)}, ${pdf.numPages} páginas`}
      >
        {pageWidth > 0 && (
          <div className={styles.pdfPages}>
            {Array.from({ length: pdf.numPages }, (_, i) => (
              <PdfPage
                key={i}
                pdf={pdf}
                index={i + 1}
                total={pdf.numPages}
                width={pageWidth}
                initialAspect={aspect}
                rootRef={scrollerRef}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
