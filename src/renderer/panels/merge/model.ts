// What the merge sheet (PRD F4, Figma 05) says about a precheck, its options and a result. Pure.
import type { GitOperation, MergeBlocker, MergeConflict, MergeMethod, MergePrecheck, MergeResult } from '@shared/git-merge'
import type { AgentKind, Session } from '@shared/types'
import { checksText, checksVerdict, type TurnCheckView } from '@shared/turn-checks'

export type CheckTone = 'ok' | 'warn' | 'error' | 'working'

export interface CheckLine {
  tone: CheckTone
  text: string
  /** Right-aligned, monospaced (↑3, ↓1). */
  meta?: string
}

const OPERATION: Record<GitOperation, string> = { merge: '合并', rebase: '变基', 'cherry-pick': 'cherry-pick', revert: 'revert' }

/** One line for a blocker; the sheet offers nothing but 关闭 then. */
export function blockerText(blocker: MergeBlocker, check: Pick<MergePrecheck, 'base' | 'branch'>): string {
  switch (blocker.kind) {
    case 'detached':
      return '这个 worktree 不在任何分支上'
    case 'no-base':
      return '不知道要合并到哪个分支'
    case 'base-missing':
      return `${blocker.base} 不是本地分支`
    case 'busy':
      return `${blocker.where === 'worktree' ? '这个 worktree' : `${check.base} 所在的目录`}正在${OPERATION[blocker.operation]}，先完成或中止它`
    case 'nothing':
      return `${check.branch} 没有 ${check.base} 之外的提交，没有要合并的内容`
    case 'old-git':
      return 'git 版本太旧，需要 2.38 或更新'
    case 'base-dirty':
      return `${check.base} 所在的目录有未提交的改动，和这次合并改到了同样的文件：${blocker.files.join('、')}`
    case 'main':
      return '这是项目主目录，没有要合并到的分支'
    case 'worktree-dirty':
      return 'worktree 里有未提交的改动，不能 rebase'
    case 'unverified':
      return `检查失败：${blocker.message}`
  }
}

/** The checklist under the title, most important first. */
export function checkLines(check: MergePrecheck): CheckLine[] {
  const lines: CheckLine[] = []
  if (check.blocker && check.blocker.kind !== 'nothing') return [{ tone: 'error', text: blockerText(check.blocker, check) }]
  if (check.blocker?.kind === 'nothing') lines.push({ tone: 'error', text: blockerText(check.blocker, check) })
  else lines.push({ tone: 'ok', text: `领先 ${check.base} ${check.ahead} 个提交`, meta: `↑${check.ahead}` })
  if (check.conflicts.length > 0) {
    lines.push({
      tone: 'warn',
      text: check.behind > 0 ? `${check.base} 有 ${check.behind} 个新提交，与本分支冲突` : `与 ${check.base} 冲突`,
      meta: check.behind > 0 ? `↓${check.behind}` : undefined
    })
  } else if (check.behind > 0 && !check.blocker) {
    lines.push({ tone: 'ok', text: `${check.base} 有 ${check.behind} 个新提交，可以自动合并`, meta: `↓${check.behind}` })
  }
  if (check.uncommitted === null) lines.push({ tone: 'warn', text: '读不出 worktree 里有没有未提交的改动' })
  else if (check.uncommitted > 0) lines.push({ tone: 'warn', text: `worktree 里有 ${check.uncommitted} 个未提交的改动，不会合并进去` })
  if (check.upstream && check.upstreamAhead > 0) {
    lines.push({ tone: 'warn', text: `${check.upstream} 有 ${check.upstreamAhead} 个提交还没拉到本地 ${check.base}` })
  }
  return lines
}

/** One line of the merge checklist for `[scripts] test` (Figma 16B). Absent when the file has no test. */
export type MergeTestState =
  | { status: 'running'; command: string }
  | { status: 'passed'; command: string }
  | { status: 'failed'; command: string; code: number | null; output: string }
  | { status: 'declined'; command: string }

export interface TestCheckLine extends CheckLine {
  /** Captured tail, under the line, when the test failed and printed something. */
  output?: string
  /** Ghost “重新运行”. */
  rerun?: boolean
}

/** The command as one line of meta (a multi-line script collapses). */
export function testMeta(script: string): string {
  return script.replace(/\s+/g, ' ').trim()
}

export function testLine(state: MergeTestState): TestCheckLine {
  const meta = testMeta(state.command)
  switch (state.status) {
    case 'running':
      return { tone: 'working', text: '正在运行测试…', meta }
    case 'passed':
      return { tone: 'ok', text: '测试通过', meta }
    case 'failed':
      return {
        tone: 'error',
        text: state.code === null ? '测试没能运行' : `测试没通过（退出码 ${state.code}）`,
        meta,
        ...(state.output.trim() !== '' ? { output: state.output.trim() } : {}),
        rerun: true
      }
    case 'declined':
      return { tone: 'error', text: '没有允许运行测试', meta, rerun: true }
  }
}

/** A configured test blocks 合并 until it exits 0. No test does not. */
export function testBlocksMerge(state: MergeTestState | null, hasTest: boolean): boolean {
  if (!hasTest) return false
  return state?.status !== 'passed'
}

const CONFLICT_TYPE: Record<string, string> = {
  content: '两边都改了同一处',
  'add/add': '两边都新增了这个文件',
  'modify/delete': '一边修改、一边删除',
  'rename/delete': '一边重命名、一边删除',
  'rename/rename': '两边重命名成不同的名字',
  'file/directory': '一边是文件、一边是文件夹',
  binary: '二进制文件两边都改了'
}

