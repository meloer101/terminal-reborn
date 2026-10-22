import { describe, expect, it } from 'vitest'
import { migrateLegacyWorkspace, sanitizeWorkspaceFile, WORKSPACE_FILE_VERSION, type WorkspaceFile } from './workspace-file'

const valid = {
  version: 2,
  projects: [{ id: 'p1', name: 'acme', rootPath: '/code/acme' }],
  worktrees: [{ id: 'w1', projectId: 'p1', branch: 'main', path: '/code/acme', isMain: true }],
  sessions: [
    { id: 's1', worktreeId: 'w1', kind: 'claude', title: 'Claude Code', agentSessionId: 'abc-123', startedAt: 100, lastActivityAt: 200 },
    { id: 's2', worktreeId: 'w1', kind: 'shell', title: '终端', startedAt: 150, lastActivityAt: 150 }
  ],
  activeSessionId: 's2',
  sidebarCollapsed: true,
  rightPanel: 'git',
  collapsedProjectIds: ['p1'],
  drafts: { s1: '草稿' }
}

describe('sanitizeWorkspaceFile', () => {
  it('round-trips a valid file', () => {
    expect(sanitizeWorkspaceFile(structuredClone(valid), 999)).toEqual(valid)
  })

  it('keeps review comments of worktrees that exist (F5)', () => {
    const note = { id: 'c1', group: 'committed', path: 'src/a.ts', side: 'new', line: 3, endLine: 4, code: 'x', text: '改一下', createdAt: 5 }
    const file = sanitizeWorkspaceFile({ ...structuredClone(valid), reviewComments: { '/code/acme': [note], '/elsewhere': [note] } }, 0)
    expect(file?.reviewComments).toEqual({ '/code/acme': [note] })
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), reviewComments: { '/elsewhere': [note] } }, 0)).not.toHaveProperty('reviewComments')
  })

  it('keeps 一题多解 groups of sessions that exist; files without them stay as they were', () => {
    const group = { id: 'g1', prompt: '改登录页', base: 'main', createdAt: 5, members: ['s1', 'gone'] }
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), attemptGroups: [group] }, 0)?.attemptGroups).toEqual([{ ...group, members: ['s1'] }])
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), attemptGroups: [{ ...group, members: ['gone'] }] }, 0)).not.toHaveProperty('attemptGroups')
    expect(sanitizeWorkspaceFile(structuredClone(valid), 0)).not.toHaveProperty('attemptGroups')
  })

  it('rejects anything that is not a version-2 object', () => {
    expect(sanitizeWorkspaceFile(null, 0)).toBeNull()
    expect(sanitizeWorkspaceFile([], 0)).toBeNull()
    expect(sanitizeWorkspaceFile('x', 0)).toBeNull()
    expect(sanitizeWorkspaceFile({ ...valid, version: 1 }, 0)).toBeNull()
    expect(sanitizeWorkspaceFile({ ...valid, version: 3 }, 0)).toBeNull()
    expect(WORKSPACE_FILE_VERSION).toBe(2)
  })

  it('drops orphaned worktrees, sessions and drafts', () => {
    const file = sanitizeWorkspaceFile(
      {
        ...valid,
        worktrees: [...valid.worktrees, { id: 'w2', projectId: 'gone', branch: '', path: '/x', isMain: true }],
        sessions: [...valid.sessions, { id: 's3', worktreeId: 'w2', kind: 'claude', title: 't' }],
        drafts: { s1: 'a', s3: 'orphan', nope: 'x' }
      },
      0
    ) as WorkspaceFile
    expect(file.worktrees.map((w) => w.id)).toEqual(['w1'])
    expect(file.sessions.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(file.drafts).toEqual({ s1: 'a' })
  })

  it('drops malformed entries and duplicate ids', () => {
    const file = sanitizeWorkspaceFile(
      {
        ...valid,
        projects: [...valid.projects, { id: 'p1', name: 'dup', rootPath: '/dup' }, { id: 5, name: 'x', rootPath: '/x' }, 'junk'],
        sessions: [
          ...valid.sessions,
          { id: 's1', worktreeId: 'w1', kind: 'claude', title: 'dup' },
          { id: 's9', worktreeId: 'w1', kind: 'vim', title: 'bad kind' },
          { id: 's8', worktreeId: 'w1', kind: 'claude', title: 7 }
        ]
      },
      0
    ) as WorkspaceFile
    expect(file.projects).toHaveLength(1)
    expect(file.sessions.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('falls back to the first session when the active one is gone, and to null when there are none', () => {
    expect(sanitizeWorkspaceFile({ ...valid, activeSessionId: 'zzz' }, 0)?.activeSessionId).toBe('s1')
    expect(sanitizeWorkspaceFile({ ...valid, sessions: [], drafts: {} }, 0)?.activeSessionId).toBeNull()
  })

  it('keeps startedAt, defaults missing timestamps, and ignores bad ones', () => {
    const file = sanitizeWorkspaceFile(
      {
        ...valid,
        sessions: [
          { id: 'a', worktreeId: 'w1', kind: 'claude', title: 't', startedAt: 5, lastActivityAt: 9 },
          { id: 'b', worktreeId: 'w1', kind: 'claude', title: 't' },
          { id: 'c', worktreeId: 'w1', kind: 'claude', title: 't', startedAt: 'x', lastActivityAt: -1 }
        ]
      },
      777
    ) as WorkspaceFile
    expect(file.sessions.map((s) => [s.startedAt, s.lastActivityAt])).toEqual([
      [5, 9],
      [777, 777],
      [777, 777]
    ])
  })

  it('accepts only shell-safe conversation ids, and none for shells', () => {
    const file = sanitizeWorkspaceFile(
      {
        ...valid,
        sessions: [
          { id: 'a', worktreeId: 'w1', kind: 'claude', title: 't', agentSessionId: '--dangerous' },
          { id: 'b', worktreeId: 'w1', kind: 'codex', title: 't', agentSessionId: "x'; rm -rf ~" },
          { id: 'c', worktreeId: 'w1', kind: 'codex', title: 't', agentSessionId: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000' },
          { id: 'd', worktreeId: 'w1', kind: 'shell', title: 't', agentSessionId: 'abc' }
        ],
        drafts: {}
      },
      0
    ) as WorkspaceFile
    expect(file.sessions.map((s) => s.agentSessionId)).toEqual([undefined, undefined, '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000', undefined])
  })

  it("keeps the Run button's terminal marker on shell sessions only (PRD F4)", () => {
    const file = sanitizeWorkspaceFile(
      {
        ...valid,
        sessions: [
          { id: 'a', worktreeId: 'w1', kind: 'shell', title: 'run', script: 'run' },
          { id: 'b', worktreeId: 'w1', kind: 'claude', title: 't', script: 'run' },
          { id: 'c', worktreeId: 'w1', kind: 'shell', title: 't', script: 'setup' }
        ],
        drafts: {}
      },
      0
    ) as WorkspaceFile
    expect(file.sessions.map((s) => s.script)).toEqual(['run', undefined, undefined])
  })

  it('keeps who dispatched a session (PRD F21): one level, and only while the dispatcher is in the file', () => {
    const file = sanitizeWorkspaceFile(
      {
        ...valid,
        sessions: [
          { id: 'p', worktreeId: 'w1', kind: 'claude', title: 'plan' },
          { id: 'c1', worktreeId: 'w1', kind: 'codex', title: 'impl', dispatchedBy: 'p', dispatchTask: 'Do X' },
          { id: 'c2', worktreeId: 'w1', kind: 'claude', title: 'orphan', dispatchedBy: 'gone', dispatchTask: 'Do Y' },
          { id: 'c3', worktreeId: 'w1', kind: 'claude', title: 'grandchild', dispatchedBy: 'c1' },
          { id: 'c4', worktreeId: 'w1', kind: 'shell', title: 'shell', dispatchedBy: 'p' }
        ],
        drafts: {}
      },
      0
    ) as WorkspaceFile
    expect(file.sessions.map((s) => [s.id, s.dispatchedBy, s.dispatchTask])).toEqual([
      ['p', undefined, undefined],
      ['c1', 'p', 'Do X'],
      ['c2', undefined, undefined],
      ['c3', undefined, undefined],
      ['c4', undefined, undefined]
    ])
  })

  it('defaults UI fields and drops empty drafts', () => {
    const file = sanitizeWorkspaceFile(
      { ...valid, sidebarCollapsed: 'yes', rightPanel: 'bogus', collapsedProjectIds: 'p1', drafts: { s1: '' } },
      0
    ) as WorkspaceFile
    expect(file.sidebarCollapsed).toBe(false)
    expect(file.rightPanel).toBeNull()
    expect(file.collapsedProjectIds).toEqual([])
    expect(file.drafts).toEqual({})
    expect(file.recentProjects).toBeUndefined()
  })

  it('keeps the sidebar width within its limits', () => {
    expect(sanitizeWorkspaceFile({ ...valid, sidebarWidth: 301.6 }, 0)!.sidebarWidth).toBe(302)
    expect(sanitizeWorkspaceFile({ ...valid, sidebarWidth: 40 }, 0)!.sidebarWidth).toBe(200)
    expect(sanitizeWorkspaceFile({ ...valid, sidebarWidth: 9000 }, 0)!.sidebarWidth).toBe(480)
    expect(sanitizeWorkspaceFile({ ...valid, sidebarWidth: 'wide' }, 0)).not.toHaveProperty('sidebarWidth')
  })

  it('reads the pre-F17 panel names as the Git view and keeps the last view and width', () => {
    expect(sanitizeWorkspaceFile({ ...valid, rightPanel: 'changes' }, 0)!.rightPanel).toBe('git')
    expect(sanitizeWorkspaceFile({ ...valid, rightPanel: 'graph' }, 0)!.rightPanel).toBe('git')
    const file = sanitizeWorkspaceFile({ ...valid, rightPanel: null, lastRightPanel: 'files', rightPanelWidth: 523.4 }, 0)!
    expect(file.lastRightPanel).toBe('files')
    expect(file.rightPanelWidth).toBe(523)
    expect(sanitizeWorkspaceFile({ ...valid, rightPanelWidth: 12 }, 0)!.rightPanelWidth).toBe(400)
    expect(sanitizeWorkspaceFile({ ...valid, rightPanelWidth: 'wide', lastRightPanel: 'x' }, 0)).not.toHaveProperty('rightPanelWidth')
    expect(sanitizeWorkspaceFile({ ...valid, diffLayout: 'split' }, 0)!.diffLayout).toBe('split')
    expect(sanitizeWorkspaceFile({ ...valid, diffLayout: 'sideways' }, 0)).not.toHaveProperty('diffLayout')
  })

  it('keeps the main-area split (F20), only with sessions the sidebar lists, and the keyboard in one of its panes', () => {
    const split = { type: 'split', dir: 'row', sizes: [0.6, 0.4], children: [{ type: 'pane', id: 's1' }, { type: 'pane', id: 's2' }] }
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), split }, 0)?.split).toEqual(split)
    // The active session is not shown: the keyboard goes to the first pane.
    const three = { type: 'split', dir: 'row', sizes: [1, 1], children: [{ type: 'pane', id: 's1' }, { type: 'pane', id: 's3' }] }
    const withThird = {
      ...structuredClone(valid),
      sessions: [...valid.sessions, { id: 's3', worktreeId: 'w1', kind: 'shell', title: '终端', startedAt: 1, lastActivityAt: 1 }],
      split: three
    }
    expect(sanitizeWorkspaceFile(withThird, 0)?.activeSessionId).toBe('s1')
    // A pane of a session that is gone closes; one pane left is no split.
    const gone = { ...split, children: [{ type: 'pane', id: 's1' }, { type: 'pane', id: 'nope' }] }
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), split: gone }, 0)).not.toHaveProperty('split')
    // Archived worktrees' sessions are not listed, so they are not shown either.
    const archived = {
      ...structuredClone(valid),
      worktrees: [...valid.worktrees, { id: 'w2', projectId: 'p1', branch: 'b', path: '/code/b', isMain: false, archived: { id: 'a1b2c3d4', at: 1, commit: 'a'.repeat(40), dirty: false } }],
      sessions: [...valid.sessions, { id: 's3', worktreeId: 'w2', kind: 'shell', title: '终端', startedAt: 1, lastActivityAt: 1 }],
      split: three
    }
    expect(sanitizeWorkspaceFile(archived, 0)).not.toHaveProperty('split')
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), split: 'row' }, 0)).not.toHaveProperty('split')
  })

  it('keeps secondary windows (F20 · 多窗口), each session shown in one window only', () => {
    const windows = [{ key: 'w-a1', projectId: 'p1', activeSessionId: 's1', sidebarCollapsed: true, bounds: { x: -1200, y: 40, width: 900, height: 700 } }]
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), windows }, 0)?.windows).toEqual(windows)
    // Main shows s2, so a window cannot show it too.
    const clash = sanitizeWorkspaceFile({ ...structuredClone(valid), windows: [{ key: 'w-a1', activeSessionId: 's2' }] }, 0)
    expect(clash?.windows).toEqual([{ key: 'w-a1' }])
    // A main window with an unknown active session falls back to one the windows do not show.
    const fallback = sanitizeWorkspaceFile({ ...structuredClone(valid), activeSessionId: 'nope', windows }, 0)
    expect(fallback?.activeSessionId).toBe('s2')
    // A main window emptied by moving its last pane out stays empty.
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), activeSessionId: null, windows }, 0)?.activeSessionId).toBeNull()
    // Without windows, null still falls back to the first session (files from before windows).
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), activeSessionId: null }, 0)?.activeSessionId).toBe('s1')
    // A window for a removed project is dropped; garbage is ignored.
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), windows: [{ key: 'w-a1', projectId: 'p9' }] }, 0)).not.toHaveProperty('windows')
    expect(sanitizeWorkspaceFile({ ...structuredClone(valid), windows: 'yes' }, 0)).not.toHaveProperty('windows')
  })

  it('keeps recent project folders: absolute, unique, at most 8', () => {
    const recent = ['/a', 'relative', '/a', 7, '/b', ...Array.from({ length: 10 }, (_, i) => `/r${i}`)]
    const file = sanitizeWorkspaceFile({ ...valid, recentProjects: recent }, 0) as WorkspaceFile
    expect(file.recentProjects).toEqual(['/a', '/b', '/r0', '/r1', '/r2', '/r3', '/r4', '/r5'])
  })
})

