import { describe, expect, it } from 'vitest'
import type { GitWorktreeInfo, GitWorktreeListing } from '@shared/git-worktrees'
import type { Session, Worktree } from '@shared/types'
import { buildRows, cleanupPlan, deleteBlocker, detailLines, formatDiff, formatSync, selectedRow, sessionLine, tildePath } from './model'

function info(patch: Partial<GitWorktreeInfo> & { path: string }): GitWorktreeInfo {
  return {
    realPath: patch.path,
    head: 'aaaaaaaaaaaa',
    branch: null,
    isMain: false,
    locked: false,
    prunable: false,
    base: 'main',
    ahead: 0,
    behind: 0,
    merged: false,
    added: 0,
    removed: 0,
    dirtyFiles: [],
    dirtyCount: 0,
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
    info({ path: '/wt/merged', branch: 'jacob/merged', merged: true, behind: 3 }),
    info({ path: '/wt/orphan', branch: 'jacob/orphan', ahead: 1 })
  ],
  realPaths: { '/repo': '/private/repo' }
}

const worktrees: Worktree[] = [
  { id: 'w-main', projectId: 'p', branch: 'main', path: '/repo', isMain: true },
  { id: 'w-feature', projectId: 'p', branch: 'jacob/feature', path: '/wt/feature', isMain: false },
  { id: 'w-merged', projectId: 'p', branch: 'jacob/merged', path: '/wt/merged', isMain: false }
]

const sessions: Session[] = [
  session('shell', 'w-main', { kind: 'shell', title: 'main', lastActivityAt: 5 }),
  session('idle', 'w-feature', { title: '空闲的', lastActivityAt: 9 }),
  session('waiting', 'w-feature', { title: 'Cookie 会话迁移', status: 'needs_you', lastActivityAt: 1 }),
  session('done', 'w-merged', { title: '已合并的', status: 'done_unread', kind: 'codex' })
]

describe('buildRows', () => {
  const groups = buildRows(listing, worktrees, sessions)

  it('matches sessions by resolved path and keeps the main checkout working', () => {
    expect(groups.working.map((r) => r.name)).toEqual(['main', 'jacob/feature'])
    const main = groups.working[0]!
    expect(main.sessions.map((s) => s.id)).toEqual(['shell'])
    expect(main.openPath).toBe('/repo')
    expect(main.sessionLine).toBe('主目录 · main · 终端')
    expect(main.sync).toBe('—')
  })

  it('shows the most urgent session first, on the glyph and the session line', () => {
    const feature = groups.working[1]!
    expect(feature.status).toBe('needs_you')
    expect(feature.sessions.map((s) => s.id)).toEqual(['waiting', 'idle'])
    expect(feature.sessionLine).toBe('Cookie 会话迁移 · Claude · 等你确认 · 另有 1 个会话')
    expect(feature.diff).toBe('+5 −1')
    expect(feature.sync).toBe('↑2 ↓1')
  })

  it('puts merged worktrees and worktrees without a session in 可清理', () => {
    expect(groups.cleanable.map((r) => r.name)).toEqual(['jacob/merged', 'jacob/orphan'])
    expect(groups.cleanable[0]!.sessionLine).toBe('已合并的 · Codex · 待审阅 · 已合并到 main')
    expect(groups.cleanable[1]!.sessionLine).toBe('无会话')
    expect(groups.cleanable[1]!.status).toBeNull()
    expect(groups.cleanable[1]!.openPath).toBe('/wt/orphan')
  })

  it('never offers the main checkout for cleanup, even without sessions', () => {
    const lonely = buildRows(listing, [], [])
    expect(lonely.working.map((r) => r.name)).toEqual(['main'])
  })

  it('names a detached worktree by its short commit', () => {
    const detached = buildRows({ ...listing, worktrees: [info({ path: '/wt/x', head: '0123456789ab' })] }, [], [])
    expect(detached.cleanable[0]!.name).toBe('0123456')
  })
})

describe('deleteBlocker', () => {
  const base = { info: info({ path: '/wt/x' }), sessions: [] as Session[] }

  it('allows a clean worktree with no live session', () => {
    expect(deleteBlocker(base)).toBeNull()
    expect(deleteBlocker({ ...base, sessions: [session('s', 'w', { status: 'done_unread' })] })).toBeNull()
  })

  it('refuses the main checkout, a live session, uncommitted changes and a lock', () => {
    expect(deleteBlocker({ ...base, info: info({ path: '/r', isMain: true }) })).toBe('主目录不能删除')
    expect(deleteBlocker({ ...base, sessions: [session('s', 'w', { status: 'running' })] })).toMatch(/正在运行/)
    expect(deleteBlocker({ ...base, sessions: [session('s', 'w', { status: 'needs_you' })] })).toMatch(/等你处理/)
    expect(deleteBlocker({ ...base, info: info({ path: '/x', dirtyCount: 2 }) })).toBe('有 2 个未提交的改动，先提交或丢弃')
    expect(deleteBlocker({ ...base, info: info({ path: '/x', locked: true }) })).toMatch(/锁定/)
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
    expect(plan.remove.map((r) => r.name)).toEqual(['jacob/merged', 'jacob/orphan'])
    expect(plan.skip.map((s) => [s.row.name, s.reason])).toEqual([['dirty', '有 1 个未提交的改动，先提交或丢弃']])
  })
})

describe('formatting', () => {
  it('shows uncommitted stats only when something is uncommitted', () => {
    expect(formatDiff({ added: 0, removed: 0, dirtyCount: 0 })).toBe('')
    expect(formatDiff({ added: 0, removed: 0, dirtyCount: 1 })).toBe('+0 −0')
    expect(formatDiff({ added: 42, removed: 18, dirtyCount: 3 })).toBe('+42 −18')
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

  it('says 无会话 and the merge for an abandoned worktree', () => {
    expect(sessionLine([], { merged: true, base: 'main' })).toBe('无会话 · 已合并到 main')
    expect(sessionLine([session('s', 'w', { status: 'running', kind: 'codex', title: '结算页性能优化' })], { merged: false, base: 'main' })).toBe(
      '结算页性能优化 · Codex'
    )
  })

  it('details: branch, base with ahead / behind, the first uncommitted files', () => {
    const lines = detailLines(info({ path: '/x', branch: 'jacob/x', ahead: 2, behind: 0, dirtyCount: 5, dirtyFiles: ['a', 'b', 'c', 'd', 'e'] }))
    expect(lines).toEqual([
      { label: '分支', value: 'jacob/x' },
      { label: '基线', value: 'main · 领先 2，落后 0' },
      { label: '未提交', value: 'a, b, c 等 5 个' }
    ])
    expect(detailLines(info({ path: '/x', head: 'abcdef123', base: null, ahead: null, behind: null }))).toEqual([
      { label: '分支', value: '分离的 HEAD · abcdef1' },
      { label: '基线', value: '—' },
      { label: '未提交', value: '无' }
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
})
