import { afterEach, describe, expect, it } from 'vitest'
import type { PhoneEvent, PhoneRequest, RemoteResult } from '../../../src/shared/remote'
import { newIdentity } from '../../../src/main/remote/crypto'
import { DeviceStore } from '../../../src/main/remote/devices'
import { RemoteServer, type RemoteConnection } from '../../../src/main/remote/server'
import { addressUrl, mergeUrls, PairError, pairWithCode, pairWithOffer, parseOffer, RemoteClient, type LinkState } from './client'
import { pairingLink } from '../../../src/shared/remote'

let server: RemoteServer | null = null
let client: RemoteClient | null = null
afterEach(async () => {
  client?.stop()
  client = null
  await server?.stop()
  server = null
})

async function setup(handle: (c: RemoteConnection, r: PhoneRequest) => Promise<RemoteResult> = async () => ({ ok: true, data: 'pong' })) {
  const devices = new DeviceStore({ load: () => [], save: () => undefined })
  const identity = newIdentity()
  let port = 0
  server = new RemoteServer({ identity, devices, name: () => 'Test Mac', urls: () => [`ws://127.0.0.1:${port}`], version: '1.2.3', handle })
  await server.start(0, '127.0.0.1')
  port = (server as unknown as { wss: { address(): { port: number } } }).wss.address().port
  const url = `ws://127.0.0.1:${port}`
  return { url, identity, devices, server }
}

function watch(c: { onState?: (s: LinkState) => void } = {}) {
  const states: LinkState[] = []
  const events: PhoneEvent[] = []
  const until = (match: () => boolean, ms = 8000) =>
    new Promise<void>((resolve, reject) => {
      const started = Date.now()
      const tick = () => (match() ? resolve() : Date.now() - started > ms ? reject(new Error('timed out')) : setTimeout(tick, 20))
      tick()
    })
  return { states, events, until, handlers: { onEvent: (e: PhoneEvent) => events.push(e), onState: (s: LinkState) => (states.push(s), c.onState?.(s)) } }
}

describe('pairing', () => {
  it('pairs from the QR link, and the code is used up', async () => {
    const { url, identity, devices, server } = await setup()
    const link = pairingLink({ v: 1, name: 'Test Mac', urls: ['ws://127.0.0.1:1', url], code: server.pairing()!.code, key: identity.publicKey })
    const offer = parseOffer(link)!
    const paired = await pairWithOffer(offer, 'Jacoy 的 iPhone')
    expect(paired).toMatchObject({ macName: 'Test Mac', urls: offer.urls })
    expect(devices.get(paired.device)?.name).toBe('Jacoy 的 iPhone')
    await expect(pairWithOffer(offer, 'again')).rejects.toThrow('配对码已失效')
  })

  it('pairs with a typed code through the PAKE, and counts wrong codes', async () => {
    const { url, devices, server } = await setup()
    const code = server.pairing()!.code
    const wrong = code === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA'
    await expect(pairWithCode(url, wrong, 'iPhone')).rejects.toThrow('配对码不对')
    const paired = await pairWithCode(url, `${code.slice(0, 3)}-${code.slice(3).toLowerCase()}`, 'iPhone')
    expect(devices.get(paired.device)).toBeDefined()
    expect(paired.urls).toEqual([url])
  })

  it('still pairs when the right code comes on the last try, and nobody gets another', async () => {
    const { url, devices, server } = await setup()
    const code = server.pairing()!.code
    const wrong = code === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA'
    for (let i = 0; i < 4; i++) await expect(pairWithCode(url, wrong, 'iPhone')).rejects.toThrow('配对码不对')
    const paired = await pairWithCode(url, code, 'iPhone')
    expect(devices.get(paired.device)).toBeDefined()
    await expect(pairWithCode(url, code, 'iPhone')).rejects.toThrow('配对码已失效')
  })

  it('says why it cannot connect, and rejects what is not a code', async () => {
    await expect(pairWithCode('ws://127.0.0.1:1', 'ABCDEF', 'iPhone')).rejects.toBeInstanceOf(PairError)
    await expect(pairWithCode('ws://127.0.0.1:1', 'AB', 'iPhone')).rejects.toThrow('6 位')
    expect(parseOffer('wavi://pair?d=e30')).toBeNull()
    expect(addressUrl('100.101.2.3', 7429)).toBe('ws://100.101.2.3:7429')
    expect(addressUrl('ws://192.168.1.5:8000/', 7429)).toBe('ws://192.168.1.5:8000')
    expect(addressUrl('a b', 7429)).toBeNull()
  })
})

