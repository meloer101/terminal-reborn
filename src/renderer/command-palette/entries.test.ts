import { describe, expect, it } from 'vitest'
import type { Project, Session, Worktree } from '@shared/types'
import { buildEntries, buildActionEntries, currentProject, rankEntries, stepIndex, type PaletteInput } from './entries'

const projects: Project[] = [
  { id: 'p1', name: 'acme-web', rootPath: '/a' },
  { id: 'p2', name: 'terminal-reborn', rootPath: '/t' }
]
const worktrees: Worktree[] = [
  { id: 'w1', projectId: 'p1', branch: 'jacob/session-cookie', path: '/a/1', isMain: false },
  { id: 'w2', projectId: 'p1', branch: 'main', path: '/a', isMain: true },
  { id: 'w3', projectId: 'p2', branch: 'jacob/sidebar-status', path: '/t/1', isMain: false }
]
const session = (id: string, worktreeId: string, over: Partial<Session> = {}): Session => ({
  id,
  worktreeId,
  kind: 'claude',
  title: id,
  status: 'idle',
  startedAt: 0,
  lastActivityAt: 0,
  ...over
})
const sessions: Session[] = [
  session('idle-main', 'w2', { title: 'main', lastActivityAt: 10 }),
  session('running-old', 'w1', { title: 'Cookie 会话迁移', status: 'running', currentAction: '编辑 src/auth/session.ts', lastActivityAt: 5 }),
  session('running-new', 'w3', { title: '侧边栏状态聚合', status: 'running', currentAction: '读取 src/state/agents.ts', lastActivityAt: 50, kind: 'codex' }),
  session('needs', 'w1', { title: '结算页性能优化', status: 'needs_you', currentAction: '等待权限确认', lastActivityAt: 1 })
]

const input = (over: Partial<PaletteInput> = {}): PaletteInput => ({
  projects,
  worktrees,
  sessions,
  activeSessionId: 'idle-main',
  rightPanel: null,
  panelAvailable: true,
  ...over
})

const ids = (query: string, over: Partial<PaletteInput> = {}) =>
  rankEntries(buildEntries(input(over)), query).map((r) => r.entry.id)

describe('buildEntries', () => {
  it('lists sessions in sidebar order (project, then store order), then actions', () => {
    const all = buildEntries(input()).map((e) => e.id)
    expect(all.slice(0, 4)).toEqual(['session:idle-main', 'session:running-old', 'session:needs', 'session:running-new'])
    expect(all[4]).toBe('action:new-claude')
  })

  it('numbers the rows the sidebar shows with ⌘1–⌘9; folded projects keep their sessions but no number', () => {
    const shortcuts = (over: Partial<PaletteInput>) =>
      buildEntries(input(over))
        .filter((e) => e.section === 'sessions')
        .map((e) => [e.id, e.shortcut])
    expect(shortcuts({})).toEqual([
      ['session:idle-main', 'CmdOrCtrl+1'],
      ['session:running-old', 'CmdOrCtrl+2'],
      ['session:needs', 'CmdOrCtrl+3'],
      ['session:running-new', 'CmdOrCtrl+4']
    ])
    expect(shortcuts({ collapsedProjectIds: ['p1'] })).toEqual([
      ['session:idle-main', undefined],
      ['session:running-old', undefined],
      ['session:needs', undefined],
      ['session:running-new', 'CmdOrCtrl+1']
    ])
  })

  it('shows "project · current action" for sessions and falls back to the branch', () => {
    const byId = Object.fromEntries(buildEntries(input()).map((e) => [e.id, e]))
    expect(byId['session:running-old']!.subtitle).toBe('acme-web · 编辑 src/auth/session.ts')
    expect(byId['session:idle-main']!.subtitle).toBe('acme-web · main')
    expect(byId['session:needs']!.attention).toBe(true)
    expect(byId['session:running-old']!.attention).toBe(false)
  })

  it('targets the active session’s project for new sessions', () => {
    const titles = buildActionEntries(input({ activeSessionId: 'running-new' })).filter((e) => e.id.startsWith('action:new-'))
    expect(titles.map((e) => e.subtitle)).toEqual(['terminal-reborn', 'terminal-reborn', 'terminal-reborn'])
    expect(titles.map((e) => e.title)).toEqual(['新建 Claude Code 会话', '新建 Codex 会话', '新建终端'])
  })

  it('falls back to the first project, and omits new-session actions without any project', () => {
    expect(currentProject(input({ activeSessionId: null }))?.id).toBe('p1')
    const none = buildActionEntries(input({ projects: [], worktrees: [], sessions: [], activeSessionId: null }))
    expect(none.map((e) => e.id)).toEqual([
      'action:open-project',
      'action:toggle-overview',
      'action:toggle-sidebar',
      'action:toggle-changes',
      'action:theme-system',
      'action:theme-dark',
      'action:theme-light'
    ])
  })

  it('offers no panel toggle while the panel has no content (B11)', () => {
    expect(buildActionEntries(input({ panelAvailable: false })).map((e) => e.id)).not.toContain('action:toggle-changes')
  })

  it('labels the changes toggle by panel state', () => {
    const title = (rightPanel: 'changes' | 'graph' | null) =>
      buildActionEntries(input({ rightPanel })).find((e) => e.id === 'action:toggle-changes')!.title
    expect(title(null)).toBe('打开变更面板')
    expect(title('graph')).toBe('打开变更面板')
    expect(title('changes')).toBe('关闭变更面板')
  })
})

