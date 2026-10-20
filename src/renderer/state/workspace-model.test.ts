import { describe, expect, it } from 'vitest'
import { sanitizeWorkspaceFile } from '@shared/workspace-file'
import {
  rememberRecentProject,
  addProject,
  addRunSession,
  addSession,
  addSessionInWorktree,
  closeSession,
  EMPTY_WORKSPACE,
  forgetWorktrees,
  archiveWorktrees,
  unarchiveWorktrees,
  persistedStateChanged,
  projectOfSession,
  removedSessionIds,
  removeProject,
  restoreWorkspace,
  serializeWorkspace,
  titleFromAgent,
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

describe('addSessionInWorktree', () => {
  it('registers the folder as a linked worktree once and starts the session there', () => {
    const makeId = ids()
    const { data, projectId } = addProject(EMPTY_WORKSPACE, '/repo', makeId)
    const target = { path: '/wt/fix', branch: 'jacob/fix' }
    const first = addSessionInWorktree(data, projectId, target, 'claude', 1000, makeId)!
    expect(first.data.worktrees.at(-1)).toEqual({ id: 'w-3', projectId, branch: 'jacob/fix', path: '/wt/fix', isMain: false })
    expect(first.data.sessions.at(-1)).toMatchObject({ id: first.sessionId, worktreeId: 'w-3', kind: 'claude' })
    expect(first.data.activeSessionId).toBe(first.sessionId)
    const second = addSessionInWorktree(first.data, projectId, target, 'shell', 2000, makeId)!
    expect(second.data.worktrees).toHaveLength(2)
    expect(second.data.sessions.at(-1)?.worktreeId).toBe('w-3')
  })

  it("reuses the main checkout's record for its own path", () => {
    const makeId = ids()
    const { data, projectId } = addProject(EMPTY_WORKSPACE, '/repo', makeId)
    const result = addSessionInWorktree(data, projectId, { path: '/repo', branch: 'main' }, 'codex', 0, makeId)!
    expect(result.data.worktrees).toHaveLength(1)
    expect(result.data.sessions[0]?.worktreeId).toBe('w-2')
  })

  it('returns null for an unknown project', () => {
    expect(addSessionInWorktree(EMPTY_WORKSPACE, 'nope', { path: '/x', branch: 'x' }, 'claude', 0)).toBeNull()
  })
})

describe('addRunSession', () => {
  it("adds the worktree's run terminal, selected, and it survives a save and restore", () => {
    const makeId = ids()
    const { data } = addProject(EMPTY_WORKSPACE, '/repo', makeId)
    const result = addRunSession(data, 'w-2', 1000, makeId)!
    expect(result.data.sessions.at(-1)).toMatchObject({ id: result.sessionId, worktreeId: 'w-2', kind: 'shell', title: 'run', script: 'run' })
    expect(result.data.activeSessionId).toBe(result.sessionId)
    const file = serializeWorkspace(result.data, { sidebarCollapsed: false, sidebarWidth: 264, rightPanel: null, lastRightPanel: 'files' as const, rightPanelWidth: 560, diffLayout: 'unified' as const, collapsedProjectIds: [], recentProjects: [] as string[], newSessionWorkdir: {} }, {})
    const restored = restoreWorkspace(sanitizeWorkspaceFile(JSON.parse(JSON.stringify(file)), 0))
    expect(restored.sessions.at(-1)?.script).toBe('run')
    expect(addRunSession(data, 'nope', 0, makeId)).toBeNull()
  })
})

describe('forgetWorktrees', () => {
  it('drops linked worktree records with their sessions, never the main checkout', () => {
    const makeId = ids()
    const { data, projectId } = addProject(EMPTY_WORKSPACE, '/repo', makeId)
    const linked = addSessionInWorktree(data, projectId, { path: '/wt/fix', branch: 'fix' }, 'claude', 0, makeId)!
    const withMain = addSession(linked.data, projectId, 'shell', 0, makeId)!.data
    const next = forgetWorktrees(withMain, ['w-3', 'w-2'])
    expect(next.worktrees.map((w) => w.id)).toEqual(['w-2'])
    expect(next.sessions.map((s) => s.worktreeId)).toEqual(['w-2'])
    expect(forgetWorktrees(withMain, ['nope'])).toBe(withMain)
  })
})

describe('archiveWorktrees / unarchiveWorktrees (F15)', () => {
  const archive = { id: 'a1', at: 5, commit: 'a'.repeat(40), dirty: true }

  function linkedWorkspace() {
    const makeId = ids()
    const { data, projectId } = addProject(EMPTY_WORKSPACE, '/repo', makeId)
    const main = addSession(data, projectId, 'shell', 0, makeId)!.data
    const linked = addSessionInWorktree(main, projectId, { path: '/wt/fix', branch: 'fix' }, 'claude', 0, makeId)!
    return { data: linked.data, linkedId: linked.data.sessions[1]!.worktreeId, mainSession: main.sessions[0]!.id, agent: linked.sessionId }
  }

  it('marks the record, keeps its sessions, and moves the selection out of it', () => {
    const { data, linkedId, mainSession, agent } = linkedWorkspace()
    expect(data.activeSessionId).toBe(agent)
    const next = archiveWorktrees(data, [linkedId], archive)
    expect(next.worktrees.find((w) => w.id === linkedId)?.archived).toEqual(archive)
    expect(next.sessions.map((s) => s.id)).toContain(agent)
    expect(next.activeSessionId).toBe(mainSession)
    // The main checkout is never archived.
    const mainId = data.worktrees.find((w) => w.isMain)!.id
    expect(archiveWorktrees(data, [mainId], archive)).toBe(data)
  })

  it('survives the workspace file', () => {
    const { data, linkedId } = linkedWorkspace()
    const ui = { sidebarCollapsed: false, sidebarWidth: 264, rightPanel: null, lastRightPanel: 'files' as const, rightPanelWidth: 560, diffLayout: 'unified' as const, collapsedProjectIds: [], recentProjects: [] as string[], newSessionWorkdir: {} }
    const file = serializeWorkspace(archiveWorktrees(data, [linkedId], archive), ui, {})
    const saved = sanitizeWorkspaceFile(JSON.parse(JSON.stringify(file)), 0)
    expect(saved?.worktrees.find((w) => w.id === linkedId)?.archived).toEqual(archive)
    const bogus = sanitizeWorkspaceFile({ ...file, worktrees: file.worktrees.map((w) => (w.id === linkedId ? { ...w, archived: { id: '../x', at: 1, commit: 'zz' } } : w)) }, 0)
    expect(bogus?.worktrees.find((w) => w.id === linkedId)?.archived).toBeUndefined()
  })

  it('brings the record back with agents not started (they resume on first view) and selects its session', () => {
    const { data, linkedId, agent } = linkedWorkspace()
    const archived = archiveWorktrees(data, [linkedId], archive)
    const exited = { ...archived, sessions: archived.sessions.map((s) => (s.id === agent ? { ...s, status: 'exited' as const, phase: 'exited' as const } : s)) }
    const back = unarchiveWorktrees(exited, [linkedId])
    expect(back.worktrees.find((w) => w.id === linkedId)).not.toHaveProperty('archived')
    expect(back.sessions.find((s) => s.id === agent)).toMatchObject({ status: 'idle', phase: 'not-started' })
    expect(back.activeSessionId).toBe(agent)
    expect(unarchiveWorktrees(data, [linkedId])).toBe(data)
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
  const ui = { sidebarCollapsed: true, sidebarWidth: 264, rightPanel: 'files' as const, lastRightPanel: 'files' as const, rightPanelWidth: 520, diffLayout: 'unified' as const, collapsedProjectIds: ['p-1', 'gone'], recentProjects: ['/code/a'], newSessionWorkdir: { 'p-1': 'current' as const, gone: 'worktree' as const } }

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
    expect(file.sidebarWidth).toBe(264)
    expect(file.rightPanel).toBe('files')
    expect(file.lastRightPanel).toBe('files')
    expect(file.rightPanelWidth).toBe(520)
    expect(file.diffLayout).toBeUndefined()
    expect(serializeWorkspace(live, { ...ui, diffLayout: 'split' }, {}).diffLayout).toBe('split')
    expect(file.collapsedProjectIds).toEqual(['p-1'])
    expect(file.drafts).toEqual({ 's-3': 'draft' })
    expect(file.recentProjects).toEqual(['/code/a'])
    expect(file.newSessionWorkdir).toEqual({ 'p-1': 'current' })
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

  it('keeps where a title came from across a restart', () => {
    const data = withSessions('claude')
    const named = { ...data, sessions: data.sessions.map((s) => ({ ...s, title: '会话自动标题', titleSource: 'agent' as const })) }
    const file = serializeWorkspace(named, ui, {})
    expect(file.sessions[0]?.titleSource).toBe('agent')
    const restored = restoreWorkspace(sanitizeWorkspaceFile(JSON.parse(JSON.stringify(file)), 0))
    expect(restored.sessions[0]).toMatchObject({ title: '会话自动标题', titleSource: 'agent' })
    // An unknown source in the file is dropped, not trusted.
    const tampered = JSON.parse(JSON.stringify(file)) as { sessions: Array<Record<string, unknown>> }
    tampered.sessions[0]!.titleSource = 'admin'
    expect(sanitizeWorkspaceFile(tampered, 0)?.sessions[0]).not.toHaveProperty('titleSource')
  })

  it('a conversation id replaced later (after /clear) is what gets saved', () => {
    const data = withSessions('codex')
    const replaced = { ...data, sessions: data.sessions.map((s) => ({ ...s, agentSessionId: 'second' })) }
    expect(serializeWorkspace(replaced, ui, {}).sessions[0]?.agentSessionId).toBe('second')
  })
})

describe('persistedStateChanged', () => {
  const ui = { sidebarCollapsed: false, sidebarWidth: 264, rightPanel: null, lastRightPanel: 'files' as const, rightPanelWidth: 480, diffLayout: 'unified' as const, collapsedProjectIds: [], recentProjects: [] as string[], newSessionWorkdir: {} }
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
    expect(persistedStateChanged({ ...base, sidebarWidth: 300 }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, rightPanel: 'git' }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, lastRightPanel: 'git' }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, rightPanelWidth: 500 }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, diffLayout: 'split' }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, collapsedProjectIds: ['p-1'] }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, recentProjects: ['/x'] }, base)).toBe(true)
    expect(persistedStateChanged({ ...base, newSessionWorkdir: { 'p-1': 'current' } }, base)).toBe(true)
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
  it('never replaces a title that has a source, even one equal to the default name', () => {
    expect(titleFromFirstPrompt({ ...fresh, titleSource: 'user' }, 'hello')).toBeNull()
    expect(titleFromFirstPrompt({ ...fresh, titleSource: 'agent' }, 'hello')).toBeNull()
  })
})

