import { describe, expect, it } from 'vitest'
import type { DispatchRequest } from '@shared/dispatch'
import { DispatchBroker } from './broker'

function setup(owners: Record<string, string>, answerMs = 200) {
  const sent: Array<{ owner: string; request: DispatchRequest }> = []
  const broker = new DispatchBroker<string>({ ownerOf: (id) => owners[id] ?? null, send: (owner, request) => sent.push({ owner, request }), answerMs })
  return { broker, sent }
}

describe('DispatchBroker', () => {
  it('relays a call to the window that owns the session and returns its answer', async () => {
    const { broker, sent } = setup({ s1: 'win-a' })
    const result = broker.call({ sessionId: 's1', command: { name: 'ls' } })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ owner: 'win-a', request: { sessionId: 's1', command: { name: 'ls' } } })
    broker.answer('win-a', sent[0]!.request.callId, { ok: true, text: 'none' })
    expect(await result).toEqual({ ok: true, text: 'none' })
  })

  it('ignores an answer from another window and times out instead of hanging', async () => {
    const { broker, sent } = setup({ s1: 'win-a' }, 50)
    const result = broker.call({ sessionId: 's1', command: { name: 'ls' } })
    broker.answer('win-b', sent[0]!.request.callId, { ok: true, text: 'not mine' })
    expect(await result).toMatchObject({ ok: false, failure: 'wavi_unavailable' })
  })

  it('says Wavi is unavailable when no window has the session, and reads a broken answer as a failure', async () => {
    const { broker, sent } = setup({ s1: 'win-a' })
    expect(await broker.call({ sessionId: 'nobody', command: { name: 'ls' } })).toMatchObject({ ok: false, failure: 'wavi_unavailable' })
    const result = broker.call({ sessionId: 's1', command: { name: 'ls' } })
    broker.answer('win-a', sent[0]!.request.callId, { ok: 'yes' })
    expect(await result).toMatchObject({ ok: false, failure: 'failed' })
  })

  it('keeps the Claude inbox a call or the SessionStart hook reported', () => {
    const { broker } = setup({ s1: 'win-a' })
    void broker.call({ sessionId: 's1', command: { name: 'ls' }, inbox: { socket: '/tmp/cc-socks/1.sock', token: 't' } })
    expect(broker.inboxOf('s1')).toEqual({ socket: '/tmp/cc-socks/1.sock', token: 't' })
    broker.setInbox('s2', { socket: '/tmp/cc-socks/2.sock', token: 'u' })
    expect(broker.inboxOf('s2')?.socket).toBe('/tmp/cc-socks/2.sock')
  })
})