describe('the link', () => {
  it('authenticates, gets hello with the current addresses, answers requests and receives events', async () => {
    const { url, server } = await setup(async (_c, r) => ({ ok: true, data: { echo: r.type } }))
    const paired = await pairWithCode(url, server.pairing()!.code, 'iPhone')
    const w = watch()
    client = new RemoteClient(paired, w.handlers)
    client.start()
    await w.until(() => w.states.some((s) => s.kind === 'open'))
    expect(w.events[0]).toEqual({ event: 'hello', data: { name: 'Test Mac', version: '1.2.3', urls: [url] } })
    expect(await client.request({ type: 'snapshot' })).toEqual({ ok: true, data: { echo: 'snapshot' } })
    server.broadcast({ event: 'prompts', data: [] })
    await w.until(() => w.events.some((e) => e.event === 'prompts'))
  })

  it('reconnects after the Mac goes away and comes back', async () => {
    const { url, server } = await setup()
    const paired = await pairWithCode(url, server.pairing()!.code, 'iPhone')
    const port = Number(new URL(url).port)
    const w = watch()
    client = new RemoteClient(paired, w.handlers)
    client.start()
    await w.until(() => w.states.at(-1)?.kind === 'open')
    await server.stop()
    await w.until(() => w.states.at(-1)?.kind === 'offline')
    expect(await client.request({ type: 'snapshot' })).toEqual({ ok: false, error: '没有连上 Mac' })
    await server.start(port, '127.0.0.1')
    await w.until(() => w.states.at(-1)?.kind === 'open', 12_000)
    expect((await client.request({ type: 'snapshot' })).ok).toBe(true)
  }, 20_000)

  it('says the Mac refuses it when revoked, and keeps the pairing for the user to decide', async () => {
    const { url, server } = await setup()
    const paired = await pairWithCode(url, server.pairing()!.code, 'iPhone')
    const w = watch()
    client = new RemoteClient(paired, w.handlers)
    client.start()
    await w.until(() => w.states.at(-1)?.kind === 'open')
    server.revoke(paired.device)
    await w.until(() => w.states.at(-1)?.kind === 'refused')
    const again = watch()
    client = new RemoteClient(paired, again.handlers)
    client.start()
    await again.until(() => again.states.at(-1)?.kind === 'refused')
  })

  it('tries the other addresses when one of them does not know the phone', async () => {
    const real = await setup()
    const paired = await pairWithCode(real.url, real.server.pairing()!.code, 'iPhone')
    // Another machine on an old address: a server without this device.
    const stranger = new RemoteServer({ identity: newIdentity(), devices: new DeviceStore({ load: () => [], save: () => undefined }), name: () => 'Other', version: '0', handle: async () => ({ ok: true }) })
    await stranger.start(0, '127.0.0.1')
    const strangerUrl = `ws://127.0.0.1:${(stranger as unknown as { wss: { address(): { port: number } } }).wss.address().port}`
    try {
      const w = watch()
      client = new RemoteClient({ ...paired, urls: [strangerUrl, real.url] }, w.handlers)
      client.start()
      await w.until(() => w.states.some((s) => s.kind === 'open' && s.url === real.url))
      expect(w.states.some((s) => s.kind === 'refused')).toBe(false)
    } finally {
      await stranger.stop()
    }
  })

  it('keeps known addresses when the Mac reports fewer', () => {
    expect(mergeUrls(['ws://192.168.1.9:7429'], 'ws://100.101.1.2:7429', ['ws://100.101.1.2:7429', 'ws://192.168.1.5:7429'])).toEqual([
      'ws://192.168.1.9:7429',
      'ws://100.101.1.2:7429',
      'ws://192.168.1.5:7429'
    ])
    expect(mergeUrls(['not a url', 42, 'ws://a b'], null, ['ws://x:1'])).toEqual(['ws://x:1'])
    expect(mergeUrls(Array.from({ length: 20 }, (_, i) => `ws://10.0.0.${i}:7429`), null, [])).toHaveLength(8)
  })
})
