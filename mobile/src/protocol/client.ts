// The phone's connection to Wavi (PRD F22): pairing (a scanned QR code, or a typed code through the PAKE), then one
// authenticated, encrypted WebSocket that reconnects by itself. The Mac's side is src/main/remote/server.ts; the
// handshake is described in src/main/remote/crypto.ts. Platform-free: the WebSocket class is passed in (React Native's
// own in the app, Node's in client.test.ts).
import { normalizePairingCode, type PairingOffer, type PhoneCommand, type PhoneEvent, type RemoteResult } from '../../../src/shared/remote'
import { authProof, b64u, FrameCipher, fromB64u, fromUtf8, newKeyPair, open, pairingKey, pakeStart, randomBytes, seal, sessionKeys, utf8 } from './crypto'

export interface Pairing {
  device: string
  /** base64url of the 32-byte device secret (kept in the Keychain). */
  secret: string
  /** The Mac's name. */
  macName: string
  /** Where to reach it, Tailscale first. */
  urls: string[]
}

/**
 * `refused`: every address answered that it does not know this phone (revoked on the Mac, or another machine now has
 * that address). The refusal is not authenticated, so the pairing is kept and retried; the user decides to pair anew.
 */
export type LinkState = { kind: 'connecting' } | { kind: 'open'; url: string } | { kind: 'offline' } | { kind: 'refused' }

type SocketClass = typeof WebSocket

/** A failure the pairing screen shows as it is. */
export class PairError extends Error {}

const OPEN_MS = 6_000
const MAX_URLS = 8
const URL_SHAPE = /^wss?:\/\/[^\s/]+$/
const REPLY_MS = 10_000
const REQUEST_MS = 20_000
const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

function openSocket(url: string, Impl: SocketClass): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket
    try {
      socket = new Impl(url)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    socket.binaryType = 'arraybuffer'
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('timeout'))
    }, OPEN_MS)
    socket.onopen = () => {
      clearTimeout(timer)
      resolve(socket)
    }
    socket.onerror = () => {
      clearTimeout(timer)
      reject(new Error('could not connect'))
    }
  })
}

/** Every address at once; the first to open wins and the others are closed. */
async function firstOpen(urls: readonly string[], Impl: SocketClass): Promise<{ socket: WebSocket; url: string }> {
  if (urls.length === 0) throw new Error('no address')
  const attempts = urls.map((url) => openSocket(url, Impl).then((socket) => ({ socket, url })))
  // Promise.any by hand (not every Hermes has it): the first that opens, or a failure once all failed.
  const winner = await new Promise<{ socket: WebSocket; url: string }>((resolve, reject) => {
    let failed = 0
    for (const attempt of attempts) attempt.then(resolve, () => ++failed === attempts.length && reject(new Error('could not connect')))
  })
  for (const attempt of attempts) void attempt.then((a) => a.socket !== winner.socket && a.socket.close(), () => undefined)
  return winner
}

/** The next plaintext handshake message; rejects when the socket closes first. */
function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no answer')), REPLY_MS)
    socket.onmessage = (event) => {
      clearTimeout(timer)
      try {
        const value: unknown = JSON.parse(typeof event.data === 'string' ? event.data : '')
        resolve(typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {})
      } catch {
        resolve({})
      }
    }
    socket.onclose = (event) => {
      clearTimeout(timer)
      reject(new Error(`closed ${event.code}`))
    }
  })
}

const PAIR_ERRORS: Record<string, string> = {
  'no pairing code': '配对码已失效，在 Mac 上点「换一个」',
  'wrong code': '配对码不对'
}