describe('rankEntries', () => {
  it('keeps everything in sidebar order for an empty query', () => {
    expect(ids('').slice(0, 4)).toEqual(['session:idle-main', 'session:running-old', 'session:needs', 'session:running-new'])
    expect(ids('')).toHaveLength(buildEntries(input()).length)
  })

  it.each([
    ['cookie', 'session:running-old'], // title, ASCII
    ['会话迁移', 'session:running-old'], // title, CJK
    ['迁移', 'session:running-old'],
    ['结页', 'session:needs'], // CJK subsequence
    ['sidebar', 'session:running-new'], // branch
    ['terminal', 'session:running-new'], // project
    ['agents.ts', 'session:running-new'], // current action
    ['codex', 'action:new-codex'], // action title beats the session's agent kind
    ['等你处理', 'session:needs'], // status label
    ['主题 深色', 'action:theme-dark'],
    ['dark', 'action:theme-dark'],
    ['侧栏', 'action:toggle-sidebar'],
    ['变更', 'action:toggle-changes'],
    ['打开项目', 'action:open-project']
  ])('%j finds %s first', (query, first) => {
    expect(ids(query)[0]).toBe(first)
  })

  it('matches a session by its agent kind', () => {
    expect(ids('codex')).toContain('session:running-new')
  })

  it('returns nothing when no entry matches', () => {
    expect(ids('qqqq')).toEqual([])
  })

  it('ranks the better match first inside a section', () => {
    // "acme" is the project of three sessions but only the title field of none: all tie, sidebar order decides.
    expect(ids('acme').filter((id) => id.startsWith('session:'))).toEqual(['session:idle-main', 'session:running-old', 'session:needs'])
    // "main": title match beats the branch/word match elsewhere.
    expect(ids('main')[0]).toBe('session:idle-main')
  })

  it('keeps sections contiguous and puts the section with the best hit first', () => {
    const sectionOrder = (query: string) => [...new Set(ids(query).map((id) => id.split(':')[0]))]
    expect(sectionOrder('')).toEqual(['session', 'action'])
    expect(sectionOrder('侧栏')).toEqual(['action', 'session']) // exact action title beats a fuzzy session hit
    expect(sectionOrder('cookie')).toEqual(['session'])
    const mixed = ids('s')
    const firstAction = mixed.findIndex((id) => id.startsWith('action:'))
    const firstSession = mixed.findIndex((id) => id.startsWith('session:'))
    const [first, second] = firstAction < firstSession ? ['action:', 'session:'] : ['session:', 'action:']
    const boundary = mixed.findIndex((id) => id.startsWith(second))
    expect(mixed.slice(0, boundary).every((id) => id.startsWith(first))).toBe(true)
    expect(mixed.slice(boundary).every((id) => id.startsWith(second))).toBe(true)
  })

  it('reports highlight ranges for the title', () => {
    const hit = rankEntries(buildEntries(input()), '会话')[0]!
    expect(hit.entry.id).toBe('session:running-old')
    expect(hit.ranges.title).toEqual([[7, 9]])
  })
})

describe('stepIndex', () => {
  it.each([
    [0, 3, 1, 1],
    [2, 3, 1, 2],
    [0, 3, -1, 0],
    [1, 3, -1, 0],
    [0, 0, 1, 0],
    [0, 1, -1, 0]
  ] as const)('step(%i of %i, %i) = %i', (index, count, dir, expected) => {
    expect(stepIndex(index, count, dir)).toBe(expected)
  })
})
