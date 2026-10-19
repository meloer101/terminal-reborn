// Settings · Worktree (Figma 16A): where new port blocks start (already-assigned directories keep their block;
// applySettingsPatch clamps the number), and whether a merge that kept the worktree archives it (PRD F15).
import { useRef, useState } from 'react'
import { PORT_BASE_LIMITS } from '@shared/ports'
import { Row, Section, Toggle } from './controls'
import styles from './WorktreePane.module.css'

export function WorktreePane({
  base,
  update,
  archiveAfterMerge,
  updateArchiveAfterMerge
}: {
  base: number
  update: (base: number) => void
  archiveAfterMerge: boolean
  updateArchiveAfterMerge: (on: boolean) => void
}) {
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
        <Section title="归档">
          <Row label="合并后自动归档">
            <Toggle label="合并后自动归档" checked={archiveAfterMerge} onChange={updateArchiveAfterMerge} />
          </Row>
          <p className={styles.hint}>合并后没有删除的 worktree 会归档：停下会话、运行 archive 脚本、侧栏里收起来。可以在跳转（⌘K）的历史里恢复。</p>
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
