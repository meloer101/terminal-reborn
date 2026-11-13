// 终端 view (PRD F17, Figma 76A / 76B): shells in the active session's worktree, one tab each.
import type { Worktree } from '@shared/types'
import { PaneHeader } from '../PaneHeader'

export function TerminalView({ worktree }: { worktree: Worktree }) {
  return <PaneHeader title="终端" context={worktree.branch} />
}
