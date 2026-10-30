import { describe, expect, it } from 'vitest'
import type { GitWorktreeInfo, GitWorktreeListing } from '@shared/git-worktrees'
import type { Session, Worktree } from '@shared/types'
import {
  branchesOf,
  buildRows,
  cleanupPlan,
  deleteBlocker,
  detailLines,
  portBlockLabel,
  formatDiff,
  formatSync,
  keptText,
  mergeListing,
  COLLAPSED,
  selectedRow,
  sessionLine,
  tildePath
} from './model'

function info(patch: Partial<GitWorktreeInfo> & { path: string }): GitWorktreeInfo {
  return {
    realPath: patch.path,
    head: 'aaaaaaaaaaaa',
    branch: null,
    isMain: false,
    locked: false,
    prunable: null,
    rebasing: null,
    unreachableCommits: 0,
    base: 'main',
    ahead: 0,
    behind: 0,
    merged: false,
    added: 0,
    removed: 0,
    dirtyFiles: [],
    dirtyCount: 0,
    detailed: true,
    ...patch
  }
}

function session(id: string, worktreeId: string, patch: Partial<Session> = {}): Session {
  return { id, worktreeId, kind: 'claude', title: id, status: 'idle', startedAt: 0, lastActivityAt: 0, ...patch }
}

const listing: GitWorktreeListing = {
  mainBranch: 'main',
  worktrees: [
    info({ path: '/private/repo', branch: 'main', isMain: true, base: null, ahead: null, behind: null }),
    info({ path: '/wt/feature', branch: 'jacob/feature', ahead: 2, behind: 1, added: 5, removed: 1, dirtyCount: 1, dirtyFiles: ['a.ts'] }),
    info({ path: '/wt/merged-busy', branch: 'jacob/merged-busy', merged: true, behind: 3 }),
    info({ path: '/wt/merged', branch: 'jacob/merged', merged: true, behind: 3 }),
    info({ path: '/wt/fresh', branch: 'jacob/fresh', ahead: 0, behind: 4 }),
    info({ path: '/wt/gone', branch: 'jacob/gone', prunable: 'gitdir file points to non-existent location', ahead: 1 })
  ],
  realPaths: { '/repo': '/private/repo' }
}

const worktrees: Worktree[] = [
  { id: 'w-main', projectId: 'p', branch: 'main', path: '/repo', isMain: true },
  { id: 'w-feature', projectId: 'p', branch: 'jacob/feature', path: '/wt/feature', isMain: false },
  { id: 'w-merged-busy', projectId: 'p', branch: 'jacob/merged-busy', path: '/wt/merged-busy', isMain: false }
]

const sessions: Session[] = [
  session('shell', 'w-main', { kind: 'shell', title: 'main', lastActivityAt: 5 }),
  session('idle', 'w-feature', { title: '空闲的', lastActivityAt: 9 }),
  session('waiting', 'w-feature', { title: 'Cookie 会话迁移', status: 'needs_you', lastActivityAt: 1 }),
  session('done', 'w-merged-busy', { title: '已合并的', status: 'done_unread', kind: 'codex' })
]

describe('buildRows', () => {
  const groups = buildRows(listing, worktrees, sessions)

  it('keeps the main checkout and every worktree with a session in the working list, merged or not', () => {
    expect(groups.working.map((r) => r.name)).toEqual(['main', 'jacob/feature', 'jacob/merged-busy'])
    const main = groups.working[0]!
    expect(main.sessions.map((s) => s.id)).toEqual(['shell'])
    expect(main.openPath).toBe('/repo')
    expect(main.sessionLine).toBe('主目录 · main · 终端')
    expect(main.sync).toBe('—')
    expect(groups.working[2]!.sessionLine).toBe('已合并的 · Codex · 待审阅 · 已合并到 main')
  })

  it('shows the most urgent session first, on the glyph and the session line', () => {
    const feature = groups.working[1]!
    expect(feature.status).toBe('needs_you')
    expect(feature.sessions.map((s) => s.id)).toEqual(['waiting', 'idle'])
    expect(feature.sessionLine).toBe('Cookie 会话迁移 · Claude · 等你确认 · 另有 1 个会话')
    expect(feature.diff).toBe('+5 −1')
    expect(feature.sync).toBe('↑2 ↓1')
  })

  it('puts session-less merged or missing worktrees in 可清理, other session-less ones in 没有会话', () => {
    expect(groups.cleanable.map((r) => r.name)).toEqual(['jacob/merged', 'jacob/gone'])
    expect(groups.cleanable[0]!.sessionLine).toBe('无会话 · 已合并到 main')
    expect(groups.idle.map((r) => r.name)).toEqual(['jacob/fresh'])
    expect(groups.idle[0]!.sessionLine).toBe('无会话 · 无新提交')
    expect(groups.idle[0]!.status).toBeNull()
  })

  it('never offers the main checkout for cleanup, even without sessions', () => {
    expect(buildRows(listing, [], []).working.map((r) => r.name)).toEqual(['main'])
  })

  it('names a detached worktree by its short commit, a rebasing one by its branch', () => {
    const odd = buildRows({ ...listing, worktrees: [info({ path: '/a', head: '0123456789ab' }), info({ path: '/b', rebasing: 'jacob/x' })] }, [], [])
    expect(odd.idle.map((r) => r.name)).toEqual(['0123456', 'jacob/x'])
  })
})

