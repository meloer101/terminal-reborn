import { describe, expect, it } from 'vitest'
import { sanitizeWorkspaceFile } from '@shared/workspace-file'
import {
  rememberRecentProject,
  addProject,
  addSession,
  closeSession,
  EMPTY_WORKSPACE,
  persistedStateChanged,
  projectOfSession,
  removedSessionIds,
  removeProject,
  restoreWorkspace,
  serializeWorkspace,
  titleFromFirstPrompt,
  type MakeId,
  type WorkspaceData
} from './workspace-model'

function ids(): MakeId {
  let n = 0
  return (prefix) => `${prefix}-${++n}`
}

function withSessions(...kinds: Array<'claude' | 'codex' | 'shell'>): WorkspaceData {
  const makeId = ids()
  const { data, projectId } = addProject(EMPTY_WORKSPACE, '/Users/dev/code/acme', makeId)
  return kinds.reduce((d, kind) => addSession(d, projectId, kind, 1000, makeId)!.data, data)
}

describe('addProject', () => {
  it('creates a project named after the folder, with a main worktree', () => {
    const { data, projectId } = addProject(EMPTY_WORKSPACE, '/Users/dev/code/acme/', ids())
    expect(data.projects).toEqual([{ id: projectId, name: 'acme', rootPath: '/Users/dev/code/acme/' }])
    expect(data.worktrees).toEqual([{ id: 'w-2', projectId, branch: '', path: '/Users/dev/code/acme/', isMain: true }])
  })

  it('reuses the project when the folder is already added', () => {
    const first = addProject(EMPTY_WORKSPACE, '/a', ids())
    const second = addProject(first.data, '/a', ids())
    expect(second.data).toBe(first.data)
    expect(second.projectId).toBe(first.projectId)
  })
})

describe('addSession', () => {
  it('adds an idle session with a default title and selects it', () => {
    const data = withSessions('codex')
    expect(data.sessions).toEqual([
      { id: 's-3', worktreeId: 'w-2', kind: 'codex', title: 'Codex', status: 'idle', startedAt: 1000, lastActivityAt: 1000 }
    ])
    expect(data.activeSessionId).toBe('s-3')
  })

  it('returns null for an unknown project', () => {
    expect(addSession(EMPTY_WORKSPACE, 'nope', 'claude', 0)).toBeNull()
  })
})

describe('closeSession', () => {
  it('selects the next session, else the previous one', () => {
    const data = withSessions('claude', 'codex', 'shell') // s-3, s-4, s-5
    expect(closeSession({ ...data, activeSessionId: 's-4' }, 's-4').activeSessionId).toBe('s-5')
    expect(closeSession({ ...data, activeSessionId: 's-5' }, 's-5').activeSessionId).toBe('s-4')
    expect(closeSession(withSessions('claude'), 's-3').activeSessionId).toBeNull()
  })

  it('keeps the selection when closing another session', () => {
    const data = withSessions('claude', 'codex')
    expect(closeSession(data, 's-3').activeSessionId).toBe('s-4')
  })
})

describe('removeProject', () => {
  it('drops the project, its worktrees and sessions', () => {
    const data = withSessions('claude')
    expect(removeProject(data, data.projects[0]!.id)).toEqual(EMPTY_WORKSPACE)
  })
})

describe('projectOfSession', () => {
  it('finds the owning project', () => {
    const data = withSessions('claude')
    expect(projectOfSession(data, 's-3')).toBe('p-1')
    expect(projectOfSession(data, null)).toBeNull()
  })
})