export function conflictReason(conflict: MergeConflict): string {
  return CONFLICT_TYPE[conflict.type] ?? conflict.type
}

/** Methods the sheet offers, with why one is off. */
export function methodOptions(check: MergePrecheck): { value: MergeMethod; label: string; disabled: boolean }[] {
  const dirty = check.uncommitted !== 0
  return [
    { value: 'squash', label: 'Squash', disabled: false },
    { value: 'merge', label: 'Merge', disabled: false },
    { value: 'rebase', label: 'Rebase', disabled: dirty }
  ]
}

export const METHOD_NOTE: Record<MergeMethod, string> = {
  squash: '分支上的提交压成一个提交',
  merge: '保留分支上的每个提交，再加一个合并提交',
  rebase: '把分支接到最新的基线上，历史是一条直线'
}

const BUSY: ReadonlySet<Session['status']> = new Set(['running', 'needs_you'])

/** Why the worktree cannot be removed after the merge; null when it can. */
export function removeBlocker(check: MergePrecheck, sessions: readonly Pick<Session, 'status'>[], isMain: boolean): string | null {
  if (isMain) return '项目主目录不会被删除'
  if (check.uncommitted !== 0) return '有未提交的改动，合并后保留 worktree'
  if (sessions.some((s) => BUSY.has(s.status))) return '会话还在运行，合并后保留 worktree'
  return null
}

/** The session conflicts are handed to: the active one if it is in the worktree, else its first agent session. */
export function agentSessionFor<T extends Pick<Session, 'id' | 'kind'>>(sessions: readonly T[], activeId: string | null): T | null {
  const agents = sessions.filter((s) => s.kind !== 'shell')
  return agents.find((s) => s.id === activeId) ?? agents[0] ?? null
}

const MAX_PROMPT_FILES = 10
/** Below Claude's paste-placeholder threshold (PRD §6.9), so the whole text stays readable in the input line. */
export const MAX_PROMPT_CHARS = 800

/**
 * One line put into the agent's input line (not sent; the user reads it and presses Enter): merge the base in,
 * resolve, commit, without an editor. Files are listed while the text stays within MAX_PROMPT_CHARS.
 */
export function conflictPrompt(check: Pick<MergePrecheck, 'base' | 'branch' | 'conflicts'>): string {
  const head = `把 ${check.branch} 合并到 ${check.base} 会冲突：`
  const tail = `请在当前 worktree 里运行 GIT_EDITOR=true git merge ${check.base}，解决这些冲突，确认构建和测试通过后提交合并结果，完成后告诉我。`
  const total = check.conflicts.length
  const files: string[] = []
  for (const conflict of check.conflicts.slice(0, MAX_PROMPT_FILES)) {
    const next = [...files, `${conflict.path}（${conflictReason(conflict)}）`]
    const more = next.length < total ? ` 等 ${total} 个文件` : ''
    if (files.length > 0 && head.length + next.join('、').length + more.length + 1 + tail.length > MAX_PROMPT_CHARS) break
    files.push(next[next.length - 1]!)
  }
  const more = files.length < total ? ` 等 ${total} 个文件` : ''
  return `${head}${files.join('、')}${more}。${tail}`
}

export function agentLabel(kind: AgentKind): string {
  return kind === 'codex' ? 'Codex' : 'Claude'
}

/**
 * What the worktree's agent ran this turn (PRD F4 · “这一轮跑过哪些检查”): one line, worst outcome first, with the
 * compact summary on the right. Information only: unlike `[scripts] test`, it never blocks 合并.
 */
export function turnChecksLine(view: TurnCheckView, kind: AgentKind): CheckLine {
  const { tone, text } = checksVerdict(view, agentLabel(kind))
  return { tone, text, ...(view.kinds.length > 0 ? { meta: checksText(view) } : {}) }
}

/** Lines after a merge: the commit, the push, the worktree removal. */
export function resultLines(
  result: Extract<MergeResult, { ok: true }>,
  base: string,
  removal: 'removed' | string | null
): CheckLine[] {
  const lines: CheckLine[] = [{ tone: 'ok', text: `已合并到 ${base}`, meta: result.commit.slice(0, 7) }]
  if (result.push === '') lines.push({ tone: 'ok', text: `已推送到 origin/${base}` })
  else if (result.push !== null) lines.push({ tone: 'warn', text: `推送失败：${result.push}` })
  if (removal === 'removed') lines.push({ tone: 'ok', text: '已删除 worktree，分支保留' })
  else if (removal) lines.push({ tone: 'warn', text: `没能删除 worktree：${removal}` })
  return lines
}

/** What a failed merge says (stale ones are checked again instead). */
export function failureText(result: Extract<MergeResult, { ok: false }>, check: MergePrecheck): string {
  const rebased = result.rebased ? `（${check.branch} 已经变基到最新的 ${check.base} 上）` : ''
  switch (result.reason) {
    case 'conflict':
      return `合并时遇到冲突，已恢复原样${result.message ? `：${result.message}` : ''}`
    case 'blocked':
      return result.blocker ? blockerText(result.blocker, check) : '不能合并'
    case 'stale':
      return '分支在检查之后又变了，请重新检查'
    case 'invalid':
      return '请求无效'
    case 'git':
      return `没能合并${rebased}：${result.message ?? 'git 出错'}`
  }
}
