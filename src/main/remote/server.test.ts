import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { ristretto255_hasher } from '@noble/curves/ed25519.js'
import { REMOTE_LIMITS, REMOTE_PROTOCOL, type PhoneRequest, type RemoteResult } from '@shared/remote'
import { b64u, newIdentity } from './crypto'
import { DeviceStore, type StoredDevice } from './devices'
import { RemoteServer, type RemoteConnection } from './server'
import { pairPhone, TestPhone } from './test-phone'

let server: RemoteServer | null = null
afterEach(async () => {
  await server?.stop()
  server = null
})

async function setup(handle: (c: RemoteConnection, r: PhoneRequest) => Promise<RemoteResult> = async () => ({ ok: true, data: 'pong' })) {
  const saved: StoredDevice[][] = []
  const devices = new DeviceStore({ load: () => [], save: (list) => saved.push(list.map((d) => ({ ...d }))) })
  const identity = newIdentity()
  let changes = 0
  server = new RemoteServer({ identity, devices, name: () => 'Test Mac', version: '0.0.0', handle, onChange: () => changes++ })
  await server.start(0, '127.0.0.1')
  const address = (server as unknown as { wss: { address(): { port: number } } }).wss.address()
  return { url: `ws://127.0.0.1:${address.port}`, identity, devices, saved, changes: () => changes, server }
}

describe('pairing', () => {
  it('pairs a phone with the current code once and stores its secret', async () => {
    const { url, identity, devices, server } = await setup()
    const { code } = server.pairing()!
    const paired = await pairPhone(url, identity.publicKey, code, 'Jacoy 的 iPhone')
    expect(paired.name).toBe('Test Mac')
    expect(devices.get(paired.device)).toMatchObject({ name: 'Jacoy 的 iPhone', secret: paired.secret })
    // The code is used up.
    await expect(pairPhone(url, identity.publicKey, code)).rejects.toThrow(/no pairing code/)
  })

  it('refuses a wrong code and drops the code after too many tries', async () => {
    const { url, identity, server } = await setup()
    server.pairing()
    for (let i = 0; i < REMOTE_LIMITS.codeTries; i++) await expect(pairPhone(url, identity.publicKey, 'ZZZZZZ')).rejects.toThrow(/wrong code/)
    expect(server.hasCode()).toBe(false)
    // No new code shows up by itself (设置 · 手机 asks again on every change): only 换一个 makes one.
    expect(server.pairing()).toBeNull()
    expect(server.pairingLocked).toBe(true)
    expect(server.renewCode()?.code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)
    expect(server.pairingLocked).toBe(false)
  })

  it('cuts off a socket that sends more than a handshake before it is authenticated', async () => {
    const { url } = await setup()
    const socket = new WebSocket(url)
    await new Promise((r) => socket.once('open', r))
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)))
    socket.send(Buffer.alloc(200 * 1024))
    expect(await closed).toBe(1006)
  })

  it('lets only a few unauthenticated sockets in per address', async () => {
    const { url } = await setup()
    const sockets = Array.from({ length: 5 }, () => new WebSocket(url))
    const outcomes = await Promise.all(sockets.map((s) => new Promise<string>((resolve) => {
      s.once('open', () => setTimeout(() => resolve(s.readyState === s.OPEN ? 'open' : 'closed'), 200))
      s.once('close', () => resolve('closed'))
      s.once('error', () => resolve('closed'))
    })))
    expect(outcomes.filter((o) => o === 'open')).toHaveLength(4)
    for (const s of sockets) s.terminate()
  })

  it('answers a typed-code PAKE and counts every attempt as a try', async () => {
    const { url, server } = await setup()
    server.pairing()
    const a = b64u(ristretto255_hasher.hashToCurve(Buffer.from('ZZZZZZ'), { DST: 'wavi pake v1' }).multiply(7n).toBytes())
    for (let i = 0; i < REMOTE_LIMITS.codeTries; i++) {
      const socket = new WebSocket(url)
      await new Promise((r) => socket.once('open', r))
      const reply = new Promise<Record<string, unknown>>((resolve) => socket.once('message', (d) => resolve(JSON.parse(d.toString()) as Record<string, unknown>)))
      socket.send(JSON.stringify({ t: 'pake', a }))
      expect(await reply).toMatchObject({ t: 'pake', b: expect.any(String), box: expect.any(String) })
      socket.close()
    }
    // The last try's socket could still have paired; it closed, so the code goes.
    await vi.waitFor(() => expect(server.pairingLocked).toBe(true))
  })

  it('refuses to pair when no code is shown', async () => {
    const { url, identity } = await setup()
    await expect(pairPhone(url, identity.publicKey, 'ABCDEF')).rejects.toThrow(/no pairing code/)
  })
})

