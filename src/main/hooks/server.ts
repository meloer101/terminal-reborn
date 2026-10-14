// The hook socket: a plain Node http server on a Unix socket. resources/hooks/tr-hook.sh POSTs each
// hook payload here and prints our response body, which is how a PermissionRequest decision reaches
// the agent. Authenticated with a per-run token; the socket directory is 0700 as well.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HookAgent } from '@shared/agent-events'

/** PostToolUse carries whole tool outputs; anything beyond this is dropped (the hook sees a 413). */
export const MAX_BODY_BYTES = 32 * 1024 * 1024

const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/
const EVENT_NAME = /^[A-Za-z]{1,40}$/
const AGENTS: ReadonlySet<string> = new Set<HookAgent>(['claude', 'codex'])

export interface HookRequest {
  event: string
  sessionId: string
  agent: HookAgent
  /** Parsed JSON body; `undefined` when it was not valid JSON. */
  payload: unknown
  /** Aborted when the hook process went away (agent exited / killed it) before we answered. */
  signal: AbortSignal
}

/** Thrown by a handler to answer 404 (unknown session); the hook script then prints nothing. */
export class UnknownSessionError extends Error {}

export type HookHandler = (request: HookRequest) => Promise<string> | string

export interface HookServer {
  socketPath: string
  token: string
  /** Stops listening and removes the socket (and its directory unless the caller owns it). Open holds are released with an empty body. */
  close(): Promise<void>
}

export interface HookServerOptions {
  /** Directory for `hook.sock`. Created (0700) when missing. Default: a fresh directory under the OS temp dir. */
  socketDir?: string
  /** Reuse a token across restarts so already-running agents (whose env holds it) keep working. */
  token?: string
  /** The caller owns `socketDir` (keeps it on close). Always true for a caller-supplied `socketDir` unless set false. */
  keepDir?: boolean
  /** The server emitted `error` or closed unexpectedly after it started listening. Never thrown: log and recover. */
  onError?: (error: Error) => void
}

export const SOCKET_NAME = 'hook.sock'

/** True when something accepts connections on the Unix socket. Resolves false on any error or after `timeoutMs`. */
export function probeSocket(socketPath: string, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath)
    const done = (ok: boolean): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

function tokenMatches(expected: string, given: string | string[] | undefined): boolean {
  if (typeof given !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0
        resolve(null)
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(null))
  })
}

function reply(res: ServerResponse, status: number, body = ''): void {
  if (res.writableEnded || res.destroyed) return
  res.statusCode = status
  if (body) res.setHeader('Content-Type', 'application/json')
  res.end(body)
}

export function startHookServer(handler: HookHandler, options: HookServerOptions = {}): Promise<HookServer> {
  const token = options.token ?? randomBytes(24).toString('hex')
  const dir = options.socketDir ?? mkdtempSync(join(tmpdir(), 'tr-hooks-'))
  const keepDir = options.keepDir ?? options.socketDir !== undefined
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const socketPath = join(dir, SOCKET_NAME)
  // A socket file left by a crashed run (or our own previous server) would make listen() fail with EADDRINUSE.
  rmSync(socketPath, { force: true })
  let closing = false
  const aborts = new Set<AbortController>()

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://tr')
      const match = /^\/hook\/([A-Za-z]+)$/.exec(url.pathname)
      const event = match?.[1]
      const sessionId = url.searchParams.get('session') ?? ''
      const agent = url.searchParams.get('agent') ?? 'claude'
      if (req.method !== 'POST' || !tokenMatches(token, req.headers['x-tr-token'])) return reply(res, 403)
      if (!event || !EVENT_NAME.test(event) || !SESSION_ID.test(sessionId) || !AGENTS.has(agent)) return reply(res, 400)

      const raw = await readBody(req)
      if (raw === null) return reply(res, 413)
      let payload: unknown
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        payload = undefined
      }

      const abort = new AbortController()
      aborts.add(abort)
      res.on('close', () => {
        aborts.delete(abort)
        if (!res.writableEnded) abort.abort()
      })
      try {
        const body = await handler({ event, sessionId, agent: agent as HookAgent, payload, signal: abort.signal })
        reply(res, 200, body)
      } catch (error) {
        reply(res, error instanceof UnknownSessionError ? 404 : 500)
      }
    })()
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      // An 'error' with no listener would be an uncaught exception in main; keep one for the server's lifetime.
      server.on('error', (error) => options.onError?.(error))
      server.on('close', () => {
        if (!closing) options.onError?.(new Error('hook server closed unexpectedly'))
      })
      chmodSync(socketPath, 0o600)
      resolve({
        socketPath,
        token,
        close: () =>
          new Promise<void>((done) => {
            closing = true
            for (const abort of aborts) abort.abort()
            const cleanup = (): void => {
              if (keepDir) rmSync(socketPath, { force: true })
              else rmSync(dir, { recursive: true, force: true })
              done()
            }
            if (!server.listening) {
              cleanup()
              return
            }
            server.close(cleanup)
            server.closeAllConnections()
          })
      })
    })
  })
}
