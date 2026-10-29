// The pty daemon's socket protocol, shared by the daemon (./index.ts) and its client in main
// (src/main/pty/daemon-client.ts): newline-delimited JSON over a Unix socket under <userData>/daemon/.
// `hello` / `welcome` / `shutdown` are frozen across protocol versions, so a newer app can always retire an older daemon.
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { HookAgent } from '@shared/agent-events'
import type { HostEvent, HostRequest, HostSessionInfo } from '../pty-host/protocol'

/** Bump on any incompatible change to the messages below or in src/pty-host/protocol.ts. */
export const PROTOCOL_VERSION = 1

export const TOKEN_FILE = 'token'
export const RECORD_FILE = 'daemon.json'
export const LOG_FILE = 'daemon.log'
export const HOOK_TOKEN_FILE = 'hook-token'

/** sockaddr_un.sun_path is 104 bytes including the NUL terminator on macOS. */
const MAX_SOCKET_PATH_BYTES = 103

export function socketName(protocol = PROTOCOL_VERSION): string {
  return `ptyd-v${protocol}.sock`
}

/**
 * `<dir>/ptyd-v<N>.sock`, or — when that is too long for a Unix socket — a fixed-length directory under /tmp
 * derived from `dir`, so every launch of this profile finds the same path.
 */
export function socketPathFor(dir: string, uid: number, protocol = PROTOCOL_VERSION): string {
  const preferred = posix.join(dir, socketName(protocol))
  if (Buffer.byteLength(preferred) <= MAX_SOCKET_PATH_BYTES) return preferred
  const hash = createHash('sha256').update(dir).digest('hex').slice(0, 12)
  return posix.join(`/tmp/tr-${uid}-ptyd-${hash}`, socketName(protocol))
}

/**
 * The hook socket the daemon serves for every agent it hosts (resources/hooks/tr-hook.sh posts there). It outlives
 * the app, so agents keep reporting across restarts; the app learns it from `welcome`.
 */
export interface HookEndpointInfo {
  socketPath: string
  token: string
}

/** `<dir>/hooks` for the hook socket, or a fixed-length /tmp directory when that path is too long. */
export function hookDirFor(dir: string, uid: number): string {
  const preferred = posix.join(dir, 'hooks')
  if (Buffer.byteLength(posix.join(preferred, 'hook.sock')) <= MAX_SOCKET_PATH_BYTES) return preferred
  const hash = createHash('sha256').update(dir).digest('hex').slice(0, 12)
  return `/tmp/tr-${uid}-ptyh-${hash}`
}

export type ClientMessage =
  | { type: 'hello'; token: string; protocol: number; appVersion: string }
  | { type: 'shutdown'; killSessions: boolean }
  /** Electron's powerMonitor `shutdown`: a logout, restart or shutdown is under way (ignored by older daemons). */
  | { type: 'system-shutdown' }
  /** The app's answer to a relayed hook: the hook's stdout, or 404 for a session it does not know. */
  | { type: 'hook-reply'; rid: number; status: number; body: string }
  | HostRequest

export type DaemonMessage =
  | { type: 'welcome'; protocol: number; pid: number; buildId: string; sessions: HostSessionInfo[]; hooks: HookEndpointInfo | null }
  | { type: 'refused'; reason: string }
  /** A hook from an agent whose session this app has attached; answer with `hook-reply`. */
  | { type: 'hook'; rid: number; sessionId: string; event: string; agent: HookAgent; payload: unknown }
  | HostEvent

/** What the daemon writes to `daemon.json` once it listens. */
export interface DaemonRecord {
  pid: number
  protocol: number
  buildId: string
  socketPath: string
  startedAt: number
}

/** A frame larger than this ends the connection (a screen snapshot is capped far below it). */
export const MAX_FRAME_CHARS = 64 * 1024 * 1024

/** Splits a UTF-8 text stream into JSON messages, one per line. */
export class LineReader {
  /**
   * The unfinished frame's chunks, joined once its newline arrives: each chunk is scanned once and a multi-MB frame
   * is not re-copied per chunk.
   */
  private pending: string[] = []
  private pendingChars = 0

  constructor(
    /** Replaceable, so a client can hand the stream over once its handshake is done. */
    public onMessage: (message: unknown) => void,
    private readonly onError: (error: Error) => void
  ) {}

  push(chunk: string): void {
    let start = 0
    let newline = chunk.indexOf('\n')
    while (newline !== -1) {
      let line = chunk.slice(start, newline)
      if (this.pending.length > 0) {
        this.pending.push(line)
        line = this.pending.join('')
        this.reset()
      }
      start = newline + 1
      if (line.length > 0) {
        let message: unknown
        try {
          message = JSON.parse(line)
        } catch {
          this.reset()
          this.onError(new Error('malformed frame'))
          return
        }
        this.onMessage(message)
      }
      newline = chunk.indexOf('\n', start)
    }
    if (start === chunk.length) return
    this.pending.push(start === 0 ? chunk : chunk.slice(start))
    this.pendingChars += chunk.length - start
    if (this.pendingChars > MAX_FRAME_CHARS) {
      this.reset()
      this.onError(new Error('frame too large'))
    }
  }

  private reset(): void {
    this.pending = []
    this.pendingChars = 0
  }
}

export function frame(message: ClientMessage | DaemonMessage): string {
  return `${JSON.stringify(message)}\n`
}
