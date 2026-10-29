// Vista Editor (DESIGN.md §7): pestañas de archivos abiertos, breadcrumb, área
// de código CodeMirror 6 con números de línea + syntax highlighting, guardado
// (Ctrl/Cmd+S) y barra de símbolos móvil. Consume useOpenFiles() (lista de
// pestañas) y la FS API (readFile/writeFile). El estado dirty y el contenido en
// edición se cachean POR RUTA en la propia vista, así cambiar de pestaña y
// volver conserva las ediciones no guardadas.
//
// Nota (v1): el split terminal del mockup queda pendiente (no implementado aquí).
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readFile,
  writeFile,
  ApiError,
  isImagePath,
  isPdfPath,
  isHtmlPath,
} from '../../api/client'
import { useOpenFiles } from '../../openfiles/OpenFilesProvider'
import DownloadLink from '../../components/DownloadLink/DownloadLink'
import CodeArea, { type CodeAreaHandle } from './CodeArea'
import EditorTabs from './EditorTabs'
import SymbolBar from './SymbolBar'
import PdfPreview from './PdfPreview'
import ImageViewer from './ImageViewer'
import HtmlPreview from './HtmlPreview'
import { basename, errText } from './fsText'
import styles from './EditorView.module.css'
import previewStyles from './Preview.module.css'

// 'binary' = archivo no-texto no-imagen (readFile devolvió 415): ni se edita ni
// se previsualiza, solo se descarga. Imágenes y PDFs ni pasan por aquí (§isMediaPath).
type DocStatus = 'loading' | 'ready' | 'error' | 'binary'

// Un .html se edita como código o se ve renderizado (DESIGN.md §7.2).
type HtmlMode = 'code' | 'preview'

/** Archivos que solo se VEN (visor propio desde /raw), nunca se leen como texto. */
const isMediaPath = (p: string): boolean => isImagePath(p) || isPdfPath(p)

/** Devuelve el record sin las claves que ya no están abiertas (misma ref si no cambia). */
function pruneRecord<T>(rec: Record<string, T>, keep: Set<string>): Record<string, T> {
  let changed = false
  const next: Record<string, T> = {}
  for (const key of Object.keys(rec)) {
    if (keep.has(key)) next[key] = rec[key]!
    else changed = true
  }
  return changed ? next : rec
}

/** Breadcrumb en mono --faint a partir del path (cola de hasta 4 segmentos). */
function Breadcrumb({ path }: { path: string }) {
  const segments = path.split('/').filter(Boolean)
  const shown = segments.length > 4 ? segments.slice(-4) : segments
  const truncated = segments.length > shown.length
  return (
    <nav className={styles.crumb} aria-label={`Ruta: ${path}`}>
      {truncated && (
        <span className={styles.crumbSep} aria-hidden="true">
          …
        </span>
      )}
      {shown.map((seg, i) => (
        <span key={i} className={styles.crumbItem}>
          {(i > 0 || truncated) && (
            <span className={styles.crumbSep} aria-hidden="true">
              ›
            </span>
          )}
          <span className={i === shown.length - 1 ? styles.crumbLeaf : undefined}>{seg}</span>
        </span>
      ))}
    </nav>
  )
}

