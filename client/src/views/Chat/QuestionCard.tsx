// QuestionCard — tool-card de `AskUserQuestion` (DESIGN.md §6.5). Cuando Claude
// pregunta con opciones NO vale un Approve/Reject: hay que ELEGIR. Soporta lo
// que manda el engine: de 1 a 4 preguntas por llamada, selección única o
// múltiple por pregunta, y respuesta libre ("Otro…") cuando ninguna encaja.
//
// Contrato del puente (verificado contra el SDK): se devuelve
// `{enunciado: respuesta}`; en multiSelect las etiquetas van separadas por ", ".
// Hay que responder TODAS las preguntas: si se contesta a medias, el agente
// vuelve a preguntar lo que falta.
import { useState } from 'react'
import type { ChatQuestion, QuestionToolBlock } from './types'
import styles from './QuestionCard.module.css'

interface QuestionCardProps {
  block: QuestionToolBlock
  onAnswer: (requestId: string, answers: Record<string, string>) => void
  /** Descarta la pregunta sin responder (deny del permiso subyacente). */
  onDiscard: (requestId: string) => void
}

/** Respuesta compuesta de una pregunta: opciones marcadas + texto libre. */
interface Draft {
  labels: string[]
  otherOpen: boolean
  otherText: string
}

const EMPTY: Draft = { labels: [], otherOpen: false, otherText: '' }

/** Texto final que se envía para una pregunta ('' = sin responder). */
function draftAnswer(draft: Draft): string {
  const parts = [...draft.labels]
  const other = draft.otherOpen ? draft.otherText.trim() : ''
  if (other) parts.push(other)
  return parts.join(', ')
}

export default function QuestionCard({ block, onAnswer, onDiscard }: QuestionCardProps) {
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})

  const questions = block.questions
  // El estado de "ya respondida" NO se duplica aquí: `answerQuestion` marca la
  // card en el store al instante (y el `question_answered` del server la
  // confirma), así que basta con mirar el bloque.
  const pending = block.decision === 'pending' && Boolean(block.requestId)
  const draftOf = (i: number): Draft => drafts[i] ?? EMPTY

  const patch = (i: number, next: Partial<Draft>): void => {
    setDrafts((prev) => ({ ...prev, [i]: { ...(prev[i] ?? EMPTY), ...next } }))
  }

  const toggleOption = (i: number, q: ChatQuestion, label: string): void => {
    const draft = draftOf(i)
    if (!q.multiSelect) {
      // Selección única: elegir sustituye (y cierra la respuesta libre).
      patch(i, { labels: [label], otherOpen: false })
      return
    }
    const has = draft.labels.includes(label)
    patch(i, {
      labels: has ? draft.labels.filter((l) => l !== label) : [...draft.labels, label],
    })
  }

  const toggleOther = (i: number, q: ChatQuestion): void => {
    const draft = draftOf(i)
    if (draft.otherOpen) {
      patch(i, { otherOpen: false, otherText: '' })
      return
    }
    // En selección única, escribir libre descarta la opción marcada.
    patch(i, { otherOpen: true, ...(q.multiSelect ? {} : { labels: [] }) })
  }

  const answers: Record<string, string> = {}
  let complete = true
  questions.forEach((q, i) => {
    const answer = draftAnswer(draftOf(i))
    if (answer) answers[q.question] = answer
    else complete = false
  })

  const submit = (): void => {
    if (!complete || !block.requestId) return
    onAnswer(block.requestId, answers)
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          ?
        </span>
        <span className={styles.title}>Question</span>
        {questions.length > 1 && (
          <span className={styles.count}>{questions.length} preguntas</span>
        )}
      </div>

      {questions.map((q, i) => {
        const draft = draftOf(i)
        const answered = block.answers?.[q.question]
        const groupId = `${block.id}-q${i}`
        return (
          <div key={groupId} className={styles.question}>
            <span className={styles.chip}>{q.header}</span>
            <p className={styles.prompt} id={`${groupId}-label`}>
              {q.question}
            </p>

            {/* `role="group"` + `aria-pressed`, NO radiogroup: un radiogroup exige
                roving tabindex y navegación con flechas; aquí cada opción es un
                botón conmutable con su propio tab stop, y `aria-pressed` describe
                exactamente eso. Que la selección sea única o múltiple lo dice el
                enunciado (lo redacta el engine). */}
            {pending ? (
              <div className={styles.options} role="group" aria-labelledby={`${groupId}-label`}>
                {q.options.map((opt) => {
                  const on = draft.labels.includes(opt.label)
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      aria-pressed={on}
                      className={on ? `${styles.option} ${styles.optionOn}` : styles.option}
                      onClick={() => toggleOption(i, q, opt.label)}
                    >
                      <span className={styles.mark} aria-hidden="true">
                        {q.multiSelect ? (on ? '☑' : '☐') : on ? '●' : '○'}
                      </span>
                      <span className={styles.optionBody}>
                        <span className={styles.optionLabel}>{opt.label}</span>
                        {opt.description && (
                          <span className={styles.optionDesc}>{opt.description}</span>
                        )}
                      </span>
                    </button>
                  )
                })}

                <button
                  type="button"
                  aria-expanded={draft.otherOpen}
                  className={
                    draft.otherOpen ? `${styles.option} ${styles.optionOn}` : styles.option
                  }
                  onClick={() => toggleOther(i, q)}
                >
                  <span className={styles.mark} aria-hidden="true">
                    {draft.otherOpen ? '✎' : '＋'}
                  </span>
                  <span className={styles.optionBody}>
                    <span className={styles.optionLabel}>Otro…</span>
                    <span className={styles.optionDesc}>Responder con mis palabras</span>
                  </span>
                </button>

                {draft.otherOpen && (
                  <textarea
                    className={styles.other}
                    value={draft.otherText}
                    onChange={(e) => patch(i, { otherText: e.target.value })}
                    placeholder="Tu respuesta…"
                    aria-label={`Respuesta libre: ${q.question}`}
                    rows={2}
                    autoFocus
                  />
                )}
              </div>
            ) : (
              <p className={styles.answer}>
                {answered ? (
                  <>
                    <span className={styles.answerMark} aria-hidden="true">
                      ✓
                    </span>
                    {answered}
                  </>
                ) : block.decision === 'rejected' ? (
                  <span className={styles.discarded}>✕ Descartada</span>
                ) : block.decision === 'interrupted' ? (
                  // El turno se cortó (stop, o un mensaje nuevo): nadie la descartó.
                  <span className={styles.interrupted}>⚠ Interrumpida</span>
                ) : (
                  <span className={styles.unanswered}>Sin responder</span>
                )}
              </p>
            )}
          </div>
        )
      })}

      {pending && (
        <div className={styles.actions}>
          <button type="button" className={styles.send} disabled={!complete} onClick={submit}>
            Enviar respuestas
          </button>
          <button
            type="button"
            className={styles.discard}
            onClick={() => block.requestId && onDiscard(block.requestId)}
          >
            Descartar
          </button>
        </div>
      )}
    </div>
  )
}