describe('branchesOf', () => {
  it('names each record git lists by its branch, matching by resolved path, and skips records git does not list', () => {
    const records: Worktree[] = [
      { id: 'w-main', projectId: 'p', branch: '', path: '/repo', isMain: true },
      { id: 'w-feature', projectId: 'p', branch: 'old', path: '/wt/feature', isMain: false },
      { id: 'w-elsewhere', projectId: 'p', branch: 'x', path: '/wt/elsewhere', isMain: false }
    ]
    expect(branchesOf(listing, records)).toEqual(new Map([['w-main', 'main'], ['w-feature', 'jacob/feature']]))
  })

  it('names a checkout by the branch it is rebasing, and leaves a detached one out (no short commit as a branch)', () => {
    const detached: GitWorktreeListing = {
      mainBranch: 'main',
      worktrees: [info({ path: '/a', head: 'abcdef123456' }), info({ path: '/b', rebasing: 'jacob/fix' })],
      realPaths: {}
    }
    const records: Worktree[] = [
      { id: 'a', projectId: 'p', branch: '', path: '/a', isMain: true },
      { id: 'b', projectId: 'p', branch: '', path: '/b', isMain: false }
    ]
    expect(branchesOf(detached, records)).toEqual(new Map([['b', 'jacob/fix']]))
  })
})

describe('deleteBlocker', () => {
  const base = { info: info({ path: '/wt/x', branch: 'x' }), sessions: [] as Session[] }
  const blocker = (patch: Partial<GitWorktreeInfo>) => deleteBlocker({ ...base, info: info({ path: '/x', branch: 'x', ...patch }) })

  it('allows a clean worktree with no live session', () => {
    expect(deleteBlocker(base)).toBeNull()
    expect(deleteBlocker({ ...base, sessions: [session('s', 'w', { status: 'done_unread' })] })).toBeNull()
  })

  it('refuses the main checkout, a live session, uncommitted changes, a lock and a rebase', () => {
    expect(blocker({ isMain: true })).toBe('主目录不能删除')
    expect(deleteBlocker({ ...base, sessions: [session('s', 'w', { status: 'running' })] })).toMatch(/正在运行/)
    expect(deleteBlocker({ ...base, sessions: [session('s', 'w', { status: 'needs_you' })] })).toMatch(/等你处理/)
    expect(blocker({ dirtyCount: 2 })).toBe('有 2 个未提交的改动，先提交或丢弃')
    expect(blocker({ locked: true })).toMatch(/锁定/)
    expect(blocker({ branch: null, rebasing: 'x' })).toMatch(/变基/)
  })

  it('treats whatever git could not check as a reason, never as clean', () => {
    expect(blocker({ dirtyCount: null })).toBe('无法确认有没有未提交的改动')
    expect(blocker({ detailed: false })).toMatch(/还没读完/)
    expect(blocker({ branch: null, unreachableCommits: null })).toMatch(/无法确认它的提交/)
  })

  it('refuses a detached worktree with commits no branch has', () => {
    expect(blocker({ branch: null, unreachableCommits: 2 })).toBe('有 2 个提交不在任何分支上，先给它建一个分支')
    expect(blocker({ branch: null, unreachableCommits: 0 })).toBeNull()
  })
})

describe('cleanupPlan', () => {
  it('removes the safe ones and lists why the others stay', () => {
    const groups = buildRows(
      { ...listing, worktrees: [...listing.worktrees, info({ path: '/wt/dirty', branch: 'dirty', merged: true, dirtyCount: 1 })] },
      worktrees,
      sessions
    )
    const plan = cleanupPlan(groups.cleanable)
    expect(plan.remove.map((r) => r.name)).toEqual(['jacob/merged', 'jacob/gone'])
    expect(plan.skip.map((s) => [s.row.name, s.reason])).toEqual([['dirty', '有 1 个未提交的改动，先提交或丢弃']])
  })

  it('never touches a row with a session, even an idle one', () => {
    const [row] = buildRows(listing, worktrees, sessions).working.filter((r) => r.name === 'jacob/merged-busy')
    const plan = cleanupPlan([row!])
    expect(plan.remove).toEqual([])
    expect(plan.skip[0]!.reason).toBe('有会话')
  })
})

