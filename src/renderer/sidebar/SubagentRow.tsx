import { memo } from 'react'
import type { SessionId } from '@shared/types'
import { StatusGlyph } from '../ui/StatusGlyph'
import { sameSubagent, type SubagentRowModel } from './model'
import styles from './SubagentRow.module.css'

interface Props {
  row: SubagentRowModel
  /** Selects the session the subagent runs in: the subagent itself is no session. */
  onSelect(id: SessionId): void
}

/**
 * Figma 44B SubagentRow: a subagent the agent started inside its session — one line (status · task · model), hung
 * under the session on the tree line. Display only: no branch, no agent mark, no keyboard stop (PRD F21 v1.109).
 */
export const SubagentRow = memo(
  function SubagentRow({ row, onSelect }: Props) {
    return (
      <div className={styles.row} data-testid="subagent-row" data-agent-id={row.id} data-depth={row.depth} data-tree={row.tree} data-attention={row.attention} onClick={() => onSelect(row.sessionId)}>
        <span className={styles.line}>
          <span className={styles.glyph}>
            <StatusGlyph status={row.attention ? 'needs_you' : 'running'} />
          </span>
          <span className={styles.title}>{row.title}</span>
          {row.model && <span className={styles.model}>{row.model}</span>}
        </span>
        {row.pass && <span className={styles.pass} aria-hidden />}
      </div>
    )
  },
  (a, b) => sameSubagent(a.row, b.row) && a.row.sessionId === b.row.sessionId && a.onSelect === b.onSelect
)
