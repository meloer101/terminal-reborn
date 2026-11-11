// 已看 marks of Git · 变更 (合入链路 v2, PRD v1.170, Figma 73A) by worktree path, saved with the workspace
// (`workspace.json` › reviewMarks, see ../../state/persistence; validated on load by sanitizeReviewMarks). A save is asked
// for on every change; persistence coalesces them and main debounces the write.
import { create } from 'zustand'
import { pruneMarks, reviewFiles, type ViewedMarks } from '@shared/review-progress'
import type { GitChanges } from '@shared/git-graph/log'
import { addSnapshotPart, initialWorkspaceFile, requestSave } from '../../state/persistence'

interface State {
  byWorktree: Record<string, ViewedMarks>
}

export const useViewed = create<State>()(() => ({ byWorktree: initialWorkspaceFile()?.reviewMarks ?? {} }))

const NONE: ViewedMarks = {}

export const marksOf = (worktree: string): ViewedMarks => useViewed.getState().byWorktree[worktree] ?? NONE

export function setMarks(worktree: string, marks: ViewedMarks): void {
  if (marks === marksOf(worktree)) return
  useViewed.setState((s) => {
    const byWorktree = { ...s.byWorktree }
    if (Object.keys(marks).length > 0) byWorktree[worktree] = marks
    else delete byWorktree[worktree]
    return { byWorktree }
  })
}

/** After 变更 reloaded: the marks of rows that left the list go; a row whose diff changed keeps its (stale) mark. */
export function pruneViewed(worktree: string, changes: Pick<GitChanges, 'uncommitted' | 'committed'>): void {
  const marks = useViewed.getState().byWorktree[worktree]
  if (marks) setMarks(worktree, pruneMarks(marks, reviewFiles(changes)))
}

addSnapshotPart(() => {
  const { byWorktree } = useViewed.getState()
  return Object.keys(byWorktree).length > 0 ? { reviewMarks: byWorktree } : {}
})

useViewed.subscribe((state, prev) => {
  if (state.byWorktree !== prev.byWorktree) requestSave()
})