describe('migrateLegacyWorkspace', () => {
  const legacyWorkspace = JSON.stringify({
    projects: valid.projects,
    worktrees: valid.worktrees,
    sessions: [{ id: 's1', worktreeId: 'w1', kind: 'claude', title: 'Claude Code' }],
    activeSessionId: 's1'
  })

  it('converts the v1 workspace and the separate drafts key', () => {
    const file = migrateLegacyWorkspace(legacyWorkspace, JSON.stringify({ s1: '未发送', gone: 'x' }), 1234)
    expect(file).toEqual({
      version: 2,
      projects: valid.projects,
      worktrees: valid.worktrees,
      sessions: [{ id: 's1', worktreeId: 'w1', kind: 'claude', title: 'Claude Code', startedAt: 1234, lastActivityAt: 1234 }],
      activeSessionId: 's1',
      sidebarCollapsed: false,
      rightPanel: null,
      collapsedProjectIds: [],
      drafts: { s1: '未发送' }
    })
  })

  it('returns null for nothing or garbage', () => {
    expect(migrateLegacyWorkspace(null, null, 0)).toBeNull()
    expect(migrateLegacyWorkspace('{nope', null, 0)).toBeNull()
    expect(migrateLegacyWorkspace('[1]', null, 0)).toBeNull()
  })

  it('survives corrupt drafts', () => {
    expect(migrateLegacyWorkspace(legacyWorkspace, '{bad', 0)?.drafts).toEqual({})
  })
})
