import { describe, expect, it } from 'vitest'
import { AUTO_START_ON_VIEW, agentSessionIdPatch, hasStartChoice, planStart, shouldAutoStart } from './session-start-plan'

const restored = { kind: 'claude' as const, phase: 'not-started' as const, agentSessionId: 'conv-1' }

describe('planStart', () => {
  it('resume keeps the saved conversation id and passes it to the spawn', () => {
    expect(planStart(restored, { resume: true })).toEqual({
      resumeAgentSessionId: 'conv-1',
      patch: { phase: 'starting', status: 'idle', agentSessionId: 'conv-1' }
    })
  })

  it('a new conversation spawns without an id and forgets the old one', () => {
    expect(planStart(restored, { resume: false })).toEqual({
      resumeAgentSessionId: undefined,
      patch: { phase: 'starting', status: 'idle', agentSessionId: undefined }
    })
  })

  it('resume without a saved conversation just starts fresh', () => {
    expect(planStart({}, { resume: true }).resumeAgentSessionId).toBeUndefined()
  })
})

describe('hasStartChoice / shouldAutoStart', () => {
  it('offers a choice only for a restored agent session that has a conversation', () => {
    expect(hasStartChoice(restored)).toBe(true)
    expect(hasStartChoice({ ...restored, agentSessionId: undefined })).toBe(false)
    expect(hasStartChoice({ ...restored, phase: 'ready' })).toBe(false)
    expect(hasStartChoice({ ...restored, kind: 'shell' })).toBe(false)
  })

  it('resumes a restored conversation by itself when the session is viewed', () => {
    expect(AUTO_START_ON_VIEW).toBe(true)
    expect(shouldAutoStart(restored)).toBe(true)
    expect(shouldAutoStart(restored, false)).toBe(false)
  })

  it('still starts by itself when there is nothing to choose, or when auto-start is on', () => {
    expect(shouldAutoStart({ ...restored, agentSessionId: undefined })).toBe(true)
    expect(shouldAutoStart(restored, true)).toBe(true)
  })

  it('never auto-starts a running, shell or missing session', () => {
    expect(shouldAutoStart({ ...restored, phase: 'starting' })).toBe(false)
    expect(shouldAutoStart({ ...restored, phase: undefined })).toBe(false)
    expect(shouldAutoStart({ ...restored, kind: 'shell' })).toBe(false)
    expect(shouldAutoStart(undefined)).toBe(false)
  })
})

describe('agentSessionIdPatch', () => {
  it('takes the conversation id from SessionStart', () => {
    expect(agentSessionIdPatch({ type: 'session-start', agentSessionId: 'conv-2' })).toEqual({ agentSessionId: 'conv-2' })
  })

  it('ignores other events and SessionStart without an id', () => {
    expect(agentSessionIdPatch({ type: 'session-start' })).toBeNull()
    expect(agentSessionIdPatch({ type: 'stop' })).toBeNull()
    expect(agentSessionIdPatch({ type: 'session-end', reason: 'clear' })).toBeNull()
  })
})