describe('persistence', () => {
  const ui = { sidebarCollapsed: true, rightPanel: 'changes' as const, collapsedProjectIds: ['p-1', 'gone'], recentProjects: ['/code/a'] }

  it('round-trips; agent sessions come back not-started, shells have no phase, startedAt is kept', () => {
    const data = withSessions('claude', 'shell') // s-3, s-4 (startedAt 1000)
    const live: WorkspaceData = {
      ...data,
      sessions: data.sessions.map((s) => ({
        ...s,
        status: 'running' as const,
        currentAction: 'x',
        phase: 'ready' as const,
        lastActivityAt: 4242,
        ...(s.kind === 'claude' ? { agentSessionId: 'conv-1' } : {})
      }))
    }
    const file = serializeWorkspace(live, ui, { 's-3': 'draft' })
    expect(file.sidebarCollapsed).toBe(true)
    expect(file.rightPanel).toBe('changes')
    expect(file.collapsedProjectIds).toEqual(['p-1'])
    expect(file.drafts).toEqual({ 's-3': 'draft' })
    expect(file.recentProjects).toEqual(['/code/a'])
    // Everything live is left out of the file.
    expect(JSON.stringify(file)).not.toMatch(/running|currentAction|phase|ready/)

    const restored = restoreWorkspace(sanitizeWorkspaceFile(JSON.parse(JSON.stringify(file)), 0))
    expect(restored.projects).toEqual(data.projects)
    expect(restored.worktrees).toEqual(data.worktrees)
    expect(restored.sessions).toEqual([
      { id: 's-3', worktreeId: 'w-2', kind: 'claude', title: 'Claude Code', status: 'idle', startedAt: 1000, lastActivityAt: 4242, agentSessionId: 'conv-1', phase: 'not-started' },
      { id: 's-4', worktreeId: 'w-2', kind: 'shell', title: '终端', status: 'idle', startedAt: 1000, lastActivityAt: 4242 }
    ])
    expect(restored.activeSessionId).toBe(data.activeSessionId)
  })

  it('drops drafts of sessions that do not exist', () => {
    const data = withSessions('claude')
    expect(serializeWorkspace(data, ui, { 's-3': 'keep', gone: 'drop', 's-4': '' }).drafts).toEqual({ 's-3': 'keep' })
  })

  it('restores nothing as an empty workspace', () => {
    expect(restoreWorkspace(null)).toEqual(EMPTY_WORKSPACE)
  })

  it('a conversation id replaced later (after /clear) is what gets saved', () => {
    const data = withSessions('codex')
    const replaced = { ...data, sessions: data.sessions.map((s) => ({ ...s, agentSessionId: 'second' })) }
    expect(serializeWorkspace(replaced, ui, {}).sessions[0]?.agentSessionId).toBe('second')
  })
})

describe('persistedStateChanged', () => {
  const ui = { sidebarCollapsed: false, rightPanel: null, collapsedProjectIds: [], recentProjects: [] as string[] }
  const base = { ...withSessions('claude'), ...ui }

  it('ignores live status and activity', () => {
    const live = { ...base, sessions: base.sessions.map((s) => ({ ...s, status: 'running' as const, currentAction: 'x', lastActivityAt: 9, phase: 'ready' as const })) }
    expect(persistedStateChanged(live, base)).toBe(false)
  })

  it('notices structure, title, conversation id, selection and UI state', () => {
    const first = base.sessions[0]!
    expect(persistedStateChanged({ ...base, sessions: [] }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, sessions: [{ ...first, title: 'x' }] }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, sessions: [{ ...first, agentSessionId: 'c' }] }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, activeSessionId: null }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, sidebarCollapsed: true }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, rightPanel: 'graph' }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, collapsedProjectIds: ['p-1'] }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, recentProjects: ['/x'] }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, projects: [...base.projects] }, base)).toBe(true)
  })
})

describe('rememberRecentProject', () => {
  it('moves the folder to the front without duplicates and keeps at most 8', () => {
    expect(rememberRecentProject(['/a', '/b'], '/b')).toEqual(['/b', '/a'])
    const same = ['/a', '/b']
    expect(rememberRecentProject(same, '/a')).toBe(same)
    expect(rememberRecentProject(Array.from({ length: 8 }, (_, i) => `/r${i}`), '/new')).toHaveLength(8)
  })
})

describe('removedSessionIds', () => {
  it('lists the sessions that disappeared', () => {
    const data = withSessions('claude', 'codex')
    expect(removedSessionIds(closeSession(data, 's-3'), data)).toEqual(['s-3'])
    expect(removedSessionIds(removeProject(data, 'p-1'), data)).toEqual(['s-3', 's-4'])
    expect(removedSessionIds(data, data)).toEqual([])
  })
})

describe('titleFromFirstPrompt', () => {
  const fresh = { kind: 'claude' as const, title: 'Claude Code' }
  it('uses the first non-empty line of the first prompt', () => {
    expect(titleFromFirstPrompt(fresh, '\n  修复登录页 cookie 过期  \nmore')).toBe('修复登录页 cookie 过期')
  })
  it('clips long prompts by characters', () => {
    expect(titleFromFirstPrompt(fresh, '中'.repeat(50))).toBe(`${'中'.repeat(40)}…`)
  })
  it('keeps a title the session already has and ignores slash commands', () => {
    expect(titleFromFirstPrompt({ kind: 'claude', title: '结算页性能优化' }, 'hello')).toBeNull()
    expect(titleFromFirstPrompt(fresh, '/model')).toBeNull()
  })
})
