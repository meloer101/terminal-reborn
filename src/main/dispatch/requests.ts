// Where `wavi` and main talk (PRD F21 接口): files, not a socket — Codex's default sandbox blocks unix sockets but may
// write to /private/tmp (§6.14 v1.104), so no agent's sandbox or permission settings change. One folder per session
// under a per-user, per-profile root (0700): `wavi` writes `req/<id>.json` (a temp file renamed into place), main reads
// and deletes it, checks the session's token, and writes the answer to `res/<id>.json`, which `wavi` reads and deletes.
// The token is derived from a per-profile secret, so the
// folders and tokens are the same after the app restarts while its agents keep running in the pty daemon.
// No Electron here (index.ts wires it), so it is testable on a real folder.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSessionIdText, parseWaviCommand, waviFail, type WaviCommand, type WaviResult } from '@shared/dispatch'

/** A request file's name: `<hex id>.json`. */
const REQUEST = /^[a-f0-9]{8,32}\.json$/
const MAX_REQUEST = 128 * 1024
/** A missed watch event is picked up by this sweep. */
const SWEEP_MS = 1_000

export interface Inbox {
  socket: string
  token: string
}

export interface WaviCall {
  sessionId: string
  command: WaviCommand
  /** Claude's cross-session inbox, from the calling agent's environment (deliver.ts). */
  inbox?: Inbox
}

export interface WaviRequestsOptions {
  root: string
  secret: string
  handle: (call: WaviCall) => Promise<WaviResult>
}

const INBOX_TOKEN = /^[A-Za-z0-9._~+/=-]{1,512}$/

export function parseInbox(raw: unknown): Inbox | undefined {
  const v = raw as Partial<Inbox> | null
  if (!v || typeof v !== 'object') return undefined
  return typeof v.socket === 'string' && v.socket.startsWith('/') && v.socket.length < 1024 && !v.socket.includes('\0') && typeof v.token === 'string' && INBOX_TOKEN.test(v.token)
    ? { socket: v.socket, token: v.token }
    : undefined
}

/** A session's folder name: its id, which never starts with a dot (so never `.` or `..`). */
const folderOf = (sessionId: string): string | null => (isSessionIdText(sessionId) && !sessionId.startsWith('.') ? sessionId : null)

export function waviTokenFor(secret: string, sessionId: string): string {
  return createHmac('sha256', secret).update(`wavi:${sessionId}`).digest('hex').slice(0, 40)
}

export class WaviRequests {
  private watcher: FSWatcher | null = null
  private sweep: NodeJS.Timeout | null = null
  private scheduled = false
  private readonly inFlight = new Set<string>()

  constructor(private readonly options: WaviRequestsOptions) {}

  /** The session's folder, made if missing; null for an id that cannot name one. */
  async ensureSession(sessionId: string): Promise<{ dir: string; token: string } | null> {
    const folder = folderOf(sessionId)
    if (!folder) return null
    const dir = join(this.options.root, folder)
    for (const sub of ['', 'req', 'res']) await mkdir(join(dir, sub), { recursive: true, mode: 0o700 })
    return { dir, token: waviTokenFor(this.options.secret, sessionId) }
  }

  dirOf(sessionId: string): string | null {
    const folder = folderOf(sessionId)
    return folder ? join(this.options.root, folder) : null
  }

  async start(): Promise<void> {
    await mkdir(this.options.root, { recursive: true, mode: 0o700 })
    // Made by an earlier run with a looser umask, or by someone else: keep it ours only.
    await chmod(this.options.root, 0o700)
    try {
      this.watcher = watch(this.options.root, { recursive: true }, () => this.schedule())
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
      })
    } catch {
      this.watcher = null
    }
    this.sweep = setInterval(() => this.schedule(), SWEEP_MS)
    this.schedule()
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.sweep) clearInterval(this.sweep)
    this.sweep = null
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    setTimeout(() => {
      this.scheduled = false
      void this.scan()
    }, 10)
  }

  /** Every waiting request of every session. */
  async scan(): Promise<void> {
    const folders = await readdir(this.options.root).catch(() => [] as string[])
    for (const folder of folders) {
      if (!folderOf(folder)) continue
      const names = await readdir(join(this.options.root, folder, 'req')).catch(() => [] as string[])
      for (const name of names) if (REQUEST.test(name)) void this.take(folder, name)
    }
  }

  private async take(sessionId: string, name: string): Promise<void> {
    const key = `${sessionId}/${name}`
    if (this.inFlight.has(key)) return
    this.inFlight.add(key)
    const dir = join(this.options.root, sessionId)
    const file = join(dir, 'req', name)
    try {
      let raw: string
      try {
        raw = await readFile(file, 'utf8')
        await unlink(file)
      } catch {
        return // gone: `wavi` gave up, or another scan took it
      }
      const result = raw.length > MAX_REQUEST ? waviFail('invalid_request', 'The request is too large.') : await this.answer(sessionId, raw)
      if (!result) return // not this session's token: no answer at all
      const out = join(dir, 'res', name)
      await writeFile(`${out}.tmp`, JSON.stringify(result), { mode: 0o600 })
      await rename(`${out}.tmp`, out)
    } catch (error) {
      console.error('[dispatch] could not answer a wavi request:', error)
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async answer(sessionId: string, raw: string): Promise<WaviResult | null> {
    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return waviFail('invalid_request', 'The request is not JSON.')
    }
    const token = typeof body.token === 'string' ? body.token : ''
    const expected = waviTokenFor(this.options.secret, sessionId)
    if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return null
    const parsed = parseWaviCommand(body.command)
    if (!parsed.ok) return waviFail('invalid_request', parsed.error)
    const inbox = parseInbox(body.inbox)
    try {
      return await this.options.handle({ sessionId, command: parsed.command, ...(inbox ? { inbox } : {}) })
    } catch (error) {
      return waviFail('failed', error instanceof Error ? error.message : String(error))
    }
  }
}
