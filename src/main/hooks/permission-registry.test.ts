import { describe, expect, it } from 'vitest'
import type { PromptResolution } from '@shared/agent-events'
import { decisionBody, PERMISSION_TIMEOUT_MS, PermissionRegistry, type PermissionPrompt, type Scheduler } from './permission-registry'

class FakeScheduler implements Scheduler {
  private nextId = 1
  readonly timers = new Map<number, { fn: () => void; at: number }>()
  now = 0
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++
    this.timers.set(id, { fn, at: this.now + ms })
    return id
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }
  advance(ms: number): void {
    this.now += ms
    for (const [id, t] of [...this.timers]) {
      if (t.at <= this.now) {
        this.timers.delete(id)
        t.fn()
      }
    }
  }
}

const suggestion = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }

function setup() {
  const scheduler = new FakeScheduler()
  const resolutions: PromptResolution[] = []
  const registry = new PermissionRegistry((r) => resolutions.push(r), scheduler)
  const released = new Map<string, string>()
  const hold = (id: string, sessionId = 's1', tool = 'Bash', input: Record<string, unknown> = { command: id }, suggestions: unknown[] = []) => {
    const prompt: PermissionPrompt = {
      kind: 'permission',
      id,
      sessionId,
      tool,
      input,
      summary: `运行 ${id}`,
      canAllowAlways: suggestions.length > 0,
      createdAt: 0
    }
    registry.add({ prompt, suggestions, release: (body) => released.set(id, body) })
  }
  return { scheduler, resolutions, registry, released, hold }
}

describe('decisionBody', () => {
  const parse = (body: string) => JSON.parse(body).hookSpecificOutput as { hookEventName: string; decision: Record<string, unknown> }

  it('allow-once -> plain allow', () => {
    expect(parse(decisionBody('allow-once', [suggestion]))).toEqual({ hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } })
  })

  it('allow-always hands the offered suggestions back as updatedPermissions', () => {
    expect(parse(decisionBody('allow-always', [suggestion])).decision).toEqual({ behavior: 'allow', updatedPermissions: [suggestion] })
  })

  it('allow-always without suggestions degrades to a plain allow', () => {
    expect(parse(decisionBody('allow-always', [])).decision).toEqual({ behavior: 'allow' })
  })

  it('deny carries a reason and does not interrupt the agent', () => {
    expect(parse(decisionBody('deny', [])).decision).toMatchObject({ behavior: 'deny', interrupt: false })
    expect(String(parse(decisionBody('deny', [])).decision.message)).not.toBe('')
  })
})

describe('PermissionRegistry', () => {
  it('releases the hold with the decision and resolves by gui', () => {
    const { registry, released, resolutions, hold, scheduler } = setup()
    hold('p1', 's1', 'Bash', {}, [suggestion])
    expect(registry.respond('p1', 'allow-always')).toBe(true)
    expect(JSON.parse(released.get('p1') ?? '').hookSpecificOutput.decision.behavior).toBe('allow')
    expect(resolutions).toEqual([{ id: 'p1', sessionId: 's1', by: 'gui' }])
    expect(registry.size).toBe(0)
    expect(scheduler.timers.size).toBe(0)
  })

  it('ignores unknown ids and answers after resolution', () => {
    const { registry, hold, resolutions } = setup()
    expect(registry.respond('nope', 'deny')).toBe(false)
    hold('p1')
    registry.respond('p1', 'deny')
    expect(registry.respond('p1', 'allow-once')).toBe(false)
    expect(resolutions).toHaveLength(1)
  })

  it('times out after 120 s with an empty body so the TUI prompt takes over', () => {
    const { scheduler, released, resolutions, hold, registry } = setup()
    hold('p1')
    scheduler.advance(PERMISSION_TIMEOUT_MS - 1)
    expect(released.has('p1')).toBe(false)
    scheduler.advance(1)
    expect(released.get('p1')).toBe('')
    expect(resolutions).toEqual([{ id: 'p1', sessionId: 's1', by: 'timeout' }])
    expect(registry.respond('p1', 'allow-once')).toBe(false)
  })

  it('a newer request in the same session supersedes the older one, other sessions are untouched', () => {
    const { released, resolutions, hold, registry } = setup()
    hold('old', 's1')
    hold('other', 's2')
    hold('new', 's1')
    expect(released.get('old')).toBe('')
    expect(resolutions).toEqual([{ id: 'old', sessionId: 's1', by: 'terminal' }])
    expect(registry.has('new')).toBe(true)
    expect(registry.has('other')).toBe(true)
  })

  it('the session ending releases its holds with session-ended', () => {
    const { registry, released, resolutions, hold } = setup()
    hold('a', 's1')
    hold('b', 's2')
    registry.resolveSession('s1', 'session-ended')
    expect(released.get('a')).toBe('')
    expect(released.has('b')).toBe(false)
    expect(resolutions).toEqual([{ id: 'a', sessionId: 's1', by: 'session-ended' }])
  })

  it('a tool-end only releases the hold for that exact tool call', () => {
    const { registry, resolutions, hold } = setup()
    hold('rm', 's1', 'Bash', { command: 'rm -rf x', description: 'd' })
    registry.resolveSession('s1', 'terminal', { name: 'Bash', input: { description: 'd', command: 'ls' } })
    expect(registry.has('rm')).toBe(true)
    // key order does not matter
    registry.resolveSession('s1', 'terminal', { name: 'Bash', input: { description: 'd', command: 'rm -rf x' } })
    expect(registry.has('rm')).toBe(false)
    expect(resolutions).toEqual([{ id: 'rm', sessionId: 's1', by: 'terminal' }])
  })

  it('cancel (hook connection dropped) resolves once', () => {
    const { registry, resolutions, hold, released } = setup()
    hold('p1')
    registry.cancel('p1', 'terminal')
    registry.cancel('p1', 'terminal')
    expect(released.get('p1')).toBe('')
    expect(resolutions).toHaveLength(1)
  })
})