export default function EditorView() {
  const { files, activePath, closeFile, setActive, replaceFile } = useOpenFiles()

  // Cache por ruta (no dispara render): contenido vivo + baseline guardado en disco.
  const contentRef = useRef<Map<string, string>>(new Map())
  const baselineRef = useRef<Map<string, string>>(new Map())
  const requestedRef = useRef<Set<string>>(new Set()) // rutas cuya carga ya se disparó
  const savingRef = useRef<Set<string>>(new Set()) // guardados en vuelo (anti doble-envío)
  const handleRef = useRef<CodeAreaHandle | null>(null) // handle del CodeArea montado

  // Estado que sí afecta al render, indexado por ruta.
  const [status, setStatus] = useState<Record<string, DocStatus>>({})
  const [loadError, setLoadError] = useState<Record<string, string>>({})
  const [truncated, setTruncated] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saveError, setSaveError] = useState<Record<string, string>>({})
  const [htmlMode, setHtmlMode] = useState<Record<string, HtmlMode>>({})
  const [savedTick, setSavedTick] = useState<Record<string, number>>({}) // recarga la vista HTML

  const loadFile = useCallback((path: string) => {
    setStatus((s) => ({ ...s, [path]: 'loading' }))
    setLoadError((e) => {
      if (!(path in e)) return e
      const n = { ...e }
      delete n[path]
      return n
    })
    readFile(path)
      .then((res) => {
        contentRef.current.set(path, res.content)
        baselineRef.current.set(path, res.content)
        setDirty((d) => ({ ...d, [path]: false }))
        if (res.truncated) setTruncated((tr) => ({ ...tr, [path]: true }))
        setStatus((s) => ({ ...s, [path]: 'ready' }))
      })
      .catch((err) => {
        // Binario no-imagen: no es un error de verdad, es "esto no se edita".
        // Lo mandamos a su propio estado (panel de descarga), no al de error.
        if (err instanceof ApiError && err.code === 'binary_file') {
          setStatus((s) => ({ ...s, [path]: 'binary' }))
          return
        }
        setLoadError((e) => ({ ...e, [path]: errText(err) }))
        setStatus((s) => ({ ...s, [path]: 'error' }))
      })
  }, [])

  // Carga perezosa: la primera vez que un archivo se vuelve activo. Imágenes y
  // PDFs NO se leen como texto (readFile los rechazaría con 415): se marcan como
  // solicitados y los pinta su visor (<ImageViewer>/<PdfPreview>) desde /raw.
  useEffect(() => {
    if (!activePath) return
    if (requestedRef.current.has(activePath)) return
    requestedRef.current.add(activePath)
    if (isMediaPath(activePath)) return
    loadFile(activePath)
  }, [activePath, loadFile])

  // Poda de cache/estado al cerrar archivos (evita fugas y puntos dirty huérfanos).
  useEffect(() => {
    const open = new Set(files.map((f) => f.path))
    for (const p of [...contentRef.current.keys()]) if (!open.has(p)) contentRef.current.delete(p)
    for (const p of [...baselineRef.current.keys()]) if (!open.has(p)) baselineRef.current.delete(p)
    for (const p of [...requestedRef.current]) if (!open.has(p)) requestedRef.current.delete(p)
    setStatus((s) => pruneRecord(s, open))
    setLoadError((e) => pruneRecord(e, open))
    setTruncated((t) => pruneRecord(t, open))
    setDirty((d) => pruneRecord(d, open))
    setSaving((s) => pruneRecord(s, open))
    setSaveError((e) => pruneRecord(e, open))
    setHtmlMode((m) => pruneRecord(m, open))
    setSavedTick((t) => pruneRecord(t, open))
  }, [files])

  // Edición del archivo activo: espeja contenido y recalcula dirty (solo re-render
  // cuando el booleano dirty cambia, no en cada pulsación).
  const handleDocChange = useCallback((path: string, content: string) => {
    contentRef.current.set(path, content)
    const isDirty = content !== (baselineRef.current.get(path) ?? content)
    setDirty((d) => (d[path] === isDirty ? d : { ...d, [path]: isDirty }))
    setSaveError((e) => {
      if (!(path in e)) return e
      const n = { ...e }
      delete n[path]
      return n
    })
  }, [])

  const saveActive = useCallback((path: string) => {
    const content = contentRef.current.get(path)
    if (content === undefined) return
    if (content === baselineRef.current.get(path)) return // nada que guardar
    if (savingRef.current.has(path)) return // ya hay un guardado en vuelo
    savingRef.current.add(path)
    setSaving((s) => ({ ...s, [path]: true }))
    setSaveError((e) => {
      if (!(path in e)) return e
      const n = { ...e }
      delete n[path]
      return n
    })
    writeFile(path, content)
      .then(() => {
        baselineRef.current.set(path, content)
        // El contenido pudo cambiar durante el guardado → recalcula dirty.
        const now = contentRef.current.get(path) ?? content
        setDirty((d) => ({ ...d, [path]: now !== content }))
        setSavedTick((t) => ({ ...t, [path]: (t[path] ?? 0) + 1 }))
      })
      .catch((err) => {
        setSaveError((e) => ({ ...e, [path]: errText(err) }))
      })
      .finally(() => {
        savingRef.current.delete(path)
        setSaving((s) => {
          if (!s[path]) return s
          const n = { ...s }
          delete n[path]
          return n
        })
      })
  }, [])

  const registerHandle = useCallback((h: CodeAreaHandle | null) => {
    handleRef.current = h
  }, [])
  const insertSymbol = useCallback((text: string) => {
    handleRef.current?.insert(text)
  }, [])

  // --- Estado vacío ------------------------------------------------------
  if (files.length === 0) {
    return (
      <main className={styles.view}>
        <h1 className={styles.srOnly}>Editor</h1>
        <div className={styles.empty}>
          <span className={styles.emptyGlyph} aria-hidden="true">
            {'{ }'}
          </span>
          <p className={styles.emptyTitle}>No hay archivos abiertos</p>
          <p className={styles.emptyHint}>Abre uno desde Files ▤</p>
        </div>
      </main>
    )
  }

  const active = activePath
  const activeIsImage = active ? isImagePath(active) : false
  const activeIsPdf = active ? isPdfPath(active) : false
  const activeIsMedia = activeIsImage || activeIsPdf
  const activeIsHtml = active ? isHtmlPath(active) : false
  const activePreview = activeIsHtml && !!active && htmlMode[active] === 'preview'
  // ¿Se muestra el área de código? (no en visores ni en la vista de un .html)
  const showCode = !!active && !activeIsMedia && !activePreview
  const activeStatus = active ? status[active] : undefined
  const activeTruncated = active ? !!truncated[active] : false
  const activeDirty = active ? !!dirty[active] : false
  const activeSaving = active ? !!saving[active] : false
  const activeSaveError = active ? saveError[active] : undefined
  // Imágenes/PDFs no pasan por readFile → su status queda undefined; no debe
  // disparar el overlay de carga del código (lo gestiona su visor).
  const isLoading = showCode && (activeStatus === undefined || activeStatus === 'loading')

  return (
    <main className={styles.view}>
      <h1 className={styles.srOnly}>Editor</h1>

      <EditorTabs
        files={files}
        activePath={active}
        dirty={dirty}
        onSelect={setActive}
        onClose={closeFile}
      />

      {active && (
        <div className={styles.header}>
          <Breadcrumb path={active} />
          {activeIsHtml && (
            <div className={previewStyles.modeSwitch} role="group" aria-label="Modo del archivo HTML">
              {(['code', 'preview'] as const).map((mode) => {
                const on = (htmlMode[active] ?? 'code') === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    className={on ? `${previewStyles.modeItem} ${previewStyles.modeActive}` : previewStyles.modeItem}
                    aria-pressed={on}
                    onClick={() => setHtmlMode((m) => ({ ...m, [active]: mode }))}
                  >
                    {mode === 'code' ? 'Código' : 'Vista'}
                  </button>
                )
              })}
            </div>
          )}
          {activeIsMedia ? (
            <DownloadLink
              className={styles.download}
              path={active}
              name={basename(active)}
              ariaLabel={`Descargar ${basename(active)}`}
            >
              ⤓ Descargar
            </DownloadLink>
          ) : (
            !activeTruncated && (
              <button
                type="button"
                className={activeDirty ? `${styles.save} ${styles.saveDirty}` : styles.save}
                disabled={activeSaving || !activeDirty}
                onClick={() => saveActive(active)}
                aria-label="Guardar archivo"
              >
                {activeSaving ? (
                  <>
                    <span className={styles.spinnerSm} aria-hidden="true" />
                    Guardando…
                  </>
                ) : (
                  'Guardar'
                )}
              </button>
            )
          )}
        </div>
      )}

      {activeTruncated && (
        <div className={styles.notice} role="status">
          archivo truncado · solo lectura
        </div>
      )}

      {activeSaveError && (
        <div className={styles.saveError} role="alert">
          no se pudo guardar · {activeSaveError}
        </div>
      )}

      <div
        className={styles.stage}
        role="tabpanel"
        aria-label={active ? `${showCode ? 'Editando' : 'Viendo'} ${basename(active)}` : 'Editor'}
      >
        {active && activeIsImage && (
          <ImageViewer path={active} onNavigate={(to) => replaceFile(active, to)} />
        )}
        {active && activeIsPdf && <PdfPreview key={active} path={active} />}
        {active && activePreview && (
          <HtmlPreview
            key={active}
            path={active}
            dirty={activeDirty}
            reloadSignal={savedTick[active] ?? 0}
          />
        )}
        {active && showCode && activeStatus === 'ready' && (
          <CodeArea
            key={active}
            path={active}
            initialDoc={contentRef.current.get(active) ?? ''}
            editable={!activeTruncated}
            onChange={(content) => handleDocChange(active, content)}
            onSave={() => saveActive(active)}
            registerHandle={registerHandle}
          />
        )}
        {active && showCode && activeStatus === 'binary' && (
          <div className={styles.overlay}>
            <span className={styles.binaryGlyph} aria-hidden="true">
              ▢
            </span>
            <p className={styles.overlayText}>archivo binario · no se puede editar</p>
            <DownloadLink
              className={styles.retry}
              path={active}
              name={basename(active)}
              ariaLabel={`Descargar ${basename(active)}`}
            >
              ⤓ Descargar
            </DownloadLink>
          </div>
        )}
        {active && isLoading && (
          <div className={styles.overlay}>
            <span className={styles.spinner} aria-hidden="true" />
            <p className={styles.overlayText}>cargando {basename(active)}…</p>
          </div>
        )}
        {active && showCode && activeStatus === 'error' && (
          <div className={styles.overlay}>
            <p className={styles.overlayText}>{(active && loadError[active]) ?? 'error al cargar'}</p>
            <button type="button" className={styles.retry} onClick={() => loadFile(active)}>
              Reintentar
            </button>
            <DownloadLink
              className={styles.retry}
              path={active}
              name={basename(active)}
              ariaLabel={`Descargar ${basename(active)}`}
            >
              ⤓ Descargar
            </DownloadLink>
          </div>
        )}
      </div>

      {/* Los símbolos solo sirven al teclear código; en los visores, su hueco
          inferior (barra de nav + safe-area) lo reserva un separador vacío. */}
      {showCode ? <SymbolBar onInsert={insertSymbol} /> : <div className={styles.navSpacer} aria-hidden="true" />}
    </main>
  )
}
