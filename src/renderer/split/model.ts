// What the split's panes show besides terminals (PRD F20 · Figma 21): the new pane's session list after ⌘D / ⇧⌘D,
// and the words on a drop target. Pure.
import { hasPane, sessionsIn, type SplitDrop, type SplitNode } from '@shared/split-layout'
import type { Project, Session, SessionId, Worktree } from '@shared/types'
import { buildOverview, type OverviewRow } from '../overview/model'
import { buildSidebarGroups, visibleSessionIds } from '../sidebar/model'

export interface PickerInput {
  projects: Project[]
  worktrees: Worktree[]
  sessions: Session[]
  split: SplitNode | null
  now: number
  /** Free text plus `p:项目` / `s:状态`, as in the overview's filter. */
  filter: string
}

/** Sessions the new pane can show: every listed one not shown already, in sidebar order (folded projects too). */
export function pickerRows({ projects, worktrees, sessions, split, now, filter }: PickerInput): OverviewRow[] {
  const shown = new Set(sessionsIn(split))
  const order = new Map(visibleSessionIds(buildSidebarGroups({ projects, worktrees, sessions, collapsedProjectIds: [] })).map((id, i) => [id, i]))
  return buildOverview({ projects, worktrees, sessions, now, filter })
    .flatMap((group) => group.rows)
    .filter((row) => !shown.has(row.session.id) && order.has(row.session.id))
    .sort((a, b) => (order.get(a.session.id) ?? 0) - (order.get(b.session.id) ?? 0))
}

/** The caption on a drop target (Figma 21D / 21E). */
export function dropLabel(drop: SplitDrop, dragged: SessionId, root: SplitNode | null): string {
  if ('refused' in drop) return drop.refused === 'max' ? '最多 4 格 · 放到格子中间来替换' : '这里放不下新的一格 · 放到格子中间来替换'
  const moving = hasPane(root, dragged)
  if (drop.zone === 'center') return moving ? '松开交换这两格' : '松开换掉这一格'
  return moving ? '松开把这一格挪到这里' : '松开在这里显示这个会话'
}
