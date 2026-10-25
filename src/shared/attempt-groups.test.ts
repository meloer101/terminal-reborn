import { describe, expect, it } from 'vitest'
import {
  addAgentRow,
  attemptBrief,
  attemptCountProblem,
  attemptKinds,
  attemptReportText,
  defaultRows,
  diffSummary,
  diffSummaryText,
  groupShown,
  markMerged,
  memberBranches,
  memberLabels,
  memberTitle,
  planAttempts,
  promptPreview,
  promptsTask,
  pruneAttemptGroups,
  remainingMembers,
  reportDue,
  sanitizeAttemptGroups,
  settledKey,
  sourceLabel,
  stepRow,
  type AttemptGroup,
  type AttemptPlanInput,
  type MemberState
} from './attempt-groups'
import { looksLikeReport } from './dispatch'
import type { NewSessionBranch } from './new-session'

const branch = (name: string): NewSessionBranch => ({ name, remote: false, worktreePath: null, inMainCheckout: false })

const input = (patch: Partial<AttemptPlanInput> = {}): AttemptPlanInput => ({
  root: '/repo',
  base: 'jacob/session-cookie',
  stem: 'jacob/session-cookie',
  rows: [
    { kind: 'claude', count: 2 },
    { kind: 'gemini', count: 1 }
  ],
  prompt: '把登录页改成两步',
  prepare: true,
  branches: [branch('main'), branch('jacob/session-cookie')],
  worktreesDir: '/home/.tr/worktrees/repo',
  takenFolders: [],
  ...patch
})

const group = (patch: Partial<AttemptGroup> = {}): AttemptGroup => ({
  id: 'g1',
  prompt: 'p',
  base: 'main',
  createdAt: 1,
  members: ['s1', 's2', 's3'],
  ...patch
})

describe('份数', () => {
  it('lists the agents row by row', () => {
    expect(attemptKinds([{ kind: 'claude', count: 2 }, { kind: 'codex', count: 1 }])).toEqual(['claude', 'claude', 'codex'])
    expect(attemptKinds([{ kind: 'claude', count: 0 }, { kind: 'qwen', count: 2 }])).toEqual(['qwen', 'qwen'])
  })

  it('needs two to four in all', () => {
    expect(attemptCountProblem([{ kind: 'claude', count: 1 }])).toBe('too-few')
    expect(attemptCountProblem([{ kind: 'claude', count: 1 }, { kind: 'pi', count: 1 }])).toBeNull()
    expect(attemptCountProblem([{ kind: 'claude', count: 3 }, { kind: 'codex', count: 2 }])).toBe('too-many')
  })

  it('steps never past four in all, and drops a row stepped down to zero', () => {
    const rows = [{ kind: 'claude' as const, count: 1 }, { kind: 'codex' as const, count: 2 }]
    expect(stepRow(rows, 'claude', -1)).toEqual([{ kind: 'codex', count: 2 }])
    expect(stepRow([{ kind: 'claude', count: 3 }, { kind: 'codex', count: 1 }], 'codex', 1)).toEqual([{ kind: 'claude', count: 3 }, { kind: 'codex', count: 1 }])
    expect(stepRow(rows, 'codex', -1)).toEqual([{ kind: 'claude', count: 1 }, { kind: 'codex', count: 1 }])
  })

  it('adds an agent as a new row, or one more part of a listed one, up to four', () => {
    expect(addAgentRow([{ kind: 'claude', count: 1 }], 'opencode')).toEqual([{ kind: 'claude', count: 1 }, { kind: 'opencode', count: 1 }])
    expect(addAgentRow([{ kind: 'claude', count: 1 }], 'claude')).toEqual([{ kind: 'claude', count: 2 }])
    expect(addAgentRow([{ kind: 'claude', count: 4 }], 'codex')).toEqual([{ kind: 'claude', count: 4 }])
  })

  it('starts with the session’s agent and the next installed ones, one part each', () => {
    expect(defaultRows('codex', ['claude', 'codex', 'opencode', 'gemini'])).toEqual([
      { kind: 'codex', count: 1 },
      { kind: 'claude', count: 1 },
      { kind: 'opencode', count: 1 }
    ])
    expect(defaultRows('claude', ['claude'])).toEqual([{ kind: 'claude', count: 2 }])
    expect(defaultRows('grok', ['claude', 'codex'])).toEqual([{ kind: 'claude', count: 1 }, { kind: 'codex', count: 1 }])
  })

  it('numbers an agent only when it repeats', () => {
    expect(memberLabels(['claude', 'claude', 'gemini'])).toEqual(['Claude Code 1', 'Claude Code 2', 'Gemini CLI'])
    expect(memberTitle('Cookie 会话迁移', 'Codex')).toBe('Cookie 会话迁移 · Codex')
  })
})

