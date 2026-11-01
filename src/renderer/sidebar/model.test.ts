import { describe, expect, it } from 'vitest'
import type { Project, Session, SessionStatus, Worktree } from '@shared/types'
import {
  adjacentSessionId,
  buildSidebarGroups,
  nestedTitle,
  nextAttentionSessionId,
  sameRow,
  sameSubagent,
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

  it('keeps every session under its own project, whatever its status', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('done', 'wa1', 'done_unread', 50),
        session('run', 'wa2', 'running', 100),
        session('err', 'wb1', 'error', 10),
        session('ask', 'wam', 'needs_you', 5)
      ]
    })
    expect(groups.map((g) => g.id)).toEqual(['pa', 'pb', 'pc'])
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['done', 'run', 'ask'])
    expect(groups[1]).toMatchObject({ rows: [{ session: { id: 'err' } }], sessionCount: 1 })
  })

  it('a collapsed project draws no rows but keeps its count and its most urgent attention status', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      collapsedProjectIds: ['pa'],
      sessions: [session('done', 'wa1', 'done_unread', 50), session('ask', 'wam', 'needs_you', 5), session('run', 'wa2', 'running')]
    })
    expect(groups[0]).toMatchObject({ collapsed: true, rows: [], sessionCount: 3, attention: 'needs_you' })
    expect(groups[1]).toMatchObject({ collapsed: false, attention: null })
  })

  it('derives secondary line, attention flag and branch', () => {
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
    expect(a).toMatchObject({ secondary: '编辑 a.ts', attention: false, branch: 'x/one' })
    expect(b).toMatchObject({ secondary: '', branch: 'x/two' })
    // The main checkout no longer spells out its folder: the project header names it (Figma 34P).
    expect(c).toMatchObject({ secondary: '', branch: 'main' })
    expect(a).not.toHaveProperty('stat')
  })

  it('a finished turn shows its last reply, marked while unread', () => {
    const [group] = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('u', 'wa1', 'done_unread', 0, { lastReply: '修好了登录' }),
        session('n', 'wa2', 'done_unread'),
        session('i', 'wam', 'idle', 0, { lastReply: '修好了登录' })
      ]
    })
    expect(group?.rows.map((r) => r.secondary)).toEqual(['已完成 · 修好了登录', '已完成 · 未读', '修好了登录'])
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
  const sessions = [
    session('run1', 'wa1', 'running'),
    session('run2', 'wb1', 'running'),
    session('ask', 'wa2', 'needs_you'),
    session('err', 'wam', 'error')
  ]
  const groups = buildSidebarGroups({ projects, worktrees, sessions })
  // on-screen order: alpha (run1, ask, err) | beta (run2)
  it('orders visible sessions as drawn', () => {
    expect(visibleSessionIds(groups)).toEqual(['run1', 'ask', 'err', 'run2'])
  })

  it('maps ⌘1–⌘9 to the nth visible session', () => {
    expect(sessionForShortcut(groups, 1)).toBe('run1')
    expect(sessionForShortcut(groups, 4)).toBe('run2')
    expect(sessionForShortcut(groups, 5)).toBeNull()
    expect(sessionForShortcut(groups, 0)).toBeNull()
    expect(sessionForShortcut(groups, 10)).toBeNull()
  })

  it('skips the rows of a collapsed project for ⌘1–9', () => {
    const folded = buildSidebarGroups({ projects, worktrees, sessions, collapsedProjectIds: ['pa'] })
    expect(sessionForShortcut(folded, 1)).toBe('run2')
  })

  it('cycles ⌘J through sessions needing attention, most urgent first, collapsed projects included', () => {
    expect(nextAttentionSessionId(sessions, 'run1')).toBe('ask')
    expect(nextAttentionSessionId(sessions, null)).toBe('ask')
    expect(nextAttentionSessionId(sessions, 'ask')).toBe('err')
    expect(nextAttentionSessionId(sessions, 'err')).toBe('ask')
  })

  it('has no ⌘J target without attention sessions', () => {
    expect(nextAttentionSessionId([session('r', 'wa1', 'running')], 'r')).toBeNull()
  })

  it('moves with ↑/↓, clamped at the ends', () => {
    expect(adjacentSessionId(groups, 'run1', 1)).toBe('ask')
    expect(adjacentSessionId(groups, 'run2', 1)).toBe('run2')
    expect(adjacentSessionId(groups, 'run1', -1)).toBe('run1')
    expect(adjacentSessionId(groups, null, 1)).toBe('run1')
    expect(adjacentSessionId(groups, null, -1)).toBe('run2')
    expect(adjacentSessionId([], 'x', 1)).toBeNull()
  })
})

