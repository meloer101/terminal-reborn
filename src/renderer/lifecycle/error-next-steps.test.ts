import { describe, expect, it } from 'vitest'
import { errorNextSteps, fixPrompt } from './error-next-steps'

describe('errorNextSteps', () => {
  const claude = { kind: 'claude' as const }

  it('nothing for healthy sessions or shells', () => {
    expect(errorNextSteps({ ...claude, status: 'running', phase: 'ready' })).toBeNull()
    expect(errorNextSteps({ kind: 'shell', status: 'error' })).toBeNull()
  })

  it('a crash offers a fix and resuming the conversation', () => {
    expect(errorNextSteps({ ...claude, status: 'error', phase: 'exited', currentAction: '进程异常退出，退出码 1' })).toEqual({
      summary: '进程异常退出，退出码 1',
      canFix: true,
      retry: 'resume'
    })
  })

  it('a failed turn of a live agent offers a fix and continuing', () => {
    expect(errorNextSteps({ ...claude, status: 'error', phase: 'ready', currentAction: 'API 额度已用完' })).toEqual({
      summary: 'API 额度已用完',
      canFix: true,
      retry: 'continue'
    })
  })

  it('a plan limit says when it resets and offers no fix (the agent cannot raise it)', () => {
    const session = { ...claude, status: 'error' as const, phase: 'ready' as const, currentAction: "You've hit your session limit · resets 5:22pm" }
    expect(errorNextSteps(session, undefined, 'Claude 额度用完 · 17:22 恢复')).toEqual({
      summary: 'Claude 额度用完 · 17:22 恢复',
      canFix: false,
      retry: 'continue'
    })
    // An agent that crashed meanwhile still offers resuming it.
    expect(errorNextSteps({ ...session, phase: 'exited' }, undefined, 'Claude 额度用完 · 17:22 恢复')?.retry).toBe('resume')
  })

  it('launch problems explain themselves; the agent cannot fix them', () => {
    expect(errorNextSteps({ ...claude, status: 'exited', phase: 'exited' }, { kind: 'missing-cli' })).toEqual({
      summary: '没有找到 Claude Code 命令，安装后重试',
      canFix: false,
      retry: 'start'
    })
    expect(errorNextSteps({ ...claude, status: 'exited', phase: 'exited' }, { kind: 'cwd-missing', path: '/gone' })).toMatchObject({
      canFix: false,
      retry: null
    })
  })
})

describe('fixPrompt', () => {
  it('is one line that carries the error', () => {
    const prompt = fixPrompt('pnpm build 失败')
    expect(prompt).toContain('pnpm build 失败')
    expect(prompt).not.toContain('\n')
  })
})
