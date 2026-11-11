import { memo } from 'react'
import type { SessionId } from '@shared/types'
import { StatusGlyph } from '../ui/StatusGlyph'
import { sameSubagent, type SubagentRowModel } from './model'
import styles from './SubagentRow.module.css'

interface Props {
  row: SubagentRowModel
  /** Selects the session the subagent runs in: the subagent itself is no session. */
  onSelect(id: SessionId): void
  /** A workflow run's row folds or unfolds its phases (Figma 74D). */
  onToggle?(id: string): void
}

/**
 * Figma 44B SubagentRow: a subagent the agent started inside its session — one line (status · task · model), hung
 * under the session on the tree line. Display only: no branch, no agent mark, no keyboard stop (PRD F21 v1.109).
 */
export const SubagentRow = memo(
  function SubagentRow({ row, onSelect, onToggle }: Props) {
    // Figma 74D: a workflow run (state · name · current phase done / all) and its phases hang here like subagents.
    const folds = row.kind === 'workflow' && onToggle
    return (
      <div
        className={styles.row}
        data-testid={row.kind ? `${row.kind}-row` : 'subagent-row'}
        data-agent-id={row.id}
        data-kind={row.kind}
        data-depth={row.depth}
        data-tree={row.tree}
        data-attention={row.attention}
        onClick={() => (folds ? onToggle(row.id) : onSelect(row.sessionId))}
      >
        <span className={styles.line}>
          <span className={styles.glyph}>
            <StatusGlyph status={row.glyph ?? (row.attention ? 'needs_you' : 'running')} />
          </span>
          <span className={styles.title}>{row.title}</span>
          {(row.right ?? row.model) && <span className={styles.model}>{row.right ?? row.model}</span>}
        </span>
        {row.pass && <span className={styles.pass} aria-hidden />}
      </div>
    )
  },
  (a, b) => sameSubagent(a.row, b.row) && a.row.sessionId === b.row.sessionId && a.onSelect === b.onSelect && a.onToggle === b.onToggle
)
