import { describe, expect, it } from 'vitest'
import type { Project, Session, Worktree } from '@shared/types'
import { EMPTY_TEXTS, fail, startState, toGlance } from '../pull-requests/ship-flow'
import { agentModels, remoteSessions, remoteShip } from './model'

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

describe('remoteShip', () => {
  const input = { kind: 'main' as const, agent: 'Claude Code', base: 'main', branch: 'jacob/x', remote: 'origin', review: false, uncommitted: true }

  it('shows a run on the session row with its glance worked out, and how the last one ended', () => {
    const glance = toGlance(startState(input, '合并到 main 并推送'), { ...EMPTY_TEXTS, commit: 'feat: refresh\n\nBody' })
    const list = remoteSessions(
      { projects: [project], worktrees: [tree], sessions: [session({ id: 's1' })] },
      { ships: { '/wt/refresh': glance }, endings: {} }
    )
    expect(list.sessions[0]!.ship).toMatchObject({ kind: 'main', stage: 'glance', fields: ['commit'], submitLabel: '合并并推送', submitBlocker: null, texts: { commit: 'feat: refresh\n\nBody' } })
    const ended = remoteSessions({ projects: [project], worktrees: [tree], sessions: [session({ id: 's1' })] }, { ships: {}, endings: { '/wt/refresh': '已合并到 main 并推送 · a41c9e2' } })
    expect(ended.sessions[0]!.shipNotice).toBe('已合并到 main 并推送 · a41c9e2')
  })

  it('carries each session\'s 会话设置 when it has any (Figma 64B)', () => {
    const settings = { items: [{ kind: 'model' as const, current: 'opus', values: [{ value: 'opus', label: 'Opus 5.5' }] }] }
    const list = remoteSessions({ projects: [project], worktrees: [tree], sessions: [session({ id: 'a' }), session({ id: 'b' })] }, undefined, (s) => (s.id === 'a' ? settings : undefined))
    expect(list.sessions.map((s) => s.settings)).toEqual([settings, undefined])
  })

  it('cuts long text to what main accepts and keeps local folders out of messages', () => {
    const empty = toGlance(startState(input, '合并到 main 并推送'), EMPTY_TEXTS)
    const failed = fail(empty, { step: 'merge', message: 'x'.repeat(3000), output: 'error in /wt/refresh/src/a.ts and /code/acme' })
    const ship = remoteShip(failed, ['/wt/refresh', '/code/acme'])
    expect(ship.error!.message).toHaveLength(2000)
    expect(ship.error!.output).toBe('error in ./src/a.ts and acme')
  })

  it('says what blocks the glance and what a failed step offers', () => {
    const empty = toGlance(startState(input, '合并到 main 并推送'), EMPTY_TEXTS)
    expect(remoteShip(empty).submitBlocker).toBe('写一句提交说明')
    const conflict = fail(empty, { step: 'merge', message: '合并有冲突', conflicts: ['a.ts'] })
    expect(remoteShip(conflict).error).toEqual({ step: 'merge', message: '合并有冲突', conflicts: true, pushRefused: false })
  })
})


describe('agentModels (新建会话 · 模型, Figma 67A)', () => {
  const opus = { value: 'opus', label: 'Opus 5.5' }
  const haiku = { value: 'haiku', label: 'Haiku 5.5' }

  it('lists what a session of the agent listed before, starting from its last pick', () => {
    expect(agentModels(true, { models: [opus, haiku], model: 'haiku' }, { models: [opus], current: 'opus' })).toEqual({ gui: true, models: [opus, haiku], current: 'haiku' })
  })

  it('falls back to what main asked the agent, and to its default when it names none it lists', () => {
    expect(agentModels(true, undefined, { models: [opus, haiku], current: 'opus' })).toEqual({ gui: true, models: [opus, haiku], current: 'opus' })
    expect(agentModels(true, { model: 'gone' }, { models: [opus] })).toEqual({ gui: true, models: [opus] })
  })

  it('has no row for a session that will run in a terminal, and only 默认 for an agent that lists none', () => {
    expect(agentModels(false, { models: [opus], model: 'opus' }, undefined)).toEqual({ gui: false, models: [] })
    expect(agentModels(true, undefined, undefined)).toEqual({ gui: true, models: [] })
  })
})
