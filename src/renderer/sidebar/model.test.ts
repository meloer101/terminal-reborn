import { describe, expect, it } from 'vitest'
import type { Project, Session, SessionStatus, Worktree } from '@shared/types'
import {
  adjacentSessionId,
  buildSidebarGroups,
  nextAttentionSessionId,
  sessionForShortcut,
  visibleSessionIds
} from './model'

const projects: Project[] = [
  { id: 'pa', name: 'alpha', rootPath: '/a' },
  { id: 'pb', name: 'beta', rootPath: '/b' },
  { id: 'pc', name: 'empty', rootPath: '/c' }
]
const worktrees: Worktree[] = [
  { id: 'wa1', projectId: 'pa', branch: 'x/one', path: '/wt/one', isMain: false, added: 3, removed: 1 },
  { id: 'wa2', projectId: 'pa', branch: 'x/two', path: '/wt/two', isMain: false, added: 0, removed: 0 },
  { id: 'wam', projectId: 'pa', branch: 'main', path: '/a', isMain: true },
  { id: 'wb1', projectId: 'pb', branch: 'x/three', path: '/wt/three', isMain: false, added: 10, removed: 2 }
]

function session(id: string, worktreeId: string, status: SessionStatus, lastActivityAt = 0, extra: Partial<Session> = {}): Session {
  return { id, worktreeId, kind: 'claude', title: id, status, startedAt: 0, lastActivityAt, ...extra }
}

describe('buildSidebarGroups', () => {
  it('groups by project in store order and keeps projects without sessions', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [session('s1', 'wa1', 'running'), session('s2', 'wb1', 'idle'), session('s3', 'wa2', 'running')]
    })
    expect(groups.map((g) => g.title)).toEqual(['alpha', 'beta', 'empty'])
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['s1', 's3'])
    expect(groups[2]).toMatchObject({ rows: [], sessionCount: 0 })
  })

  it('hoists attention sessions into a top queue, most urgent first, without duplicating them', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('done', 'wa1', 'done_unread', 50),
        session('run', 'wa2', 'running', 100),
        session('err', 'wb1', 'error', 10),
        session('ask-old', 'wam', 'needs_you', 5),
        session('ask-new', 'wam', 'needs_you', 20)
      ]
    })
    expect(groups[0]).toMatchObject({ kind: 'attention', title: '等你处理' })
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['ask-new', 'ask-old', 'err', 'done'])
    const all = visibleSessionIds(groups)
    expect(all).toHaveLength(5)
    expect(new Set(all).size).toBe(5)
    expect(groups.find((g) => g.id === 'pa')?.rows.map((r) => r.session.id)).toEqual(['run'])
    // beta's only session is hoisted: the project stays (empty) but still counts that session
    expect(groups.find((g) => g.id === 'pb')).toMatchObject({ rows: [], sessionCount: 1 })
  })

  it('shows no queue when nothing needs attention', () => {
    const groups = buildSidebarGroups({ projects, worktrees, sessions: [session('s1', 'wa1', 'running')] })
    expect(groups.some((g) => g.kind === 'attention')).toBe(false)
  })

  it('derives secondary line, attention flag and diff stat', () => {
    const [group] = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('a', 'wa1', 'running', 0, { currentAction: '编辑 a.ts' }),
        session('b', 'wa2', 'running'),
        session('c', 'wam', 'idle')
      ]
    })
    const [a, b, c] = group?.rows ?? []
    expect(a).toMatchObject({ secondary: '编辑 a.ts', attention: false, stat: { added: 3, removed: 1 } })
    expect(b).toMatchObject({ secondary: 'x/two', stat: null })
    expect(c).toMatchObject({ secondary: '/a', stat: null })
  })

  it('flags only needs_you as the attention variant', () => {
    const [group] = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [session('q', 'wa1', 'needs_you'), session('e', 'wa2', 'error')]
    })
    expect(group?.rows.map((r) => [r.session.id, r.attention])).toEqual([
      ['q', true],
      ['e', false]
    ])
  })
})

describe('keyboard targets', () => {
  const groups = buildSidebarGroups({
    projects,
    worktrees,
    sessions: [
      session('run1', 'wa1', 'running'),
      session('run2', 'wb1', 'running'),
      session('ask', 'wa2', 'needs_you'),
      session('err', 'wam', 'error')
    ]
  })
  // on-screen order: ask, err | run1 | run2
  it('orders visible sessions as drawn', () => {
    expect(visibleSessionIds(groups)).toEqual(['ask', 'err', 'run1', 'run2'])
  })

  it('maps ⌘1–⌘9 to the nth visible session', () => {
    expect(sessionForShortcut(groups, 1)).toBe('ask')
    expect(sessionForShortcut(groups, 4)).toBe('run2')
    expect(sessionForShortcut(groups, 5)).toBeNull()
    expect(sessionForShortcut(groups, 0)).toBeNull()
    expect(sessionForShortcut(groups, 10)).toBeNull()
  })

  it('cycles ⌘J through the attention queue', () => {
    expect(nextAttentionSessionId(groups, 'run1')).toBe('ask')
    expect(nextAttentionSessionId(groups, null)).toBe('ask')
    expect(nextAttentionSessionId(groups, 'ask')).toBe('err')
    expect(nextAttentionSessionId(groups, 'err')).toBe('ask')
  })

  it('has no ⌘J target without attention sessions', () => {
    const quiet = buildSidebarGroups({ projects, worktrees, sessions: [session('r', 'wa1', 'running')] })
    expect(nextAttentionSessionId(quiet, 'r')).toBeNull()
  })

  it('moves with ↑/↓, clamped at the ends', () => {
    expect(adjacentSessionId(groups, 'ask', 1)).toBe('err')
    expect(adjacentSessionId(groups, 'run2', 1)).toBe('run2')
    expect(adjacentSessionId(groups, 'ask', -1)).toBe('ask')
    expect(adjacentSessionId(groups, null, 1)).toBe('ask')
    expect(adjacentSessionId(groups, null, -1)).toBe('run2')
    expect(adjacentSessionId([], 'x', 1)).toBeNull()
  })
})