describe('dispatched sessions (PRD F21)', () => {
  it('follow the session that started them, one step in; others keep store order', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('child-b', 'wa2', 'running', 0, { dispatchedBy: 'parent' }),
        session('parent', 'wam', 'idle'),
        session('other', 'wa1', 'idle'),
        session('child-a', 'wa1', 'idle', 0, { dispatchedBy: 'parent' }),
        session('orphan', 'wa1', 'idle', 0, { dispatchedBy: 'gone' })
      ]
    })
    expect(groups[0]?.rows.map((r) => `${r.session.id}:${r.depth}`)).toEqual(['parent:0', 'child-b:1', 'child-a:1', 'other:0', 'orphan:0'])
    // The line in the glyph column (Figma 40C): from the dispatcher, through each child, ending at the last.
    expect(groups[0]?.rows.map((r) => r.tree)).toEqual(['parent', 'child', 'last', undefined, undefined])
  })

  it('shows a nested 同任务多解 part by the name after its parent’s title', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('parent', 'wam', 'idle', 0, { title: 'Cookie 会话迁移' }),
        session('part', 'wa1', 'running', 0, { title: 'Cookie 会话迁移 · Codex', dispatchedBy: 'parent' })
      ]
    })
    expect(groups[0]?.rows.map((r) => r.title)).toEqual(['Cookie 会话迁移', 'Codex'])
    expect(nestedTitle('别的名字', 'Cookie 会话迁移')).toBe('别的名字')
    expect(nestedTitle('Cookie 会话迁移 · ', 'Cookie 会话迁移')).toBe('Cookie 会话迁移 · ')
  })
})

