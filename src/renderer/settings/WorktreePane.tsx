// Settings · Worktree (Figma 16A): where new port blocks start. Already-assigned directories keep their block;
// applySettingsPatch clamps the number.
import { useRef, useState } from 'react'
import { PORT_BASE_LIMITS } from '@shared/ports'
import { Row, Section } from './controls'
import styles from './WorktreePane.module.css'

export function WorktreePane({ base, update }: { base: number; update: (base: number) => void }) {
  return (
    <div className={styles.page}>
      <div className={styles.form}>
        <h1 className={styles.title}>Worktree</h1>
        <Section title="端口">
          <Row label="起始端口">
            <PortField value={base} onCommit={update} />
          </Row>
          <p className={styles.hint}>
            每个目录分到 10 个连续端口。TR_PORT 是其中的第一个。已经分过的目录仍用原来的一段；改起点只影响之后新分的目录。
          </p>
        </Section>
      </div>
    </div>
  )
}

function PortField({ value, onCommit }: { value: number; onCommit: (base: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const skipBlur = useRef(false)
  const shown = draft ?? String(value)
  const commit = (text: string): void => {
    if (!/^\d+$/.test(text)) {
      setDraft(null)
      return
    }
    const next = Number(text)
    if (next !== value) onCommit(next)
    setDraft(null)
  }
  return (
    <input
      className={styles.port}
      inputMode="numeric"
      aria-label="起始端口"
      autoComplete="off"
      spellCheck={false}
      min={PORT_BASE_LIMITS.min}
      max={PORT_BASE_LIMITS.max}
      value={shown}
      onChange={(event) => setDraft(event.currentTarget.value.replace(/\D/g, '').slice(0, 5))}
      onBlur={() => {
        if (skipBlur.current) {
          skipBlur.current = false
          return
        }
        commit(shown)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          skipBlur.current = true
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