describe('planAttempts', () => {
  it('makes one worktree per member off the session’s branch, numbered from 2, each with its own folder', () => {
    const plan = planAttempts(input())
    expect(plan.problem).toBeNull()
    expect(plan.members?.map((m) => [m.kind, m.label, m.request.branch, m.request.folder, m.request.base, m.path])).toEqual([
      ['claude', 'Claude Code 1', 'jacob/session-cookie-2', 'session-cookie-2', 'jacob/session-cookie', '/home/.tr/worktrees/repo/session-cookie-2'],
      ['claude', 'Claude Code 2', 'jacob/session-cookie-3', 'session-cookie-3', 'jacob/session-cookie', '/home/.tr/worktrees/repo/session-cookie-3'],
      ['gemini', 'Gemini CLI', 'jacob/session-cookie-4', 'session-cookie-4', 'jacob/session-cookie', '/home/.tr/worktrees/repo/session-cookie-4']
    ])
    expect(plan.members?.every((m) => m.request.root === '/repo' && m.request.prepare)).toBe(true)
  })

  it('steps around branches and folders already taken', () => {
    expect(memberBranches('x', 2, new Set(['x-2', 'x-4']))).toEqual(['x-3', 'x-5'])
    const plan = planAttempts(input({ takenFolders: ['session-cookie-2'] }))
    expect(plan.members?.map((m) => m.request.folder)).toEqual(['session-cookie-2-2', 'session-cookie-3', 'session-cookie-4'])
  })

  it('refuses a count out of range, a bad stem and an empty or long task', () => {
    expect(planAttempts(input({ rows: [{ kind: 'claude', count: 1 }] })).problem).toBe('too-few')
    expect(planAttempts(input({ stem: 'bad name' })).problem).toBe('invalid')
    expect(planAttempts(input({ prompt: '  \n ' })).problem).toBe('prompt-empty')
    expect(planAttempts(input({ prompt: 'x'.repeat(20_001) })).problem).toBe('prompt-too-long')
  })

  it('briefs each member with where it came from and works', () => {
    const brief = attemptBrief({ task: '改登录', parentTitle: 'Cookie', count: 3, branch: 'b-2', base: 'b' })
    expect(brief).toContain('会话「Cookie」把同一个任务交给了 3 份')
    expect(brief).toContain('分支 b-2，基于 b')
    expect(brief.split('\n\n')[1]).toBe('改登录')
  })

  it('previews the first non-empty line', () => {
    expect(promptPreview('\n  修好   登录 \n第二行')).toBe('修好 登录')
    expect(promptPreview('一'.repeat(70), 60)).toBe(`${'一'.repeat(60)}…`)
  })

  it('names where the task came from', () => {
    expect(promptsTask([' 改登录 ', '', '别重试'])).toBe('改登录\n别重试')
    expect(sourceLabel('prompts', '改登录\n别重试', 'Claude Code')).toBe('你在这个会话里说过的 2 句话')
    expect(sourceLabel('selection', 'a\nb\nc', 'Claude Code')).toBe('终端里选中的 3 行')
    expect(sourceLabel('plan', '1. x', 'Claude Code')).toBe('Claude Code 写好的计划')
  })
})

describe('the report', () => {
  const m = (id: string, patch: Partial<MemberState> = {}): MemberState => ({ id, status: 'done_unread', exited: false, finishedAt: 10, launchFailed: false, ...patch })
  const g = group({ createdAt: 5, reportTo: 's0' })

  it('settles once every member stopped after its task ran', () => {
    expect(settledKey(g, [m('s1'), m('s2', { status: 'error' }), m('s3', { exited: true })])).toBe('s1:10:done|s2:10:error|s3:10:exited')
    expect(settledKey(g, [m('s1'), m('s2', { status: 'running' })])).toBeNull()
    expect(settledKey(g, [m('s1'), m('s2', { status: 'needs_you' })])).toBeNull()
    // Idle before its first turn: the task has not run yet.
    expect(settledKey(g, [m('s1'), m('s2', { status: 'idle', finishedAt: undefined })])).toBeNull()
    expect(settledKey(g, [m('s1'), m('s2', { status: 'idle', finishedAt: undefined, launchFailed: true })])).toBe('s1:10:done|s2:0:failed')
    expect(settledKey(g, [])).toBeNull()
  })

  it('is due for a new settle of a group that reports, until one was merged', () => {
    expect(reportDue(g, 'k')).toBe(true)
    expect(reportDue({ ...g, reported: 'k' }, 'k')).toBe(false)
    expect(reportDue(group(), 'k')).toBe(false)
    expect(reportDue(markMerged(g, 's1', 'b', 1), 'k')).toBe(false)
    expect(reportDue(g, null)).toBe(false)
  })

  it('lists each member’s facts and result, then asks for a comparison and leaves merging to the user', () => {
    const text = attemptReportText({
      base: 'jacob/x',
      members: [
        { label: 'Claude Code', branch: 'jacob/x-2', event: 'done', changes: '+38 −12 · 3 个文件', checks: '测试 ✓', message: '改好了'.repeat(80) },
        { label: 'Gemini CLI', branch: 'jacob/x-3', event: 'failed', failure: '没能创建 worktree' }
      ]
    })
    expect(looksLikeReport(text)).toBe(true)
    expect(text).toContain('交给了 2 份各做一遍')
    expect(text).toContain('— Claude Code · 做完了 · 分支 jacob/x-2 · +38 −12 · 3 个文件 · 测试 ✓')
    expect(text).toContain('— Gemini CLI · 任务没发出去 · 分支 jacob/x-3\n  没能创建 worktree')
    expect(text).toContain('git diff jacob/x...<分支>')
    expect(attemptReportText({ base: 'b', members: [{ label: 'Codex', branch: 'b-2', event: 'done', message: '改好了。' }] })).toContain('\n  改好了。\n')
    // Past the shared budget, a long result points to the member's terminal instead.
    const long = attemptReportText({ base: 'b', members: [1, 2, 3, 4].map((n) => ({ label: `A${n}`, branch: `b-${n}`, event: 'done' as const, message: 'x'.repeat(5_000) })) })
    expect(long).toContain('— A4 · 做完了 · 分支 b-4\n  （回复较长，看它的终端）')
    expect(text.endsWith('你接着做下一步。')).toBe(true)
  })
})

