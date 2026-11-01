// A stand-in for the phone app (PRD F22), for unit tests and e2e: pairs with a code, authenticates, sends requests
// and collects events — the same handshake and frames the real app speaks (./crypto.ts). Not part of the app.
import WebSocket from 'ws'
import { authProof, b64u, FrameCipher, fromB64u, newIdentity, open, pairingKey, randomToken, seal, sessionKeys } from './crypto'
import type { PhoneCommand, PhoneEvent, PhoneResponse } from '@shared/remote'

export interface PairedDevice {
  device: string
  secret: string
  name: string
}

function once(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.once('close', (code, reason) => reject(new Error(`closed ${code} ${reason.toString()}`)))
  })
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

/** Pairs as a phone named `name`; rejects with the server's reason when the code is wrong. */
export async function pairPhone(url: string, macKey: string, code: string, name = 'Test iPhone'): Promise<PairedDevice> {
  const me = newIdentity()
  const key = pairingKey(me.privateKey, macKey, code)
  if (!key) throw new Error('bad mac key')
  const socket = await connect(url)
  try {
    socket.send(JSON.stringify({ t: 'pair', key: me.publicKey, box: b64u(seal(key, 0, Buffer.from(JSON.stringify({ name })))) }))
    const reply = await once(socket)
    if (reply.t !== 'paired') throw new Error(String(reply.error ?? 'not paired'))
    const body = open(key, 1, fromB64u(reply.box) ?? Buffer.alloc(0))
    if (!body) throw new Error('could not open the reply')
    return JSON.parse(body.toString()) as PairedDevice
  } finally {
    socket.close()
  }
}

export class TestPhone {
  readonly events: PhoneEvent[] = []
  private nextId = 1
  private readonly waiting = new Map<number, (response: PhoneResponse) => void>()
  private readonly listeners = new Set<() => void>()

  private constructor(
    readonly socket: WebSocket,
    readonly cipher: FrameCipher
  ) {
    socket.on('message', (data) => {
      const message = cipher.open(data as Buffer) as (PhoneEvent | PhoneResponse) | null
      if (!message) return
      if ('re' in message) {
        this.waiting.get(message.re)?.(message)
        this.waiting.delete(message.re)
      } else {
        this.events.push(message)
        for (const listener of this.listeners) listener()
      }
    })
  }

  static async connect(url: string, paired: PairedDevice): Promise<TestPhone> {
    const socket = await connect(url)
    socket.send(JSON.stringify({ t: 'hello', device: paired.device }))
    const challenge = await once(socket)
    const serverNonce = fromB64u(challenge.nonce, 16)
    if (!serverNonce) throw new Error(String(challenge.error ?? 'no challenge'))
    const clientNonce = randomToken(16)
    const secret = fromB64u(paired.secret, 32)!
    const keys = sessionKeys(secret, serverNonce, clientNonce)
    const phone = new TestPhone(socket, new FrameCipher(keys.fromPhone, keys.toPhone))
    const hello = phone.next((e) => e.event === 'hello')
    const refused = new Promise<never>((_, reject) => socket.once('close', (code, reason) => reject(new Error(`closed ${code} ${reason.toString()}`))))
    socket.send(JSON.stringify({ t: 'auth', nonce: b64u(clientNonce), proof: b64u(authProof(secret, serverNonce, clientNonce)) }))
    await Promise.race([hello, refused])
    return phone
  }

  request(command: PhoneCommand, timeoutMs = 10_000): Promise<PhoneResponse> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${command.type}`)), timeoutMs)
      this.waiting.set(id, (response) => {
        clearTimeout(timer)
        resolve(response)
      })
      this.socket.send(this.cipher.seal({ id, ...command }))
    })
  }

  /** Resolves with the first event (already received or coming) that matches. */
  next(match: (event: PhoneEvent) => boolean, timeoutMs = 10_000): Promise<PhoneEvent> {
    const found = this.events.find(match)
    if (found) return Promise.resolve(found)
    return new Promise((resolve, reject) => {
      const check = () => {
        const event = this.events.find(match)
        if (!event) return
        cleanup()
        resolve(event)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('no such event'))
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        this.listeners.delete(check)
      }
      this.listeners.add(check)
    })
  }

  close(): void {
    this.socket.close()
  }
}
