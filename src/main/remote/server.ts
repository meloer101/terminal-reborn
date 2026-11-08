// The phone server (PRD F22): a WebSocket listener for paired phones. Before a phone is authenticated it may only pair
// (with the current one-time code) or answer a challenge with its device secret (./crypto.ts has the handshake); after
// that every frame is encrypted and counted, and carries one request or one answer / event. Electron-free: index.ts
// supplies what the requests do.
import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { PAIRING_ALPHABET, PAIRING_CODE_LENGTH, parsePhoneRequest, REMOTE_LIMITS, REMOTE_PROTOCOL, type PhoneEvent, type PhoneRequest, type PhoneResponse, type RemoteResult } from '@shared/remote'
import { authProof, b64u, FrameCipher, fromB64u, open, pairingKey, pakeReply, proofMatches, seal, sessionKeys, type Identity } from './crypto'
import type { DeviceStore } from './devices'

export interface RemoteConnection {
  /** One per socket. */
  readonly id: string
  readonly deviceId: string
  send(message: PhoneEvent | PhoneResponse): void
}

export interface RemoteServerOptions {
  identity: Identity
  devices: DeviceStore
  /** The Mac's name the phone shows. */
  name: () => string
  /** Where the phone can reach this Mac now: `hello` brings it, so a phone keeps up with a changed LAN address. */
  urls?: () => string[]
  version: string
  handle: (connection: RemoteConnection, request: PhoneRequest) => Promise<RemoteResult>
  onOpen?: (connection: RemoteConnection) => void
  onClose?: (connection: RemoteConnection) => void
  /** Devices, who is online or the pairing code changed (设置 · 手机 redraws). */
  onChange?: () => void
  now?: () => number
}

/** A socket must pair or authenticate within this. */
const HANDSHAKE_MS = 15_000
/** Plaintext handshake messages are small. */
const HANDSHAKE_BYTES = 8 * 1024
/**
 * What a socket may send before it is authenticated, counted on the TCP socket itself: the WebSocket layer would
 * otherwise buffer a whole message (up to frameBytes) before anything could look at it.
 */
const HANDSHAKE_WIRE_BYTES = 64 * 1024
const MAX_UNAUTHENTICATED = 16
const MAX_UNAUTHENTICATED_PER_ADDRESS = 4
const PING_MS = 25_000
/** A socket asked to close that does not answer is cut off after this. */
const CLOSE_GRACE_MS = 1_000

export interface PairingCode {
  code: string
  expiresAt: number
}

type Stage = { kind: 'new' } | { kind: 'challenged'; deviceId: string; nonce: Buffer } | { kind: 'open'; cipher: FrameCipher; connection: RemoteConnection }

function newCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH)
  return [...bytes].map((b) => PAIRING_ALPHABET[b % PAIRING_ALPHABET.length]).join('')
}

function json(data: RawData, isBinary: boolean): Record<string, unknown> | null {
  if (isBinary) return null
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data).toString('utf8')
  if (text.length > HANDSHAKE_BYTES) return null
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The phone's name in an opened pairing box; null when the box is not what a phone sends. */
function nameIn(opened: Buffer): string | null {
  try {
    const body: unknown = JSON.parse(opened.toString('utf8'))
    const name = typeof body === 'object' && body !== null ? (body as { name?: unknown }).name : undefined
    return typeof name === 'string' ? name : null
  } catch {
    return null
  }
}

const bytesOf = (data: RawData): Buffer => (Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data))

export class RemoteServer {
  private wss: WebSocketServer | null = null
  private code: (PairingCode & { tries: number }) | null = null
  /** Too many wrong codes: no new one until the user asks for it (换一个). */
  private locked = false
  /**
   * The socket whose PAKE used the code's last try: it may still pair with it (its code may have been right); the code
   * goes once it has, or tried something else, or closed. Nobody else may use the code meanwhile.
   */
  private lastTryBy: WebSocket | null = null
  private readonly sockets = new Map<string, { socket: WebSocket; connection: RemoteConnection; end: (code: number, reason: string) => void }>()
  private unauthenticated = 0
  private readonly pendingByAddress = new Map<string, number>()
  private pinger: NodeJS.Timeout | null = null

