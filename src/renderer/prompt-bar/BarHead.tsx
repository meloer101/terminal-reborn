import { StatusGlyph } from '../ui/StatusGlyph'
import styles from './PromptBar.module.css'

/** Figma PromptBar › Head: attention glyph, what is asked, the command / header in mono, optional "1 / N". */
export function BarHead({ title, detail, counter }: { title: string; detail?: string; counter?: string | null }) {
  return (
    <div className={styles.head}>
      <span className={styles.glyph}>
        <StatusGlyph status="needs_you" />
      </span>
      <p className={styles.title} title={title}>
        {title}
      </p>
      {detail !== undefined && (
        <p className={styles.detail} title={detail}>
          {detail}
        </p>
      )}
      {counter && <span className={styles.counter}>{counter}</span>}
    </div>
  )
}
