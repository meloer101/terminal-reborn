import { describe, expect, it } from 'vitest'
import { RpcClient, type Rec } from './driver'

describe('RpcClient', () => {
  it('a new client (a reattach) never takes the earlier client’s pending ids for its own', async () => {
    const sent: Rec[] = []
    const write = (message: Rec) => sent.push(message) > 0
    const before = new RpcClient(write, true)
    void before.request('session/prompt', {})
    const prompt = sent.at(-1)!
    // The app restarts: a fresh client over the same process, which still owes the earlier prompt's answer.
    const after = new RpcClient(write, true)
    const config = after.request('session/set_config_option', {})
    const ownId = sent.at(-1)!.id
    expect(ownId).not.toBe(prompt.id)
    expect(after.handle({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } })).toBe(false)
    expect(after.handle({ jsonrpc: '2.0', id: ownId, result: {} })).toBe(true)
    expect(await config).toEqual({ ok: true, result: {} })
  })

  it('ids are numbers that count up from the first one', () => {
    const sent: Rec[] = []
    const client = new RpcClient((m) => sent.push(m) > 0, false, 7)
    void client.request('a', {})
    void client.request('b', {})
    expect(sent.map((m) => m.id)).toEqual([7, 8])
  })
})
