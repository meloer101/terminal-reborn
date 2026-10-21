import { describe, expect, it } from 'vitest'
import {
  attemptBranchesText,
  attemptCountProblem,
  attemptKinds,
  attemptSendNote,
  diffSummary,
  diffSummaryText,
  groupShown,
  markMerged,
  memberLabels,
  planAttempts,
  promptPreview,
  pruneAttemptGroups,
  recipientsText,
  remainingMembers,
  sanitizeAttemptGroups,
  stepCount,
  type AttemptGroup,
  type AttemptPlanInput
} from './attempt-groups'
import type { NewSessionBranch } from './new-session'

const branch = (name: string): NewSessionBranch => ({ name, remote: false, worktreePath: null, inMainCheckout: false })

const input = (patch: Partial<AttemptPlanInput> = {}): AttemptPlanInput => ({
  root: '/repo',
  base: 'main',
  stem: 'jacob/swift-otter',
  counts: { claude: 2, codex: 1 },
  prompt: '把登录页改成两步',
  prepare: true,
  branches: [branch('main')],
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

describe('counts', () => {
  it('lists Claude first, then Codex', () => {
    expect(attemptKinds({ claude: 2, codex: 1 })).toEqual(['claude', 'claude', 'codex'])
    expect(attemptKinds({ claude: 0, codex: 2 })).toEqual(['codex', 'codex'])
  })

  it('needs two to four in all', () => {
    expect(attemptCountProblem({ claude: 1, codex: 0 })).toBe('too-few')
    expect(attemptCountProblem({ claude: 1, codex: 1 })).toBeNull()
    expect(attemptCountProblem({ claude: 3, codex: 2 })).toBe('too-many')
  })

  it('steps never below zero nor past four in all', () => {
    expect(stepCount({ claude: 0, codex: 2 }, 'claude', -1)).toEqual({ claude: 0, codex: 2 })
    expect(stepCount({ claude: 3, codex: 1 }, 'codex', 1)).toEqual({ claude: 3, codex: 1 })
    expect(stepCount({ claude: 2, codex: 1 }, 'codex', 1)).toEqual({ claude: 2, codex: 2 })
  })

  it('numbers an agent only when it repeats', () => {
    expect(memberLabels(['claude', 'claude', 'codex'])).toEqual(['Claude Code 1', 'Claude Code 2', 'Codex'])
    expect(recipientsText(['claude', 'claude', 'codex'])).toBe('Claude Code ×2 · Codex ×1')
  })
})

describe('planAttempts', () => {
  it('makes one worktree per member off the same base, with numbered branches and their own folders', () => {
    const plan = planAttempts(input())
    expect(plan.problem).toBeNull()
    expect(plan.members?.map((m) => [m.kind, m.label, m.request.branch, m.request.folder, m.request.base, m.path])).toEqual([
      ['claude', 'Claude Code 1', 'jacob/swift-otter-1', 'swift-otter-1', 'main', '/home/.tr/worktrees/repo/swift-otter-1'],
      ['claude', 'Claude Code 2', 'jacob/swift-otter-2', 'swift-otter-2', 'main', '/home/.tr/worktrees/repo/swift-otter-2'],
      ['codex', 'Codex', 'jacob/swift-otter-3', 'swift-otter-3', 'main', '/home/.tr/worktrees/repo/swift-otter-3']
    ])
    expect(plan.members?.every((m) => m.request.root === '/repo' && m.request.prepare)).toBe(true)
  })

  it('steps around folders already taken', () => {
    const plan = planAttempts(input({ takenFolders: ['swift-otter-1'] }))
    expect(plan.members?.map((m) => m.request.folder)).toEqual(['swift-otter-1-2', 'swift-otter-2', 'swift-otter-3'])
  })

  it('refuses a count out of range, a bad stem, an existing member branch and an empty prompt', () => {
    expect(planAttempts(input({ counts: { claude: 1, codex: 0 } })).problem).toBe('too-few')
    expect(planAttempts(input({ stem: 'bad name' })).problem).toBe('invalid')
    expect(planAttempts(input({ stem: '' })).problem).toBe('empty')
    expect(planAttempts(input({ branches: [branch('main'), branch('jacob/swift-otter-2')] })).problem).toBe('exists')
    expect(planAttempts(input({ prompt: '  \n ' })).problem).toBe('prompt-empty')
    expect(planAttempts(input({ prompt: 'x'.repeat(20_001) })).problem).toBe('prompt-too-long')
  })

  it('says what will be sent to whom', () => {
    expect(attemptSendNote(['claude', 'claude', 'codex'], 'main')).toBe(
      '新建 3 个 worktree（基于 main），各启动一个 agent，把这段话发给每一个并按回车：Claude Code ×2 · Codex ×1。每份各用一次你自己的额度。'
    )
    expect(attemptBranchesText('jacob/swift-otter', 3)).toBe('jacob/swift-otter-1 … -3')
  })

  it('previews the first non-empty line', () => {
    expect(promptPreview('\n  修好   登录 \n第二行')).toBe('修好 登录')
    expect(promptPreview('一'.repeat(70), 60)).toBe(`${'一'.repeat(60)}…`)
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