/** `wavi://pair?d=…` (the QR code on 设置 · 手机) → the offer; null when it is not one. */
export function parseOffer(link: string): PairingOffer | null {
  const match = /^wavi:\/\/pair\?d=([A-Za-z0-9_-]+)$/.exec(link.trim())
  const bytes = match ? fromB64u(match[1]) : null
  if (!bytes) return null
  try {
    const o = JSON.parse(fromUtf8(bytes)) as Record<string, unknown>
    const code = normalizePairingCode(o.code)
    const urls = Array.isArray(o.urls) ? mergeUrls(o.urls, null, []) : []
    if (o.v !== 1 || !code || typeof o.key !== 'string' || !fromB64u(o.key, 32) || urls.length === 0) return null
    return { v: 1, name: typeof o.name === 'string' ? o.name.slice(0, 80) : 'Mac', urls, code, key: o.key }
  } catch {
    return null
  }
}

/** What someone typed as the Mac's address (`100.101.1.2`, `192.168.1.5:7429`, `ws://…`) → a URL; null when it is none. */
export function addressUrl(raw: string, defaultPort: number): string | null {
  const text = raw.trim().replace(/^wss?:\/\//, '').replace(/\/$/, '')
  const match = /^([A-Za-z0-9.-]+)(?::(\d{2,5}))?$/.exec(text)
  if (!match) return null
  const port = match[2] ? Number(match[2]) : defaultPort
  return port >= 1 && port <= 65535 ? `ws://${match[1]}:${port}` : null
}

/**
 * Where to reach the Mac after it reported its addresses: those, the one in use now and the ones already known, without
 * duplicates. Nothing is dropped for being absent from the report (a Tailscale that is down for a moment, an address the
 * user typed that the Mac does not list).
 */
export function mergeUrls(reported: readonly unknown[], current: string | null, known: readonly string[]): string[] {
  const all = [...reported, current, ...known].filter((u): u is string => typeof u === 'string' && URL_SHAPE.test(u))
  return [...new Set(all)].slice(0, MAX_URLS)
}

async function pairOn(socket: WebSocket, macKey: string, code: string, phoneName: string, urls: string[]): Promise<Pairing> {
  const me = newKeyPair()
  const key = pairingKey(me.secretKey, macKey, code)
  if (!key) throw new PairError('二维码不对')
  socket.send(JSON.stringify({ t: 'pair', key: me.publicKey, box: b64u(seal(key, 0, utf8(JSON.stringify({ name: phoneName })))) }))
  const reply = await nextMessage(socket)
  if (reply.t !== 'paired') throw new PairError(PAIR_ERRORS[String(reply.error)] ?? '配对没有成功')
  const body = open(key, 1, fromB64u(reply.box) ?? new Uint8Array())
  const paired = body ? (JSON.parse(fromUtf8(body)) as Record<string, unknown>) : null
  if (!paired || typeof paired.device !== 'string' || !fromB64u(paired.secret, 32)) throw new PairError('配对没有成功')
  return { device: paired.device, secret: paired.secret as string, macName: typeof paired.name === 'string' ? paired.name : 'Mac', urls }
}

async function connectFor<T>(urls: readonly string[], Impl: SocketClass, run: (socket: WebSocket, url: string) => Promise<T>): Promise<T> {
  let opened: { socket: WebSocket; url: string }
  try {
    opened = await firstOpen(urls, Impl)
  } catch {
    throw new PairError('连不上这台 Mac：Mac 上的 Wavi 要开着，手机和 Mac 在同一个 Wi-Fi 或 Tailscale 里')
  }
  try {
    return await run(opened.socket, opened.url)
  } catch (error) {
    if (error instanceof PairError) throw error
    throw new PairError('配对没有成功')
  } finally {
    opened.socket.close()
  }
}

export function pairWithOffer(offer: PairingOffer, phoneName: string, Impl: SocketClass = WebSocket): Promise<Pairing> {
  return connectFor(offer.urls, Impl, (socket) => pairOn(socket, offer.key, offer.code, phoneName, offer.urls))
}

/** 输入配对码: the PAKE brings the Mac's public key, then the phone pairs as after a scan. */
export function pairWithCode(url: string, rawCode: string, phoneName: string, Impl: SocketClass = WebSocket): Promise<Pairing> {
  const code = normalizePairingCode(rawCode)
  if (!code) return Promise.reject(new PairError('配对码是 6 位字母和数字'))
  return connectFor([url], Impl, async (socket) => {
    const pake = pakeStart(code)
    socket.send(JSON.stringify({ t: 'pake', a: pake.a }))
    const reply = await nextMessage(socket)
    if (reply.t !== 'pake') throw new PairError(PAIR_ERRORS[String(reply.error)] ?? '配对没有成功')
    const macKey = pake.finish(reply.b, reply.box)
    if (!macKey) throw new PairError('配对码不对')
    return pairOn(socket, macKey, code, phoneName, [url])
  })
}

const bytesOf = (data: unknown): Uint8Array | null => (data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null)
const sendable = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

export interface ClientHandlers {
  onEvent(event: PhoneEvent): void
  onState(state: LinkState): void
}

/** The paired phone's link to its Mac: connects, authenticates, reconnects after drops, answers requests. */
export class RemoteClient {
  private socket: WebSocket | null = null
  private cipher: FrameCipher | null = null
  private url = ''
  private nextId = 1
  private readonly waiting = new Map<number, { resolve: (result: RemoteResult) => void; timer: ReturnType<typeof setTimeout> }>()
  private stopped = true
  private connecting = false
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /** Addresses that said they do not know this phone since the last open link: tried last. */
  private readonly refusedBy = new Set<string>()
  /** The last state said was `refused`: slow retries do not flash 连接中 in between. */
  private saidRefused = false

  constructor(
    private pairing: Pairing,
    private readonly handlers: ClientHandlers,
    private readonly Impl: SocketClass = WebSocket
  ) {}

  get open(): boolean {
    return this.cipher !== null
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.drop()
  }

  /** The Mac reported where it can be reached now; returns the merged list (to keep). */
  setUrls(reported: readonly unknown[]): string[] {
    const urls = mergeUrls(reported, this.url || null, this.pairing.urls)
    this.pairing = { ...this.pairing, urls }
    return urls
  }

  /** The app came back to the foreground: reconnect now, or check that the open socket still works. */
  wake(): void {
    if (this.stopped) return
    if (!this.open) {
      if (this.retryTimer) clearTimeout(this.retryTimer)
      this.retryTimer = null
      this.retries = 0
      void this.connect()
      return
    }
    void this.request({ type: 'snapshot' }, 5_000).then((result) => {
      if (!result.ok && result.error === '超时') this.socket?.close()
    })
  }

  request(command: PhoneCommand, timeoutMs = REQUEST_MS): Promise<RemoteResult> {
    const socket = this.socket
    const cipher = this.cipher
    if (!socket || !cipher || socket.readyState !== socket.OPEN) return Promise.resolve({ ok: false, error: '没有连上 Mac' })
    const id = this.nextId++
    // Sealing photos takes a while in JS: the time allowed for the answer starts once the frame is on its way.
    const frame = sendable(cipher.seal({ id, ...command }))
    return new Promise((resolve) => {
      try {
        socket.send(frame)
      } catch {
        resolve({ ok: false, error: '和 Mac 的连接断了' })
        return
      }
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        resolve({ ok: false, error: '超时' })
      }, timeoutMs)
      this.waiting.set(id, { resolve, timer })
    })
  }

  private drop(): void {
    const socket = this.socket
    this.socket = null
    this.cipher = null
    if (socket) {
      socket.onclose = null
      socket.onmessage = null
      socket.close()
    }
    for (const { resolve, timer } of this.waiting.values()) {
      clearTimeout(timer)
      resolve({ ok: false, error: '和 Mac 的连接断了' })
    }
    this.waiting.clear()
  }

  private schedule(): void {
    if (this.stopped || this.retryTimer) return
    const delay = RETRY_MS[Math.min(this.retries, RETRY_MS.length - 1)]!
    this.retries++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, delay)
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || this.open) return
    this.connecting = true
    if (!this.saidRefused) this.handlers.onState({ kind: 'connecting' })
    let socket: WebSocket | null = null
    const untried = this.pairing.urls.filter((u) => !this.refusedBy.has(u))
    if (untried.length === 0) {
      // Every address refused this phone: say so, and keep trying slowly from the top (the refusal is not authenticated).
      this.connecting = false
      this.refusedBy.clear()
      this.retries = RETRY_MS.length
      this.saidRefused = true
      this.handlers.onState({ kind: 'refused' })
      this.schedule()
      return
    }
    let tried = ''
    try {
      const opened = await firstOpen(untried, this.Impl)
      tried = opened.url
      socket = opened.socket
      if (this.stopped) {
        socket.close()
        return
      }
      socket.send(JSON.stringify({ t: 'hello', device: this.pairing.device }))
      const challenge = await nextMessage(socket)
      const serverNonce = fromB64u(challenge.nonce, 16)
      if (!serverNonce) throw new Refused(String(challenge.error ?? ''))
      const secret = fromB64u(this.pairing.secret, 32)!
      const clientNonce = randomBytes(16)
      const keys = sessionKeys(secret, serverNonce, clientNonce)
      const cipher = new FrameCipher(keys.fromPhone, keys.toPhone)
      const hello = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no hello')), REPLY_MS)
        socket!.onmessage = (event) => {
          if (typeof event.data === 'string') {
            clearTimeout(timer)
            const refusal = (() => {
              try {
                return String((JSON.parse(event.data) as { error?: unknown }).error ?? '')
              } catch {
                return ''
              }
            })()
            reject(new Refused(refusal))
            return
          }
          const frame = bytesOf(event.data)
          const message = frame ? (cipher.open(frame) as PhoneEvent | null) : null
          if (message?.event !== 'hello') return
          clearTimeout(timer)
          this.handlers.onEvent(message)
          resolve()
        }
        socket!.onclose = (event) => {
          clearTimeout(timer)
          reject(event.code === 4001 || event.code === 4003 ? new Refused('unknown device') : new Error(`closed ${event.code}`))
        }
      })
      socket.send(JSON.stringify({ t: 'auth', nonce: b64u(clientNonce), proof: b64u(authProof(secret, serverNonce, clientNonce)) }))
      await hello
      this.socket = socket
      this.cipher = cipher
      this.url = opened.url
      this.retries = 0
      this.refusedBy.clear()
      this.saidRefused = false
      socket.onmessage = (event) => this.receive(event.data)
      socket.onclose = (event) => {
        if (this.socket !== socket) return
        this.drop()
        if (event.code === 4001 || event.code === 4003) return this.refused(opened.url)
        this.handlers.onState({ kind: 'offline' })
        this.schedule()
      }
      this.handlers.onState({ kind: 'open', url: this.url })
    } catch (error) {
      if (socket && this.socket !== socket) socket.close()
      if (error instanceof Refused && (error.message === 'unknown device' || error.message === 'bad proof' || error.message === 'revoked')) return this.refused(tried)
      if (!this.saidRefused) this.handlers.onState({ kind: 'offline' })
      this.schedule()
    } finally {
      this.connecting = false
    }
  }

  /** `url` said it does not know this phone: try the other addresses at once (another machine may hold that one). */
  private refused(url: string): void {
    this.refusedBy.add(url)
    // After the current attempt has finished (connect() is not re-entrant).
    setTimeout(() => void this.connect(), 0)
  }

  private receive(data: unknown): void {
    const frame = bytesOf(data)
    const message = frame && this.cipher ? (this.cipher.open(frame) as (PhoneEvent | ({ re: number } & RemoteResult)) | null) : null
    if (!message) {
      // A frame that does not open means the link is broken; start over.
      this.socket?.close()
      return
    }
    if ('re' in message) {
      const waiter = this.waiting.get(message.re)
      if (!waiter) return
      this.waiting.delete(message.re)
      clearTimeout(waiter.timer)
      const { re: _re, ...result } = message
      void _re
      waiter.resolve(result as RemoteResult)
      return
    }
    this.handlers.onEvent(message)
  }
}

class Refused extends Error {}