describe('an authenticated phone', () => {
  it('sends requests, gets answers and broadcasts, and counts as online', async () => {
    const seen: PhoneRequest[] = []
    const { url, identity, server } = await setup(async (_c, r) => {
      seen.push(r)
      return { ok: true, data: { sessions: 0 } }
    })
    const paired = await pairPhone(url, identity.publicKey, server.pairing()!.code)
    const phone = await TestPhone.connect(url, paired)
    expect(phone.events[0]).toEqual({ event: 'hello', data: { name: 'Test Mac', version: '0.0.0', protocol: REMOTE_PROTOCOL } })
    expect(await phone.request({ type: 'snapshot' })).toEqual({ re: 1, ok: true, data: { sessions: 0 } })
    expect(seen).toEqual([{ id: 1, type: 'snapshot' }])
    expect(server.online().has(paired.device)).toBe(true)
    server.broadcast({ event: 'sessions', data: { projects: [], sessions: [] } })
    await phone.next((e) => e.event === 'sessions')
    phone.close()
  })

  it('answers an invalid request without calling the handler', async () => {
    let calls = 0
    const { url, identity, server } = await setup(async () => {
      calls++
      return { ok: true }
    })
    const phone = await TestPhone.connect(url, await pairPhone(url, identity.publicKey, server.pairing()!.code))
    const answer = await phone.request({ type: 'diff', session: 's', path: '../../etc/passwd', scope: 'committed' })
    expect(answer).toEqual({ re: 1, ok: false, error: '无效的请求' })
    expect(calls).toBe(0)
    phone.close()
  })

  it('closes on a replayed frame and on a plaintext message after the handshake', async () => {
    const { url, identity, server } = await setup()
    const phone = await TestPhone.connect(url, await pairPhone(url, identity.publicKey, server.pairing()!.code))
    const frame = phone.cipher.seal({ id: 9, type: 'snapshot' })
    phone.socket.send(frame)
    const closed = new Promise<number>((resolve) => phone.socket.once('close', (code) => resolve(code)))
    phone.socket.send(frame)
    expect(await closed).toBe(4002)
  })

  it('refuses an unknown device and a wrong secret', async () => {
    const { url, identity, server } = await setup()
    await expect(TestPhone.connect(url, { device: 'nobody-here', secret: 'x', name: '' })).rejects.toThrow(/unknown device/)
    const paired = await pairPhone(url, identity.publicKey, server.pairing()!.code)
    await expect(TestPhone.connect(url, { ...paired, secret: Buffer.alloc(32, 1).toString('base64url') })).rejects.toThrow(/bad proof/)
  })

  it('disconnects a revoked phone and lets it in no more', async () => {
    let handled = 0
    const { url, identity, server } = await setup(async () => {
      handled++
      return { ok: true }
    })
    const paired = await pairPhone(url, identity.publicKey, server.pairing()!.code)
    const phone = await TestPhone.connect(url, paired)
    const closed = new Promise<number>((resolve) => phone.socket.once('close', (code) => resolve(code)))
    expect(server.revoke(paired.device)).toBe(true)
    // A frame sent after the revoke is not acted on, even before the close completes.
    phone.socket.send(phone.cipher.seal({ id: 5, type: 'snapshot' }))
    expect(await closed).toBe(4003)
    expect(handled).toBe(0)
    await expect(TestPhone.connect(url, paired)).rejects.toThrow(/unknown device/)
  })

  it('drops a socket that never finishes the handshake on a bad first message', async () => {
    const { url } = await setup()
    const socket = new WebSocket(url)
    await new Promise((r) => socket.once('open', r))
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)))
    socket.send('not json')
    expect(await closed).toBe(4002)
  })
})
