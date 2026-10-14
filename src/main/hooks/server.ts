// The hook socket: a plain Node http server on a Unix socket. resources/hooks/tr-hook.sh POSTs each
// hook payload here and prints our response body, which is how a PermissionRequest decision reaches
// the agent. Authenticated with a per-run token; the socket directory is 0700 as well.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
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
  /** Stops listening and removes the socket directory. Open holds are released with an empty body. */
  close(): Promise<void>
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

export function startHookServer(handler: HookHandler, options: { socketDir?: string } = {}): Promise<HookServer> {
  const token = randomBytes(24).toString('hex')
  const dir = options.socketDir ?? mkdtempSync(join(tmpdir(), 'tr-hooks-'))
  chmodSync(dir, 0o700)
  const socketPath = join(dir, 'hook.sock')
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
      chmodSync(socketPath, 0o600)
      resolve({
        socketPath,
        token,
        close: () =>
          new Promise<void>((done) => {
            for (const abort of aborts) abort.abort()
            server.close(() => {
              rmSync(dir, { recursive: true, force: true })
              done()
            })
            server.closeAllConnections()
          })
      })
    })
  })
}