describe('mergeListing', () => {
  it('keeps the previous details of worktrees a partial listing skipped, while their HEAD is the same', () => {
    const skipped = info({ path: '/wt/merged', branch: 'jacob/merged', detailed: false, merged: false, dirtyCount: null })
    const moved = info({ path: '/wt/fresh', branch: 'jacob/fresh', head: 'bbbb', detailed: false, dirtyCount: null })
    const merged = mergeListing(listing, { ...listing, worktrees: [listing.worktrees[0]!, skipped, moved] })
    expect(merged.worktrees[1]).toMatchObject({ merged: true, dirtyCount: 0, detailed: true })
    expect(merged.worktrees[2]).toMatchObject({ detailed: false, dirtyCount: null })
  })
})

describe('formatting', () => {
  it('shows uncommitted stats only when something is uncommitted, ? when unknown', () => {
    expect(formatDiff({ added: 0, removed: 0, dirtyCount: 0 })).toBe('')
    expect(formatDiff({ added: 0, removed: 0, dirtyCount: 1 })).toBe('+0 −0')
    expect(formatDiff({ added: 42, removed: 18, dirtyCount: 3 })).toBe('+42 −18')
    expect(formatDiff({ added: 0, removed: 0, dirtyCount: null })).toBe('?')
  })

  it('shows ahead / behind, or a dash without a base', () => {
    expect(formatSync({ ahead: 3, behind: 0 })).toBe('↑3 ↓0')
    expect(formatSync({ ahead: null, behind: null })).toBe('—')
  })

  it('abbreviates the home folder', () => {
    expect(tildePath('/Users/me/.tr/worktrees/a', '/Users/me')).toBe('~/.tr/worktrees/a')
    expect(tildePath('/Users/me', '/Users/me/')).toBe('~')
    expect(tildePath('/Users/meow/a', '/Users/me')).toBe('/Users/meow/a')
  })

  it('session line: 无会话, the merge, or 无新提交', () => {
    expect(sessionLine([], { isMain: false, merged: true, base: 'main', ahead: 0 })).toBe('无会话 · 已合并到 main')
    expect(sessionLine([], { isMain: false, merged: false, base: 'main', ahead: 0 })).toBe('无会话 · 无新提交')
    expect(
      sessionLine([session('s', 'w', { status: 'running', kind: 'codex', title: '结算页性能优化' })], { isMain: false, merged: false, base: 'main', ahead: 3 })
    ).toBe('结算页性能优化 · Codex')
  })

  it('says what deleting keeps', () => {
    expect(keptText({ branch: 'jacob/x' })).toBe('分支 jacob/x 保留')
    expect(keptText({ branch: null })).toBe('它的提交都已在其他分支上')
  })

  it('details: branch, base with ahead / behind, the first uncommitted files', () => {
    const lines = detailLines(info({ path: '/x', branch: 'jacob/x', ahead: 2, behind: 0, dirtyCount: 5, dirtyFiles: ['a', 'b', 'c', 'd', 'e'] }))
    expect(lines).toEqual([
      { label: '分支', value: 'jacob/x' },
      { label: '基线', value: 'main · 领先 2，落后 0' },
      { label: '未提交', value: 'a, b, c 等 5 个' }
    ])
    expect(detailLines(info({ path: '/x', branch: 'jacob/x', ahead: 2, behind: 0, dirtyCount: 0, dirtyFiles: [] }), 41010)).toContainEqual({
      label: '端口段',
      value: portBlockLabel(41010),
      mono: true
    })
    expect(portBlockLabel(41010)).toBe('41010\u201341019')
    expect(detailLines(info({ path: '/x', head: 'abcdef123', base: null, ahead: null, behind: null, dirtyCount: null, unreachableCommits: 1 }))).toEqual([
      { label: '分支', value: '分离的 HEAD · abcdef1 · 1 个提交不在分支上' },
      { label: '基线', value: '—' },
      { label: '未提交', value: '无法读取' }
    ])
  })
})

describe('selectedRow', () => {
  const { working } = buildRows(listing, worktrees, sessions)

  it("keeps the user's pick, else follows the active session's worktree", () => {
    expect(selectedRow(working, '/wt/feature', 'w-main')?.name).toBe('jacob/feature')
    expect(selectedRow(working, '/gone', 'w-main')?.name).toBe('main')
    expect(selectedRow(working, null, null)).toBeNull()
  })

  it('shows nothing expanded once the user collapsed the row', () => {
    expect(selectedRow(working, COLLAPSED, 'w-main')).toBeNull()
  })
})
