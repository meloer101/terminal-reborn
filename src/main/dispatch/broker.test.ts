import { describe, expect, it } from 'vitest'
import type { DispatchRequest } from '@shared/dispatch'
import { DispatchBroker } from './broker'

function setup(owner: string | null = 'win') {
  const sent: DispatchRequest[] = []
  const broker = new DispatchBroker<string>({ ownerOf: () => owner, send: (_o, r) => sent.push(r), holdMs: 30 })
  return { broker, sent }
}

describe('DispatchBroker', () => {
  it('answers a quick call within the same request', async () => {
    const { broker, sent } = setup()
    const pending = broker.handle('WaviCall', 's1', 'claude', { tool: 'list_sessions', args: {} })
    await Promise.resolve()
    expect(sent[0]).toMatchObject({ sessionId: 's1', agent: 'claude', tool: 'list_sessions' })
    broker.answer('win', sent[0]!.callId, { ok: true, text: 'none' })
    expect(JSON.parse(await pending)).toEqual({ done: true, result: { ok: true, text: 'none' } })
  })

  it('says "not yet" for a call that waits for the user, and hands the answer to the poll', async () => {
    const { broker, sent } = setup()
    const first = JSON.parse(await broker.handle('WaviCall', 's1', 'codex', { tool: 'start_sessions', args: {} })) as { done: boolean; callId: string }
    expect(first).toEqual({ done: false, callId: sent[0]!.callId })
    broker.answer('win', first.callId, { ok: false, failure: 'declined', text: 'no' })
    expect(JSON.parse(await broker.handle('WaviPoll', 's1', 'codex', { callId: first.callId }))).toEqual({ done: true, result: { ok: false, failure: 'declined', text: 'no' } })
    // Collected once.
    expect(JSON.parse(await broker.handle('WaviPoll', 's1', 'codex', { callId: first.callId }))).toMatchObject({ done: true, result: { failure: 'failed' } })
  })

  it('passes the calling session’s cancel to the window and forgets the call; nobody else can cancel it', async () => {
    const { broker, sent } = setup()
    const first = JSON.parse(await broker.handle('WaviCall', 's1', 'claude', { tool: 'start_sessions', args: {} })) as { callId: string }
    expect(await broker.handle('WaviCancel', 's2', 'claude', { callId: first.callId })).toBe('')
    expect(sent).toHaveLength(1)
    expect(await broker.handle('WaviCancel', 's1', 'claude', { callId: first.callId })).toBe('')
    expect(sent[1]).toEqual({ callId: first.callId, sessionId: 's1', agent: 'claude', tool: 'cancel', args: {} })
    // The window's late answer lands nowhere; the call is gone.
    broker.answer('win', first.callId, { ok: false, failure: 'declined', text: 'no' })
    expect(JSON.parse(await broker.handle('WaviPoll', 's1', 'claude', { callId: first.callId }))).toMatchObject({ result: { failure: 'failed' } })
  })

  it('lets only the asked window answer and only the calling session collect', async () => {
    const { broker, sent } = setup()
    const first = JSON.parse(await broker.handle('WaviCall', 's1', 'claude', { tool: 'start_sessions' })) as { callId: string }
    broker.answer('other-window', sent[0]!.callId, { ok: true, text: 'forged' })
    expect(JSON.parse(await broker.handle('WaviPoll', 's2', 'claude', { callId: first.callId }))).toMatchObject({ result: { failure: 'failed' } })
    expect(JSON.parse(await broker.handle('WaviPoll', 's1', 'claude', { callId: first.callId }))).toEqual({ done: false, callId: first.callId })
  })

  it('answers nothing when no window owns the session, and refuses unknown tools', async () => {
    expect(await setup(null).broker.handle('WaviCall', 's1', 'claude', { tool: 'list_sessions' })).toBe('')
    expect(JSON.parse(await setup().broker.handle('WaviCall', 's1', 'claude', { tool: 'rm_rf' }))).toMatchObject({ result: { failure: 'invalid_request' } })
  })

  it('records the Claude inbox from hello and returns the window\'s answer', async () => {
    const { broker, sent } = setup()
    const pending = broker.handle('WaviHello', 's1', 'claude', { inbox: { socket: '/tmp/cc-socks/1.sock', token: 'abc' } })
    await Promise.resolve()
    broker.answer('win', sent[0]!.callId, { tools: true, agents: ['claude', 'codex', 'nope'] })
    expect(JSON.parse(await pending)).toEqual({ tools: true, agents: ['claude', 'codex'] })
    expect(broker.inboxOf('s1')).toEqual({ socket: '/tmp/cc-socks/1.sock', token: 'abc' })
    void broker.handle('WaviHello', 's2', 'claude', { inbox: { socket: 'relative.sock', token: 'abc' } })
    expect(broker.inboxOf('s2')).toBeUndefined()
  })
})
