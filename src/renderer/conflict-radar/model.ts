// Which worktrees the conflict radar watches, and what 让 agent rebase puts into the agent's input line (not sent; the
// user reads it and presses Enter, PRD §2 / §6.9): the base moved, how far behind the branch is, which files will
// conflict, and how to rebase without an editor.
import type { RadarMark, RadarTarget, RadarWorktree } from '@shared/conflict-radar'
import type { MergeConflict } from '@shared/git-merge'
import type { Project, Session, Worktree } from '@shared/types'
import { conflictReason, MAX_PROMPT_CHARS } from '../panels/merge/model'

const MAX_PROMPT_FILES = 10

export function rebasePrompt(self: Pick<RadarWorktree, 'base' | 'branch' | 'behind' | 'baseConflicts' | 'uncommitted'>): string {
  const head = `${self.base} 已经合入了别的改动，${self.branch} 落后 ${self.behind} 个提交。`
  const commit = self.uncommitted ? '先提交当前的改动，再' : ''
  const tail = `请在当前 worktree 里${commit}运行 GIT_EDITOR=true git rebase ${self.base}，有冲突就解决后 git add 并 GIT_EDITOR=true git rebase --continue，确认构建和测试通过，完成后告诉我。`
  const total = self.baseConflicts.length
  if (total === 0) return `${head}预计不会冲突。${tail}`
  const lead = 'rebase 时会冲突：'
  const files: string[] = []
  for (const conflict of self.baseConflicts.slice(0, MAX_PROMPT_FILES)) {
    const next = [...files, `${conflict.path}（${conflictReason(conflict)}）`]
    const more = next.length < total ? ` 等 ${total} 个文件` : ''
    if (files.length > 0 && head.length + lead.length + next.join('、').length + more.length + 1 + tail.length > MAX_PROMPT_CHARS) break
    files.push(next[next.length - 1]!)
  }
  const more = files.length < total ? ` 等 ${total} 个文件` : ''
  return `${head}${lead}${files.join('、')}${more}。${tail}`
}

/**
 * The active worktrees: not archived, with at least one session (pure). `stamp` is the latest turn end of their
 * sessions, so main looks at uncommitted files again when an agent finishes a turn.
 */
export function radarTargets(state: { projects: readonly Project[]; worktrees: readonly Worktree[]; sessions: readonly Session[] }): RadarTarget[] {
  const roots = new Map(state.projects.map((p) => [p.id, p.rootPath]))
  const stamps = new Map<string, number>()
  for (const session of state.sessions) stamps.set(session.worktreeId, Math.max(stamps.get(session.worktreeId) ?? 0, session.finishedAt ?? 0))
  const targets: RadarTarget[] = []
  for (const worktree of state.worktrees) {
    const root = roots.get(worktree.projectId)
    const stamp = stamps.get(worktree.id)
    if (root && stamp !== undefined && !worktree.archived) targets.push({ root, worktree: worktree.path, stamp })
  }
  return targets
}

/** The Worktree view's detail lines for a mark: one per conflicting worktree, one for the base, one for a moved base. */
export function radarDetailLines(mark: RadarMark): { label: string; value: string; title: string }[] {
  const files = (conflicts: readonly MergeConflict[]): string => conflicts.map((c) => c.path).join('、')
  const reasons = (conflicts: readonly MergeConflict[]): string => conflicts.map((c) => `${c.path}（${conflictReason(c)}）`).join('\n')
  const lines = mark.pairs.map((pair) => ({ label: '冲突', value: `${pair.name} · ${files(pair.conflicts)}`, title: `和 ${pair.name} 会冲突：\n${reasons(pair.conflicts)}` }))
  const { self } = mark
  if (self.baseConflicts.length > 0) {
    lines.push({ label: '冲突', value: `${self.base} · ${files(self.baseConflicts)}`, title: `合并到 ${self.base} 会冲突：\n${reasons(self.baseConflicts)}` })
  }
  if (self.behind > 0 && (self.baseMoved || self.baseConflicts.length > 0)) {
    const text = `${self.base} 已前进，落后 ${self.behind} 个提交`
    lines.push({ label: '落后', value: text, title: text })
  }
  if (lines.length > 0 && self.uncommitted) lines.push({ label: '', value: '含未提交的改动', title: '冲突检查包括还没提交的改动' })
  return lines
}