  constructor(private readonly options: RemoteServerOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  get listening(): boolean {
    return this.wss !== null
  }

  start(port: number, host = '0.0.0.0'): Promise<void> {
    if (this.wss) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port, host, maxPayload: REMOTE_LIMITS.frameBytes, perMessageDeflate: false })
      const fail = (error: Error) => {
        wss.close()
        reject(error)
      }
      wss.once('error', fail)
      wss.once('listening', () => {
        wss.off('error', fail)
        wss.on('error', (error) => console.error('[remote] server error:', error))
        this.wss = wss
        wss.on('connection', (socket, request) => this.accept(socket, request))
        this.pinger = setInterval(() => this.ping(), PING_MS)
        this.pinger.unref()
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    const wss = this.wss
    this.wss = null
    if (this.pinger) clearInterval(this.pinger)
    this.pinger = null
    if (!wss) return
    for (const client of wss.clients) client.terminate()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    this.sockets.clear()
    this.options.onChange?.()
  }

  /** The code 设置 · 手机 shows; a new one when there is none or it expired; null after too many wrong codes. */
  pairing(): PairingCode | null {
    if (this.locked) return null
    if (!this.code || this.code.expiresAt <= this.now()) this.code = { code: newCode(), expiresAt: this.now() + REMOTE_LIMITS.codeMs, tries: 0 }
    return { code: this.code.code, expiresAt: this.code.expiresAt }
  }

  /** 换一个: also after too many wrong codes. */
  renewCode(): PairingCode | null {
    this.code = null
    this.locked = false
    this.lastTryBy = null
    const code = this.pairing()
    this.options.onChange?.()
    return code
  }

  /** 设置 · 手机 closed: nothing can pair until it is opened again. */
  clearCode(): void {
    this.code = null
    this.lastTryBy = null
  }

  hasCode(): boolean {
    return this.code !== null && this.code.expiresAt > this.now()
  }

  /** Too many wrong codes were tried; 换一个 makes a new one. */
  get pairingLocked(): boolean {
    return this.locked
  }

  online(): Set<string> {
    return new Set([...this.sockets.values()].map((o) => o.connection.deviceId))
  }

  connections(): RemoteConnection[] {
    return [...this.sockets.values()].map((o) => o.connection)
  }

  broadcast(event: PhoneEvent): void {
    for (const { connection } of this.sockets.values()) connection.send(event)
  }

  /** Forgets a phone and closes its sockets at once: nothing it sends after this is acted on. */
  revoke(deviceId: string): boolean {
    const removed = this.options.devices.remove(deviceId)
    this.disconnect(deviceId)
    if (removed) this.options.onChange?.()
    return removed
  }

  private disconnect(deviceId: string): void {
    for (const { connection, end } of [...this.sockets.values()]) if (connection.deviceId === deviceId) end(4003, 'revoked')
  }

  private ping(): void {
    for (const client of this.wss?.clients ?? []) {
      const tagged = client as WebSocket & { alive?: boolean }
      if (tagged.alive === false) {
        client.terminate()
        continue
      }
      tagged.alive = false
      client.ping()
    }
  }

  private accept(socket: WebSocket, request: IncomingMessage): void {
    const address = request.socket.remoteAddress ?? ''
    const pending = this.pendingByAddress.get(address) ?? 0
    if (this.unauthenticated >= MAX_UNAUTHENTICATED || pending >= MAX_UNAUTHENTICATED_PER_ADDRESS) {
      socket.terminate()
      return
    }
    this.unauthenticated++
    this.pendingByAddress.set(address, pending + 1)
    let counted = true
    const uncount = () => {
      if (!counted) return
      counted = false
      this.unauthenticated--
      const left = (this.pendingByAddress.get(address) ?? 1) - 1
      if (left > 0) this.pendingByAddress.set(address, left)
      else this.pendingByAddress.delete(address)
      request.socket.off('data', countWire)
    }
    let wire = 0
    const countWire = (chunk: Buffer) => {
      wire += chunk.length
      if (wire > HANDSHAKE_WIRE_BYTES) socket.terminate()
    }
    request.socket.on('data', countWire)
    const tagged = socket as WebSocket & { alive?: boolean }
    tagged.alive = true
    socket.on('pong', () => (tagged.alive = true))
    let stage: Stage = { kind: 'new' }
    /** Set once the socket is being closed: what still arrives is dropped. */
    let ended = false
    const end = (code: number, reason: string) => {
      if (ended) return
      ended = true
      socket.close(code, reason)
      setTimeout(() => socket.terminate(), CLOSE_GRACE_MS).unref()
    }
    const timer = setTimeout(() => {
      ended = true
      socket.terminate()
    }, HANDSHAKE_MS)
    timer.unref()
    const plain = (value: unknown) => socket.send(JSON.stringify(value))
    const refuse = (code: number, reason: string) => {
      if (ended) return
      plain({ t: 'error', error: reason })
      end(code, reason)
    }

    socket.on('close', () => {
      clearTimeout(timer)
      uncount()
      if (this.lastTryBy === socket) this.lock()
      if (stage.kind === 'open') {
        this.sockets.delete(stage.connection.id)
        this.options.onClose?.(stage.connection)
        this.options.onChange?.()
      }
    })

    socket.on('message', (data, isBinary) => {
      if (ended) return
      if (stage.kind === 'open') {
        const current = stage
        // Revoked, or pushed out by newer phones: it may not act any more.
        if (!this.options.devices.get(current.connection.deviceId)) return end(4003, 'revoked')
        const request = isBinary ? current.cipher.open(bytesOf(data)) : null
        if (request === null) return end(4002, 'bad frame')
        const parsed = parsePhoneRequest(request)
        if (!parsed) {
          const id = typeof (request as { id?: unknown }).id === 'number' ? (request as { id: number }).id : -1
          current.connection.send({ re: id, ok: false, error: '无效的请求' })
          return
        }
        void this.options
          .handle(current.connection, parsed)
          .catch((error: unknown): RemoteResult => {
            console.error('[remote] request failed:', error)
            return { ok: false, error: '处理请求时出错' }
          })
          .then((result) => current.connection.send({ re: parsed.id, ...result }))
        return
      }
      const message = json(data, isBinary)
      if (!message) return refuse(4002, 'bad message')

      if (this.lastTryBy === socket && message.t !== 'pair') this.lock()
      if (stage.kind === 'new' && message.t === 'pake') return this.pake(socket, message, plain, refuse)
      if (stage.kind === 'new' && message.t === 'pair') return this.pair(socket, message, plain, refuse)
      if (stage.kind === 'new' && message.t === 'hello') {
        const device = this.options.devices.get(message.device)
        if (!device) return refuse(4001, 'unknown device')
        stage = { kind: 'challenged', deviceId: device.id, nonce: randomBytes(16) }
        return plain({ t: 'challenge', nonce: b64u(stage.nonce) })
      }
      if (stage.kind === 'challenged' && message.t === 'auth') {
        const device = this.options.devices.get(stage.deviceId)
        const clientNonce = fromB64u(message.nonce, 16)
        if (!device || !clientNonce) return refuse(4001, 'unknown device')
        const secret = fromB64u(device.secret, 32)!
        if (!proofMatches(authProof(secret, stage.nonce, clientNonce), fromB64u(message.proof, 32))) return refuse(4001, 'bad proof')
        const keys = sessionKeys(secret, stage.nonce, clientNonce)
        const cipher = new FrameCipher(keys.toPhone, keys.fromPhone)
        const connection: RemoteConnection = {
          id: b64u(randomBytes(9)),
          deviceId: device.id,
          send: (value) => {
            if (!ended && socket.readyState === socket.OPEN) socket.send(cipher.seal(value))
          }
        }
        clearTimeout(timer)
        uncount()
        stage = { kind: 'open', cipher, connection }
        this.sockets.set(connection.id, { socket, connection, end })
        this.options.devices.touch(device.id)
        connection.send({ event: 'hello', data: { name: this.options.name(), version: this.options.version, protocol: REMOTE_PROTOCOL, ...(this.options.urls ? { urls: this.options.urls() } : {}) } })
        this.options.onOpen?.(connection)
        this.options.onChange?.()
        return
      }
      refuse(4002, 'unexpected message')
    })
  }

  private lock(): void {
    this.code = null
    this.locked = true
    this.lastTryBy = null
    this.options.onChange?.()
  }

  /** One more try of the current code; the code goes after too many. */
  private spendTry(current: PairingCode & { tries: number }): void {
    current.tries++
    if (current.tries >= REMOTE_LIMITS.codeTries) this.lock()
  }

  /** The code, unless it expired or its tries are used up (except, for its last try's socket, to pair). */
  private usableCode(socket: WebSocket): (PairingCode & { tries: number }) | null {
    const current = this.code
    if (!current || current.expiresAt <= this.now()) return null
    return current.tries < REMOTE_LIMITS.codeTries || this.lastTryBy === socket ? current : null
  }

  /** A typed code (./crypto.ts): every attempt tests one code, so it costs a try whether or not it was right. */
  private pake(socket: WebSocket, message: Record<string, unknown>, plain: (value: unknown) => void, refuse: (code: number, reason: string) => void): void {
    const current = this.usableCode(socket)
    if (!current || current.tries >= REMOTE_LIMITS.codeTries) return refuse(4004, 'no pairing code')
    const reply = pakeReply(current.code, message.a, this.options.identity.publicKey)
    current.tries++
    if (current.tries >= REMOTE_LIMITS.codeTries) {
      if (!reply) return (this.lock(), refuse(4002, 'bad message'))
      // The last try: this socket may still pair; the code goes after that (or when it does anything else).
      this.lastTryBy = socket
      this.options.onChange?.()
    }
    if (!reply) return refuse(4002, 'bad message')
    plain({ t: 'pake', ...reply })
  }

  private pair(socket: WebSocket, message: Record<string, unknown>, plain: (value: unknown) => void, refuse: (code: number, reason: string) => void): void {
    const current = this.usableCode(socket)
    if (!current) return refuse(4004, 'no pairing code')
    const key = typeof message.key === 'string' ? pairingKey(this.options.identity.privateKey, message.key, current.code) : null
    const box = fromB64u(message.box)
    const opened = key && box ? open(key, 0, box) : null
    const name = opened ? nameIn(opened) : null
    if (!key || name === null) {
      this.spendTry(current)
      return refuse(4005, 'wrong code')
    }
    const { device, evicted } = this.options.devices.add(name)
    for (const id of evicted) this.disconnect(id)
    // One phone per code.
    this.code = null
    this.lastTryBy = null
    plain({ t: 'paired', box: b64u(seal(key, 1, Buffer.from(JSON.stringify({ device: device.id, secret: device.secret, name: this.options.name() }), 'utf8'))) })
    this.options.onChange?.()
  }
}