describe('titleFromAgent', () => {
  it('replaces the default name and the first-prompt placeholder', () => {
    expect(titleFromAgent({ kind: 'claude', title: 'Claude Code' }, 'AI×Web3 产品灵感')).toEqual({ title: 'AI×Web3 产品灵感', titleSource: 'agent' })
    expect(titleFromAgent({ kind: 'codex', title: '我现在想看看AI*web3 这个方向…', titleSource: 'prompt' }, '梳理会话标题思路')).toEqual({
      title: '梳理会话标题思路',
      titleSource: 'agent'
    })
  })
  it('follows a later rename made inside the agent', () => {
    expect(titleFromAgent({ kind: 'claude', title: '旧标题', titleSource: 'agent' }, '新标题')).toEqual({ title: '新标题', titleSource: 'agent' })
    expect(titleFromAgent({ kind: 'claude', title: '新标题', titleSource: 'agent' }, '新标题')).toBeNull()
  })
  it('upgrades a title saved before sources existed', () => {
    expect(titleFromAgent({ kind: 'claude', title: '我现在想看看AI*web3 这个方向' }, 'AI×Web3 产品灵感')).toEqual({ title: 'AI×Web3 产品灵感', titleSource: 'agent' })
  })
  it('never replaces a rename made in Wavi, and never names a shell', () => {
    expect(titleFromAgent({ kind: 'claude', title: '我的名字', titleSource: 'user' }, 'AI 标题')).toBeNull()
    expect(titleFromAgent({ kind: 'shell', title: '终端' }, 'AI 标题')).toBeNull()
  })
})
