// Vista previa de un .html (DESIGN.md §7.2). Pide al backend una URL
// tokenizada (POST /api/fs/preview) y la carga en un <iframe sandbox> SIN
// allow-same-origin: el JS de la página corre en un origen opaco, sin acceso a
// la app, la API ni la cookie. Sus assets relativos (CSS/JS/imágenes de la misma
// carpeta) los sirve el token. Enseña lo GUARDADO en disco, no el buffer.
import { useEffect, useState } from 'react'
import { openHtmlPreview } from '../../api/client'
import { basename, errText } from './fsText'
import editorStyles from './EditorView.module.css'
import styles from './Preview.module.css'

// Mismos flags que la cabecera CSP del backend (PREVIEW_SANDBOX en preview.ts).
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups'

type PreviewState = { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'error'; text: string }

interface HtmlPreviewProps {
  path: string
  /** Hay cambios sin guardar: la vista no los refleja (lo avisamos). */
  dirty: boolean
  /** Cambia tras cada guardado → recarga la vista con lo nuevo. */
  reloadSignal: number
}

export default function HtmlPreview({ path, dirty, reloadSignal }: HtmlPreviewProps) {
  const [state, setState] = useState<PreviewState>({ kind: 'loading' })
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [nonce, setNonce] = useState(0) // ↻ manual

  // Token nuevo en cada carga/recarga (son baratos y caducan solos).
  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    setFrameLoaded(false)
    openHtmlPreview(path)
      .then(({ url }) => {
        if (alive) setState({ kind: 'ready', url })
      })
      .catch((err: unknown) => {
        if (alive) setState({ kind: 'error', text: errText(err) })
      })
    return () => {
      alive = false
    }
  }, [path, nonce, reloadSignal])

  const name = basename(path)

  return (
    <div className={styles.viewer}>
      <div className={styles.bar} role="toolbar" aria-label="Controles de la vista previa">
        {dirty ? (
          <span className={`${styles.barInfo} ${styles.barWarn}`}>sin guardar · se ve lo de disco</span>
        ) : (
          <span className={`${styles.barInfo} ${styles.barFaint}`}>vista previa · aislada</span>
        )}
        <button
          type="button"
          className={styles.barBtn}
          onClick={() => setNonce((n) => n + 1)}
          aria-label="Recargar vista previa"
        >
          ↻
        </button>
      </div>
      <div className={styles.frameStage}>
        {state.kind === 'ready' && (
          <iframe
            key={state.url}
            className={styles.frame}
            src={state.url}
            sandbox={SANDBOX}
            referrerPolicy="no-referrer"
            title={`Vista previa de ${name}`}
            onLoad={() => setFrameLoaded(true)}
            style={frameLoaded ? undefined : { visibility: 'hidden' }}
          />
        )}
        {state.kind === 'error' ? (
          <div className={editorStyles.overlay}>
            <p className={editorStyles.overlayText}>no se pudo abrir la vista previa · {state.text}</p>
            <button type="button" className={editorStyles.retry} onClick={() => setNonce((n) => n + 1)}>
              Reintentar
            </button>
          </div>
        ) : (
          !frameLoaded && (
            <div className={editorStyles.overlay}>
              <span className={editorStyles.spinner} aria-hidden="true" />
              <p className={editorStyles.overlayText}>cargando {name}…</p>
            </div>
          )
        )}
      </div>
    </div>
  )
}
