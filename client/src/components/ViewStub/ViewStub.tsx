// ViewStub — marcador de sitio de una vista (patrón repetido → extraído, CLAUDE.md §9).
// Estructura del mockup: cabecera fija con el título + cuerpo scrollable
// (el scroll vive dentro del <main> de la vista, DESIGN.md §5).
import styles from './ViewStub.module.css'

interface ViewStubProps {
  title: string
  /** Nota breve de lo que traerá la vista (texto en --dim) */
  description: string
  /** Eyebrow mono en --faint; por defecto la vista llega en Fase 2 */
  eyebrow?: string
}

export default function ViewStub({
  title,
  description,
  eyebrow = 'Próximamente — Fase 2',
}: ViewStubProps) {
  return (
    <main className={styles.view}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
      </header>

      <div className={styles.body}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <p className={styles.description}>{description}</p>
        {/* Prompt de marca (❯ + cursor); decorativo */}
        <p className={styles.prompt} aria-hidden="true">
          ❯<span className={styles.cursor} />
        </p>
      </div>
    </main>
  )
}
