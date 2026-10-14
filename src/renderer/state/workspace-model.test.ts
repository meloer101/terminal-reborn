import { describe, expect, it } from 'vitest'
import {
  addProject,
  addSession,
  closeSession,
  EMPTY_WORKSPACE,
  projectOfSession,
  removeProject,
  restoreWorkspace,
  serializeWorkspace,
  type MakeId,
  type WorkspaceData
} from './workspace-model'

function ids(): MakeId {
  let n = 0
  return (prefix) => `${prefix}-${++n}`
}

function withSessions(...kinds: Array<'claude' | 'codex' | 'shell'>): WorkspaceData {
  const makeId = ids()
  const { data, projectId } = addProject(EMPTY_WORKSPACE, '/Users/m/code/acme', makeId)
  return kinds.reduce((d, kind) => addSession(d, projectId, kind, 1000, makeId)!.data, data)
}

describe('addProject', () => {
  it('creates a project named after the folder, with a main worktree', () => {
    const { data, projectId } = addProject(EMPTY_WORKSPACE, '/Users/m/code/acme/', ids())
    expect(data.projects).toEqual([{ id: projectId, name: 'acme', rootPath: '/Users/m/code/acme/' }])
    expect(data.worktrees).toEqual([{ id: 'w-2', projectId, branch: '', path: '/Users/m/code/acme/', isMain: true }])
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
  it('round-trips and restores sessions as fresh idle ones', () => {
    const data = withSessions('claude', 'shell')
    const live = { ...data, sessions: data.sessions.map((s) => ({ ...s, status: 'running' as const, currentAction: 'x' })) }
    const restored = restoreWorkspace(serializeWorkspace(live), 5000)
    expect(restored.projects).toEqual(data.projects)
    expect(restored.worktrees).toEqual(data.worktrees)
    expect(restored.sessions).toEqual(data.sessions.map((s) => ({ ...s, startedAt: 5000, lastActivityAt: 5000 })))
    expect(restored.activeSessionId).toBe(data.activeSessionId)
  })

  it('drops malformed and orphaned entries', () => {
    const raw = JSON.stringify({
      projects: [{ id: 'p', name: 'p', rootPath: '/p' }, { id: 1 }],
      worktrees: [
        { id: 'w', projectId: 'p', branch: '', path: '/p', isMain: true },
        { id: 'w2', projectId: 'gone', branch: '', path: '/x', isMain: true }
      ],
      sessions: [
        { id: 's', worktreeId: 'w', kind: 'claude', title: 't' },
        { id: 's2', worktreeId: 'w2', kind: 'claude', title: 't' },
        { id: 's3', worktreeId: 'w', kind: 'gemini', title: 't' }
      ],
      activeSessionId: 's2'
    })
    const restored = restoreWorkspace(raw, 0)
    expect(restored.sessions.map((s) => s.id)).toEqual(['s'])
    expect(restored.worktrees.map((w) => w.id)).toEqual(['w'])
    expect(restored.activeSessionId).toBe('s')
  })

  it.each([null, '', '{', '[]', '42'])('falls back to an empty workspace for %j', (raw) => {
    expect(restoreWorkspace(raw, 0)).toEqual(EMPTY_WORKSPACE)
  })
})
