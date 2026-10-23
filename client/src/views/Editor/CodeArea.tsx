// CodeArea — instancia de CodeMirror 6 para el archivo activo. La vista Editor
// la remonta con key={path}, así cada archivo arranca con su contenido cacheado
// (el estado dirty/no-guardado se conserva a nivel de vista, no aquí). Expone un
// handle imperativo `insert()` para la barra de símbolos.
import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, bracketMatching, indentUnit } from '@codemirror/language'
import { buildThemeExtensions } from './cmTheme'
import { languageForPath } from './languages'
import styles from './EditorView.module.css'

export interface CodeAreaHandle {
  /** Inserta texto en la selección/cursor actual (barra de símbolos). */
  insert: (text: string) => void
  focus: () => void
}

interface CodeAreaProps {
  /** Contenido inicial; se lee SOLO al montar (la vista remonta con key={path}). */
  initialDoc: string
  /** Ruta activa: fija el lenguaje del resaltado. */
  path: string
  /** false = solo lectura (p.ej. archivo truncado, evita sobrescribir en disco). */
  editable: boolean
  onChange: (content: string) => void
  onSave: () => void
  registerHandle: (handle: CodeAreaHandle | null) => void
}

export default function CodeArea({
  initialDoc,
  path,
  editable,
  onChange,
  onSave,
  registerHandle,
}: CodeAreaProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // Callbacks vía ref: el listener/keymap de CM se crean una vez pero deben
  // llamar siempre a la última versión (evita cierres obsoletos).
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const themeCompartment = new Compartment()

    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) onChangeRef.current(u.state.doc.toString())
    })

    // Ctrl/Cmd+S → guardar (preventDefault corta el "guardar página" del navegador).
    const saveKey = keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          onSaveRef.current()
          return true
        },
      },
    ])

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        highlightSpecialChars(),
        history(),
        indentOnInput(),
        bracketMatching(),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        EditorState.readOnly.of(!editable),
        EditorView.editable.of(editable),
        languageForPath(path),
        saveKey,
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        listener,
        themeCompartment.of(buildThemeExtensions()),
      ],
    })

    const view = new EditorView({ state, parent: host })

    const handle: CodeAreaHandle = {
      insert(text) {
        const { from, to } = view.state.selection.main
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          scrollIntoView: true,
          userEvent: 'input.type',
        })
        view.focus()
      },
      focus() {
        view.focus()
      },
    }
    registerHandle(handle)

    // Reaplicar el tema al cambiar data-theme (Settings → Appearance), como TerminalView.
    const observer = new MutationObserver(() => {
      view.dispatch({ effects: themeCompartment.reconfigure(buildThemeExtensions()) })
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      observer.disconnect()
      registerHandle(null)
      // iOS/WebKit: destruir un `contenteditable` ENFOCADO con el teclado virtual
      // subido puede colgar el renderer al navegar (la app "se recarga" y a veces
      // te saca del standalone del PWA). Desenfocar antes de destruir cierra el
      // teclado de forma ordenada y quita el foco del nodo que se va a eliminar.
      if (view.hasFocus) view.contentDOM.blur()
      view.destroy()
    }
    // Montaje único por archivo: initialDoc/path/editable se capturan al montar;
    // la vista fuerza remonte con key={path}. Re-ejecutar por cambios de prop
    // reiniciaría el editor y perdería la edición en curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className={styles.cmHost} />
}