describe('subagents under their session (PRD F21 v1.109, Figma 44B)', () => {
  const sub = (id: string, title = id, model?: string) => ({ id, title, ...(model ? { model } : {}) })
  const draw = (rows: ReturnType<typeof buildSidebarGroups>[number]['rows']) =>
    rows.flatMap((r) => [
      `${r.session.id}:${r.depth}:${r.tree ?? '-'}${r.opens ? ':opens' : ''}`,
      ...(r.after ?? []).map((a) => `  ${a.id}:${a.depth}:${a.tree}${a.pass ? ':pass' : ''}${a.attention ? ':asks' : ''}`)
    ])

  it('hangs a top-level session’s subagents under it on its line, and keeps them out of the keyboard order', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [session('s1', 'wa1', 'running', 0, { askingAgents: ['a2'] }), session('s2', 'wa2', 'idle')],
      subagents: { s1: [sub('a1', '梳理 auth', 'Fable 5.1'), sub('a2')] }
    })
    expect(draw(groups[0]!.rows)).toEqual(['s1:0:parent', '  a1:1:child', '  a2:1:last:asks', 's2:0:-'])
    expect(groups[0]!.rows[0]!.after?.[0]).toMatchObject({ sessionId: 's1', title: '梳理 auth', model: 'Fable 5.1' })
    expect(visibleSessionIds(groups)).toEqual(['s1', 's2'])
  })

  it('puts a dispatcher’s own subagents after its children, and a child’s one level in', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('parent', 'wam', 'running'),
        session('c1', 'wa1', 'running', 0, { dispatchedBy: 'parent' }),
        session('c2', 'wa2', 'needs_you', 0, { dispatchedBy: 'parent', askingAgents: ['x'] })
      ],
      subagents: { parent: [sub('p1'), sub('p2')], c1: [sub('k')], c2: [sub('x')] }
    })
    expect(draw(groups[0]!.rows)).toEqual([
      'parent:0:parent',
      'c1:1:child:opens',
      '  k:2:last:pass',
      'c2:1:child:opens',
      // The dispatcher's line goes on past c2's subagent to its own two.
      '  x:2:last:pass:asks',
      '  p1:1:child',
      '  p2:1:last'
    ])
  })

  it('nests a grandchild under its own dispatcher one more step in, before that child’s subagents (Figma 44B)', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('parent', 'wam', 'running'),
        session('c1', 'wa1', 'running', 0, { dispatchedBy: 'parent', dispatchModel: 'gpt-6-sol' }),
        session('g1', 'wa2', 'running', 0, { dispatchedBy: 'c1', title: 'c1 · review', dispatchBase: 'snapshot' }),
        session('c2', 'wa2', 'idle', 0, { dispatchedBy: 'parent' })
      ],
      subagents: { c1: [sub('k')] }
    })
    const rows = groups[0]!.rows
    expect(rows.map((r) => `${r.session.id}:${r.depth}:${r.tree ?? '-'}${r.opens ? ':opens' : ''}${r.pass ? ':pass' : ''}`)).toEqual([
      'parent:0:parent',
      'c1:1:child:opens',
      'g1:2:child:pass',
      'c2:1:last'
    ])
    expect(rows[2]!.after?.map((a) => `${a.id}:${a.depth}:${a.tree}${a.pass ? ':pass' : ''}`)).toEqual(['k:2:last:pass'])
    expect(rows[1]!.model).toBe('gpt-6-sol')
    expect(rows[2]!.title).toBe('review')
    expect(rows[2]!.branch).toBe('快照')
    expect(visibleSessionIds(groups)).toEqual(['parent', 'c1', 'g1', 'c2'])
  })

  it('ends the dispatcher’s line at its last child when it has no subagents of its own', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [session('parent', 'wam', 'idle'), session('c1', 'wa1', 'running', 0, { dispatchedBy: 'parent' })],
      subagents: { c1: [sub('k')] }
    })
    expect(draw(groups[0]!.rows)).toEqual(['parent:0:parent', 'c1:1:last:opens', '  k:2:last'])
  })

  it('does not redraw the session row when only its subagents change, but does when its line starts', () => {
    const parent = session('parent', 'wam', 'running')
    const child = session('c1', 'wa1', 'running', 0, { dispatchedBy: 'parent' })
    const rows = (subagents: Record<string, ReturnType<typeof sub>[]>) =>
      buildSidebarGroups({ projects, worktrees, sessions: [parent, child], subagents })[0]!.rows
    const one = rows({ c1: [sub('a', 'one')] })
    const named = rows({ c1: [sub('a', 'one', 'Opus 5.5')] })
    const none = rows({})
    // SubagentRow compares its own row; the session row draws only where its line starts.
    expect(sameRow(one[1]!, named[1]!)).toBe(true)
    expect(sameRow(one[1]!, none[1]!)).toBe(false)
    expect(sameSubagent(one[1]!.after![0]!, named[1]!.after![0]!)).toBe(false)
  })
})

describe('sameRow', () => {
  const rows = (sessions: Session[], trees = worktrees) => buildSidebarGroups({ projects, worktrees: trees, sessions })[0]!.rows

  it('treats a rebuilt row of an untouched session as the same, and a touched one as different', () => {
    const s1 = session('s1', 'wa1', 'running')
    const s3 = session('s3', 'wa2', 'running')
    const before = rows([s1, s3])
    // An agent's hook event replaces one session object; the store keeps the others.
    const after = rows([{ ...s1, lastActivityAt: 5 }, s3])
    expect(after[1]).not.toBe(before[1])
    expect(sameRow(before[1]!, after[1]!)).toBe(true)
    expect(sameRow(before[0]!, after[0]!)).toBe(false)
  })

  it('notices a changed branch from the worktree', () => {
    const s1 = session('s1', 'wa1', 'running')
    const before = rows([s1])
    const after = rows([s1], worktrees.map((w) => (w.id === 'wa1' ? { ...w, branch: 'x/renamed' } : w)))
    expect(sameRow(before[0]!, after[0]!)).toBe(false)
  })
})
