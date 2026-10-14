// The hook bridge with Codex payloads: same registry and prompt flow as Claude, different decision JSON.
import { describe, expect, it } from 'vitest'
import type { AgentEventEnvelope, PendingPrompt, PromptResolution } from '@shared/agent-events'
import { HookBridge } from './bridge'
import { codexFixtures as fx } from './codex-fixtures'
import { decisionBody } from './permission-registry'
import type { HookRequest } from './server'

function setup() {
  const events: AgentEventEnvelope[] = []
  const prompts: PendingPrompt[] = []
  const resolutions: PromptResolution[] = []
  const bridge = new HookBridge(
    { event: (e) => events.push(e), prompt: (p) => prompts.push(p), resolved: (r) => resolutions.push(r), canDeliver: () => true },
    { now: () => 1000 }
  )
  bridge.attach('s1')
  const req = (event: string, payload: unknown): HookRequest => ({
    event,
    sessionId: 's1',
    agent: 'codex',
    payload,
    signal: new AbortController().signal
  })
  return { bridge, events, prompts, resolutions, req }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('HookBridge · codex', () => {
  it('stamps events with the codex agent', async () => {
    const { bridge, events, req } = setup()
    await bridge.handle(req('UserPromptSubmit', fx.UserPromptSubmit))
    expect(events).toEqual([{ sessionId: 's1', agent: 'codex', at: 1000, event: { type: 'prompt-submit', prompt: 'Reply with only the word OK.' } }])
  })

  it('holds a PermissionRequest and answers with a Codex-shaped decision (no interrupt / updatedPermissions)', async () => {
    const { bridge, prompts, req } = setup()
    let body: string | undefined
    void bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash)).then((b) => (body = b))
    await flush()
    expect(prompts[0]).toMatchObject({ kind: 'permission', tool: 'Bash', canAllowAlways: false })
    // "Allow always" cannot be requested for Codex; if a stale UI sends it anyway it degrades to allow-once.
    bridge.respondPermission(prompts[0]!.id, 'allow-always')
    await flush()
    expect(JSON.parse(body ?? '')).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
  })

  it('deny carries a message and nothing Codex would reject', async () => {
    const { bridge, prompts, req } = setup()
    let body = ''
    void bridge.handle(req('PermissionRequest', fx.PermissionRequest_apply_patch)).then((b) => (body = b))
    await flush()
    bridge.respondPermission(prompts[0]!.id, 'deny')
    await flush()
    const decision = JSON.parse(body).hookSpecificOutput.decision
    expect(decision.behavior).toBe('deny')
    expect(typeof decision.message).toBe('string')
    expect(Object.keys(decision).sort()).toEqual(['behavior', 'message'])
  })

  it('withdraws the prompt with an empty body when the tool call finishes (answered in the TUI after a timeout)', async () => {
    const { bridge, prompts, resolutions, req } = setup()
    const held = bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash))
    await bridge.handle(req('PostToolUse', fx.PostToolUse_Bash))
    expect(await held).toBe('')
    expect(resolutions).toEqual([{ id: prompts[0]!.id, sessionId: 's1', by: 'terminal' }])
  })

  it('the next prompt (or a Stop) clears whatever is still pending', async () => {
    const { bridge, resolutions, req } = setup()
    const held = bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash))
    await bridge.handle(req('Stop', fx.Stop))
    expect(await held).toBe('')
    expect(resolutions).toHaveLength(1)
  })

  it('request_user_input raises a question prompt and its PostToolUse withdraws it', async () => {
    const { bridge, prompts, resolutions, req } = setup()
    await bridge.handle(req('PreToolUse', fx.PreToolUse_request_user_input))
    expect(prompts[0]).toMatchObject({ kind: 'question', sessionId: 's1' })
    expect((prompts[0] as Extract<PendingPrompt, { kind: 'question' }>).questions).toHaveLength(2)
    await bridge.handle(req('PostToolUse', fx.PostToolUse_request_user_input))
    expect(resolutions).toEqual([{ id: prompts[0]!.id, sessionId: 's1', by: 'terminal' }])
  })
})

describe('decisionBody · codex', () => {
  it('allow and deny are the minimal shapes', () => {
    expect(JSON.parse(decisionBody('allow-once', [], 'codex'))).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
    expect(JSON.parse(decisionBody('deny', [], 'codex')).hookSpecificOutput.decision).not.toHaveProperty('interrupt')
  })

  it('never forwards suggestions, even if some were passed', () => {
    expect(decisionBody('allow-always', [{ type: 'addRules' }], 'codex')).not.toContain('updatedPermissions')
  })

  it('claude keeps its shape (interrupt on deny, updatedPermissions on allow-always)', () => {
    expect(JSON.parse(decisionBody('deny', [], 'claude')).hookSpecificOutput.decision).toHaveProperty('interrupt', false)
    expect(JSON.parse(decisionBody('allow-always', [{ type: 'addRules' }])).hookSpecificOutput.decision).toHaveProperty('updatedPermissions')
  })
})
