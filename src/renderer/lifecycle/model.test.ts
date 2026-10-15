import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { cardModel } from './model'
import { glyphStatus, inputBlockedByPhase, cardReplacesComposer, phaseLabel, phaseLine } from './present'
import { issueFromSpawnError } from './launch-issues'

const session = (patch: Partial<Session> = {}): Session => ({
  id: 's',
  worktreeId: 'w',
  kind: 'claude',
  title: 'Cookie 会话迁移',
  status: 'idle',
  startedAt: 0,
  lastActivityAt: 0,
  ...patch
})

describe('cardModel', () => {
  it('not started with a saved conversation: choose between resuming and starting over', () => {
    const card = cardModel({ session: session({ phase: 'not-started', agentSessionId: 'abc' }) })
    expect(card).toMatchObject({ kind: 'not-started', title: '上次的对话还没有恢复', glyph: 'idle' })
    expect(card?.detail).toBe('将用 claude --resume 接上「Cookie 会话迁移」的原对话')
    expect(card?.actions.map((a) => [a.id, a.primary ?? false])).toEqual([['fresh', false], ['resume', true]])
    expect(cardModel({ session: session({ phase: 'not-started', agentSessionId: 'abc', kind: 'codex' }) })?.detail).toContain('codex resume')
  })

  it('not started without a conversation has no card: it starts by itself', () => {
    expect(cardModel({ session: session({ phase: 'not-started' }) })).toBeNull()
  })

  it('blocked says what to do in the terminal', () => {
    const card = cardModel({ session: session({ phase: 'blocked', status: 'needs_you' }), dialog: 'claude-trust' })
    expect(card).toMatchObject({ kind: 'blocked', glyph: 'needs_you', title: 'Claude Code 在等你确认是否信任此文件夹' })
    expect(card?.detail).toBe('在终端里按 ↓ 再按 ↵ 选择 “Yes, I trust this folder”')
    expect(card?.actions).toEqual([{ id: 'focus', label: '聚焦终端' }])
    expect(cardModel({ session: session({ phase: 'blocked', kind: 'codex' }), dialog: 'codex-update' })?.title).toBe('Codex 在提示有新版本')
    expect(cardModel({ session: session({ phase: 'blocked' }), dialog: null })?.title).toBe('终端里有一个提示在等你回答')
  })

  it('exited offers restart, and resume only when there is a conversation to resume', () => {
    const plain = cardModel({ session: session({ phase: 'exited', status: 'exited' }) })
    expect(plain).toMatchObject({ kind: 'exited', title: 'Claude Code 已退出', detail: '终端里现在是普通 shell' })
    expect(plain?.actions.map((a) => a.id)).toEqual(['restart'])
    const withId = cardModel({ session: session({ phase: 'exited', status: 'exited', agentSessionId: 'abc' }) })
    expect(withId?.actions.map((a) => [a.id, a.primary ?? false])).toEqual([['resume', false], ['restart', true]])
  })

  it('an agent that exited with an error code says so', () => {
    const card = cardModel({ session: session({ phase: 'exited', status: 'error' }), issue: { kind: 'agent-exit', code: 1 } })
    expect(card).toMatchObject({ glyph: 'error', detail: '退出码 1 · 终端里现在是普通 shell' })
  })

  it('a missing CLI shows an install hint, a missing directory its path', () => {
    const missing = cardModel({ session: session({ phase: 'exited', status: 'exited' }), issue: { kind: 'missing-cli' } })
    expect(missing).toMatchObject({ glyph: 'error', title: '没有找到 claude 命令' })
    expect(missing?.detail).toContain('npm install -g @anthropic-ai/claude-code')
    expect(cardModel({ session: session({ kind: 'codex', phase: 'exited' }), issue: { kind: 'missing-cli' } })?.detail).toContain('@openai/codex')
    expect(cardModel({ session: session({ phase: 'exited' }), issue: { kind: 'cwd-missing', path: '/gone' } })).toMatchObject({
      title: '项目目录不存在'
    })
  })

  it('has no card for starting, ready, shell or untracked sessions', () => {
    expect(cardModel({ session: session({ phase: 'starting' }) })).toBeNull()
    expect(cardModel({ session: session({ phase: 'ready' }) })).toBeNull()
    expect(cardModel({ session: session() })).toBeNull()
    expect(cardModel({ session: session({ kind: 'shell', phase: 'exited' }) })).toBeNull()
  })
})

describe('presentation', () => {
  it('a starting agent shows the spinner glyph', () => {
    expect(glyphStatus(session({ phase: 'starting' }))).toBe('running')
    expect(glyphStatus(session({ phase: 'ready', status: 'needs_you' }))).toBe('needs_you')
  })

  it('sidebar lines per phase', () => {
    expect(phaseLine(session({ phase: 'starting' }))).toBe('正在启动 Claude Code…')
    expect(phaseLine(session({ phase: 'starting', kind: 'codex' }))).toBe('正在启动 Codex…')
    expect(phaseLine(session({ phase: 'not-started', agentSessionId: 'a' }))).toBe('未启动 · 点击恢复上次对话')
    expect(phaseLine(session({ phase: 'not-started' }))).toBe('未启动')
    expect(phaseLine(session({ phase: 'exited', status: 'exited' }))).toBe('Claude Code 已退出')
    expect(phaseLine(session({ phase: 'exited', status: 'error' }))).toBeUndefined()
    expect(phaseLine(session({ phase: 'ready' }))).toBeUndefined()
    expect(phaseLine(session())).toBeUndefined()
  })

  it('header label', () => {
    expect(phaseLabel(session({ phase: 'starting' }), '空闲')).toBe('启动中')
    expect(phaseLabel(session({ phase: 'ready' }), '空闲')).toBe('空闲')
  })

  it('the composer is off unless the agent is ready (or not tracked)', () => {
    expect(inputBlockedByPhase(undefined)).toBe(false)
    expect(inputBlockedByPhase(session())).toBe(false)
    expect(inputBlockedByPhase(session({ phase: 'ready' }))).toBe(false)
    for (const phase of ['not-started', 'starting', 'blocked', 'exited'] as const) expect(inputBlockedByPhase(session({ phase }))).toBe(true)
  })

  it('cards replace the composer for blocked, exited and a not-started session with a choice', () => {
    expect(cardReplacesComposer(session({ phase: 'blocked' }))).toBe(true)
    expect(cardReplacesComposer(session({ phase: 'exited' }))).toBe(true)
    expect(cardReplacesComposer(session({ phase: 'not-started', agentSessionId: 'a' }))).toBe(true)
    expect(cardReplacesComposer(session({ phase: 'not-started' }))).toBe(false)
    expect(cardReplacesComposer(session({ phase: 'starting' }))).toBe(false)
  })
})

describe('issueFromSpawnError', () => {
  it('reads the coded message through Electron\'s wrapping', () => {
    const wrapped = new Error("Error invoking remote method 'pty:spawn': Error: TR_CWD_MISSING:/Users/me/gone")
    expect(issueFromSpawnError(wrapped)).toEqual({ kind: 'cwd-missing', path: '/Users/me/gone' })
  })

  it('anything else is a spawn failure with its message', () => {
    expect(issueFromSpawnError(new Error('boom'))).toEqual({ kind: 'spawn-failed', message: 'boom' })
    expect(issueFromSpawnError('x')).toEqual({ kind: 'spawn-failed', message: 'x' })
  })
})
