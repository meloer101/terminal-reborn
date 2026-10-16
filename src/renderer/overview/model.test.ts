import { describe, expect, it } from 'vitest'
import type { PendingPrompt } from '@shared/agent-events'
import type { Project, Session, SessionStatus, Worktree } from '@shared/types'
import { buildOverview, moveSelection, orderedIds, overviewSummary, parseFilter, tailLines } from './model'

const MIN = 60_000
const NOW = 100 * MIN

const projects: Project[] = [
  { id: 'pa', name: 'acme-web', rootPath: '/a' },
  { id: 'pb', name: 'terminal-reborn', rootPath: '/b' }
]
const worktrees: Worktree[] = [
  { id: 'wa', projectId: 'pa', branch: 'jacob/cookie', path: '/wt/cookie', isMain: false, added: 42, removed: 18 },
  { id: 'wam', projectId: 'pa', branch: '', path: '/a', isMain: true },
  { id: 'wb', projectId: 'pb', branch: 'jacob/graph', path: '/wt/graph', isMain: false }
]

function session(id: string, worktreeId: string, status: SessionStatus, minutesAgo = 0, extra: Partial<Session> = {}): Session {
  return { id, worktreeId, kind: 'claude', title: id, status, startedAt: NOW - 30 * MIN, lastActivityAt: NOW - minutesAgo * MIN, ...extra }
}

const permission: PendingPrompt = {
  kind: 'permission',
  id: 'q1',
  sessionId: 'ask',
  tool: 'Bash',
  input: {},
  summary: '运行 pnpm prisma migrate dev',
  canAllowAlways: true,
  createdAt: 0
}

describe('buildOverview', () => {
  const sessions = [
    session('run', 'wa', 'running', 1, { currentAction: '编辑 a.ts' }),
    session('ask', 'wa', 'needs_you', 3),
    session('ask-new', 'wb', 'needs_you', 1),
    session('err', 'wb', 'error', 5, { currentAction: 'pnpm build 失败' }),
    session('done', 'wa', 'done_unread', 2),
    session('sh', 'wam', 'idle', 30, { kind: 'shell' })
  ]
  const groups = buildOverview({ projects, worktrees, sessions, prompts: { ask: [permission] }, now: NOW })

  it('groups by what the session needs, most pressing first; exited only when present', () => {
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.session.id)])).toEqual([
      ['等你处理', ['ask', 'ask-new']],
      ['出错', ['err']],
      ['待审阅', ['done']],
      ['运行中', ['run']],
      ['空闲', ['sh']]
    ])
    const withExited = buildOverview({ projects, worktrees, sessions: [session('x', 'wa', 'exited')], prompts: {}, now: NOW })
    expect(withExited.at(-1)?.label).toBe('已退出')
  })

  it('describes each row: status text, place, summary, diff and time', () => {
    const ask = groups[0]?.rows[0]
    expect(ask).toMatchObject({
      statusLabel: '等你确认',
      tone: 'attention',
      where: 'acme-web › jacob/cookie',
      summary: '运行 pnpm prisma migrate dev',
      stat: '+42 −18',
      time: '已等 3m'
    })
    expect(groups[0]?.rows[1]).toMatchObject({ statusLabel: '等你处理', where: 'terminal-reborn › jacob/graph', stat: '' })
    expect(groups[1]?.rows[0]).toMatchObject({ statusLabel: '出错', tone: 'error', summary: 'pnpm build 失败', time: '5m 前' })
    expect(groups[3]?.rows[0]).toMatchObject({ statusLabel: '运行中', tone: 'plain', time: '30m' })
    expect(groups[4]?.rows[0]).toMatchObject({ where: 'acme-web', summary: '终端 · /a' })
  })

  it('a starting agent counts as running; a restored one is idle and says so', () => {
    const g = buildOverview({
      projects,
      worktrees,
      sessions: [session('s', 'wa', 'idle', 0, { phase: 'starting' }), session('r', 'wa', 'idle', 0, { phase: 'not-started' })],
      prompts: {},
      now: NOW
    })
    expect(g.find((x) => x.key === 'running')?.rows[0]?.statusLabel).toBe('启动中')
    expect(g.find((x) => x.key === 'idle')?.rows[0]).toMatchObject({ statusLabel: '未启动', summary: '未启动' })
  })

  it('filters by text, p: project and s: status, all tokens together', () => {
    const ids = (filter: string) =>
      buildOverview({ projects, worktrees, sessions, prompts: { ask: [permission] }, now: NOW, filter }).flatMap((g) =>
        g.rows.map((r) => r.session.id)
      )
    expect(ids('p:terminal')).toEqual(['ask-new', 'err'])
    expect(ids('s:出错')).toEqual(['err'])
    expect(ids('prisma')).toEqual(['ask'])
    expect(ids('p:acme s:等你')).toEqual(['ask'])
    expect(parseFilter('  P:Foo  bar ')).toEqual({ text: ['bar'], project: ['foo'], status: [] })
  })
})

describe('navigation helpers', () => {
  const groups = buildOverview({
    projects,
    worktrees,
    sessions: [session('a', 'wa', 'needs_you'), session('b', 'wa', 'running'), session('c', 'wb', 'idle')],
    prompts: {},
    now: NOW
  })

  it('orders ids as drawn and skips collapsed groups', () => {
    expect(orderedIds(groups, new Set())).toEqual(['a', 'b', 'c'])
    expect(orderedIds(groups, new Set(['running']))).toEqual(['a', 'c'])
  })

  it('moves the selection, clamped', () => {
    const ids = ['a', 'b', 'c']
    expect(moveSelection(ids, null, 1)).toBe('a')
    expect(moveSelection(ids, null, -1)).toBe('c')
    expect(moveSelection(ids, 'a', -1)).toBe('a')
    expect(moveSelection(ids, 'b', 1)).toBe('c')
    expect(moveSelection([], 'a', 1)).toBeNull()
  })

  it('summarises the header and tails a snapshot', () => {
    expect(overviewSummary([{ status: 'idle' }, { status: 'running' }], 0)).toBe('2 个会话')
    expect(overviewSummary([{ status: 'idle' }, { status: 'needs_you' }], 1)).toBe('2 个会话 · 1 个需要你')
    expect(tailLines('1\n2\n3\n\n  \n', 2)).toBe('2\n3')
  })
})
