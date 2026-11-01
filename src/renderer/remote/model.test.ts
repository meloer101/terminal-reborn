import { describe, expect, it } from 'vitest'
import type { Project, Session, Worktree } from '@shared/types'
import { remoteSessions } from './model'

const project: Project = { id: 'p1', name: 'acme-web', rootPath: '/code/acme' }
const main: Worktree = { id: 'w0', projectId: 'p1', branch: 'main', path: '/code/acme', isMain: true }
const tree: Worktree = { id: 'w1', projectId: 'p1', branch: 'jacob/refresh', path: '/wt/refresh', isMain: false, baseBranch: 'main' }
const gone: Worktree = { ...tree, id: 'w2', path: '/wt/old', archived: { at: 1 } as Worktree['archived'] }
const session = (o: Partial<Session>): Session => ({ id: 's', worktreeId: 'w1', kind: 'claude', title: 't', status: 'idle', startedAt: 0, lastActivityAt: 5, ...o })

describe('remoteSessions', () => {
  it('lists agent sessions with what the phone row shows, and keeps folders and roots for main', () => {
    const list = remoteSessions({
      projects: [project],
      worktrees: [main, tree, gone],
      sessions: [
        session({ id: 's1', title: '会话过期自动续期', status: 'running', currentAction: '编辑 src/a.ts', statusSince: 3, agentSessionId: 'abc-1', dispatchModel: 'Opus 5.5' }),
        session({ id: 's2', worktreeId: 'w0', kind: 'shell' }),
        session({ id: 's3', worktreeId: 'w2' }),
        session({ id: 's4', worktreeId: 'w0', kind: 'codex', lastReply: 'DONE' })
      ]
    })
    expect(list.projects).toEqual([{ id: 'p1', name: 'acme-web' }])
    expect(list.sessions).toEqual([
      { id: 's1', projectId: 'p1', title: '会话过期自动续期', agent: 'claude', status: 'running', activity: 5, action: '编辑 src/a.ts', since: 3, branch: 'jacob/refresh', model: 'Opus 5.5' },
      { id: 's4', projectId: 'p1', title: 't', agent: 'codex', status: 'idle', activity: 5, branch: 'main', reply: 'DONE' }
    ])
    expect(list.folders).toEqual({ s1: { cwd: '/wt/refresh', base: 'main', agentSession: 'abc-1' }, s4: { cwd: '/code/acme' } })
    expect(list.roots).toEqual({ p1: '/code/acme' })
  })
})
