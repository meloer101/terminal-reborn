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
  rightPanel: 'graph',
  drafts: { s1: '草稿' }
}

describe('sanitizeWorkspaceFile', () => {
  it('round-trips a valid file', () => {
    expect(sanitizeWorkspaceFile(structuredClone(valid), 999)).toEqual(valid)
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

  it('defaults UI fields and drops empty drafts', () => {
    const file = sanitizeWorkspaceFile({ ...valid, sidebarCollapsed: 'yes', rightPanel: 'bogus', drafts: { s1: '' } }, 0) as WorkspaceFile
    expect(file.sidebarCollapsed).toBe(false)
    expect(file.rightPanel).toBeNull()
    expect(file.drafts).toEqual({})
    expect(file.recentProjects).toBeUndefined()
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