describe('groups over time', () => {
  it('prunes closed members and drops empty groups, keeping identity when nothing changed', () => {
    const groups = [group(), group({ id: 'g2', members: ['s9'] })]
    expect(pruneAttemptGroups(groups, new Set(['s1', 's2', 's3', 's9']))).toBe(groups)
    expect(pruneAttemptGroups(groups, new Set(['s1', 's3']))).toEqual([group({ members: ['s1', 's3'] })])
  })

  it('is shown with two members to compare, or once merged while others are left', () => {
    const all = () => true
    expect(groupShown(group(), all)).toBe(true)
    expect(groupShown(group(), (id) => id === 's1')).toBe(false)
    const merged = markMerged(group(), 's2', 'jacob/x-2', 5)
    expect(remainingMembers(merged, all)).toEqual(['s1', 's3'])
    expect(groupShown(merged, (id) => id === 's2' || id === 's3')).toBe(true)
    expect(groupShown(merged, (id) => id === 's2')).toBe(false)
  })
})

describe('diff summary', () => {
  it('counts each file once and sums committed and uncommitted lines', () => {
    const summary = diffSummary({
      committed: [
        { path: 'a.ts', status: 'M', added: 10, removed: 2 },
        { path: 'logo.png', status: 'A', added: null, removed: null }
      ],
      uncommitted: [{ path: 'a.ts', status: 'M', added: 2, removed: 1 }]
    })
    expect(summary).toEqual({ added: 12, removed: 3, files: 2 })
    expect(diffSummaryText(summary)).toBe('+12 −3 · 2 个文件')
    expect(diffSummaryText({ added: 0, removed: 0, files: 0 })).toBe('还没有改动')
  })
})

describe('sanitizeAttemptGroups', () => {
  const sessions = new Set(['s1', 's2', 's3'])

  it('keeps the session it reports to when it is one of the file’s and not a member', () => {
    expect(sanitizeAttemptGroups([{ id: 'g1', prompt: 'p', base: 'b', createdAt: 1, members: ['s1', 's2'], reportTo: 's3', reported: 'k' }], sessions)).toEqual([
      { id: 'g1', prompt: 'p', base: 'b', createdAt: 1, members: ['s1', 's2'], reportTo: 's3', reported: 'k' }
    ])
    expect(sanitizeAttemptGroups([{ id: 'g1', prompt: 'p', base: 'b', createdAt: 1, members: ['s1', 's2'], reportTo: 's1' }], sessions)[0]?.reportTo).toBeUndefined()
    expect(sanitizeAttemptGroups([{ id: 'g1', prompt: 'p', base: 'b', createdAt: 1, members: ['s1'], reportTo: 'gone' }], sessions)[0]?.reportTo).toBeUndefined()
  })

  it('keeps valid groups and members that exist, each session in one group only', () => {
    expect(
      sanitizeAttemptGroups(
        [
          { id: 'g1', prompt: 'p', base: 'main', createdAt: 3, members: ['s1', 's2', 'gone'], merged: { sessionId: 's2', branch: 'b', at: 4 } },
          { id: 'g2', prompt: 'q', base: 'main', createdAt: 5, members: ['s2', 's3'] }
        ],
        sessions
      )
    ).toEqual([
      { id: 'g1', prompt: 'p', base: 'main', createdAt: 3, members: ['s1', 's2'], merged: { sessionId: 's2', branch: 'b', at: 4 } },
      { id: 'g2', prompt: 'q', base: 'main', createdAt: 5, members: ['s3'] }
    ])
  })

  it('drops malformed entries and files written before groups existed', () => {
    expect(sanitizeAttemptGroups(undefined, sessions)).toEqual([])
    expect(
      sanitizeAttemptGroups(
        [null, { id: 'g1', prompt: '', base: 'main', members: ['s1'] }, { id: 'g2', prompt: 'p', base: 'main', members: ['nope'] }, { id: 'g3', prompt: 'p', base: 'main', members: ['s1'], merged: 'x' }],
        sessions
      )
    ).toEqual([{ id: 'g3', prompt: 'p', base: 'main', createdAt: 0, members: ['s1'] }])
  })
})
