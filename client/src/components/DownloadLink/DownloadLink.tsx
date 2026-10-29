// Enlace de descarga robusto para la PWA (DESIGN.md §7.1 · §8). Fuera de la PWA
// es un <a download> nativo (streaming, sin tocar memoria). En standalone (iOS)
// intercepta el toque y descarga sin navegar la página (download.ts), con un
// spinner mientras trabaja — así el botón nunca "no hace nada" en silencio.
import { useState, type MouseEvent, type ReactNode } from 'react'
import { fsDownloadUrl } from '../../api/client'
import { downloadFsPath, isStandaloneDisplay } from '../../api/download'
import styles from './DownloadLink.module.css'

interface DownloadLinkProps {
  /** Ruta absoluta dentro de FS_ROOT (archivo o carpeta). */
  path: string
  /** Nombre con el que guardar. Para carpetas, incluye el `.zip`. */
  name: string
  /** Clase del sitio que lo usa (hereda el aspecto del botón/enlace). */
  className?: string
  ariaLabel: string
  children: ReactNode
}

export default function DownloadLink({
  path,
  name,
  className,
  ariaLabel,
  children,
}: DownloadLinkProps) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // No abrir el archivo ni plegar la carpeta de la fila que lo contiene.
    e.stopPropagation()
    // Navegador normal: la descarga nativa del <a download> va bien y hace
    // streaming; no la interceptamos.
    if (!isStandaloneDisplay()) return
    // PWA standalone (iOS): navegar atascaría la app → lo hacemos por JS.
    e.preventDefault()
    if (pending) return
    setFailed(false)
    setPending(true)
    downloadFsPath(path, name)
      .catch(() => setFailed(true))
      .finally(() => setPending(false))
  }

  return (
    <a
      className={`${className ?? ''}${failed ? ` ${styles.failed}` : ''}`}
      href={fsDownloadUrl(path)}
      download={name}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      title={failed ? 'no se pudo descargar · reintenta' : undefined}
      onClick={onClick}
    >
      {pending ? <span className={styles.spinner} aria-hidden="true" /> : children}
    </a>
  )
}
