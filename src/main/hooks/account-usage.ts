// Reads the account's plan usage through the installed CLIs themselves (PRD §6.6 / §6.7), so Wavi never touches their
// login: no Keychain item, no `auth.json`, no token refresh racing the CLI. Neither call starts a model turn.
// - Claude Code 2.1.304+: a headless `claude -p` with stream-json input answers the `get_usage` control request
//   (experimental) with the same data as `/usage`. Hooks, settings files, MCP servers and session saving are off, so
//   nothing of the user's runs and nothing is written; the process exits once it has answered (~1.2 s).
// - Codex 0.48+: `codex app-server` answers `account/rateLimits/read` and pushes `account/rateLimits/updated`. Kept
//   running while it is asked often, closed after a quiet spell.
import { spawn, type ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { shellQuote } from '@shared/agent-launch'
import { parseClaudeAccountUsage, parseCodexAccountRateLimits, type VendorUsage } from '@shared/session-meta'
import type { PollOutcome } from './plan-usage-poller'

export const ACCOUNT_TIMEOUT_MS = 20_000
/** Shells report an unknown command with 127. */
const EXIT_COMMAND_NOT_FOUND = 127

/** Runs `words` in the user's login shell (so a version manager puts the CLI on PATH), stdio piped. */
function spawnInLoginShell(shell: string, words: readonly string[]): ChildProcess {
  const env = { ...process.env }
  // Never let the helper report to Wavi as a session.
  for (const key of Object.keys(env)) if (key.startsWith('TR_')) delete env[key]
  return spawn(shell, ['-l', '-i', '-c', `exec ${words.map(shellQuote).join(' ')}`], { cwd: tmpdir(), env, stdio: ['pipe', 'pipe', 'ignore'] })
}

/** Newline-delimited JSON from a stream; shell rc noise is skipped. */
function onJsonLines(stream: NodeJS.ReadableStream, handle: (message: Record<string, unknown>) => void): void {
  let buffer = ''
  stream.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString()
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      try {
        const message: unknown = JSON.parse(line)
        if (typeof message === 'object' && message !== null && !Array.isArray(message)) handle(message as Record<string, unknown>)
      } catch {
        // not JSON
      }
    }
  })
}

const errorText = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value ?? 'unknown error')).slice(0, 300)

/** The headless Claude that answers `get_usage`: the user's hooks, settings, MCP servers and session saving are off. */
export const CLAUDE_USAGE_ARGS = [
  'claude',
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--setting-sources',
  '',
  '--settings',
  '{"disableAllHooks":true}',
  '--strict-mcp-config',
  '--mcp-config',
  '{"mcpServers":{}}',
  '--no-session-persistence',
  '--disable-slash-commands'
] as const

/** One `get_usage` round trip; the process is closed as soon as it has answered. */
export function readClaudeAccountUsage(shell: string, options: { timeoutMs?: number; now?: () => number } = {}): Promise<PollOutcome> {
  const now = options.now ?? Date.now
  return new Promise((resolve) => {
    const child = spawnInLoginShell(shell, CLAUDE_USAGE_ARGS)
    let done = false
    const finish = (outcome: PollOutcome) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.stdin?.end()
      // Give it a moment to exit by itself (stdin closed), then make sure.
      setTimeout(() => child.kill(), 2000).unref()
      resolve(outcome)
    }
    const timer = setTimeout(() => finish({ kind: 'error', detail: 'claude did not answer get_usage in time' }), options.timeoutMs ?? ACCOUNT_TIMEOUT_MS)
    child.once('error', (error) => finish({ kind: 'unsupported', detail: `could not start ${shell}: ${error.message}` }))
    child.once('close', (code, signal) =>
      finish(
        code === EXIT_COMMAND_NOT_FOUND
          ? { kind: 'unsupported', detail: 'claude was not found on PATH in a login shell' }
          : { kind: 'error', detail: `claude exited before answering (${signal ?? `code ${String(code)}`})` }
      )
    )
    child.stdin?.on('error', () => undefined)
    const send = (message: object) => void child.stdin?.write(`${JSON.stringify(message)}\n`)
    onJsonLines(child.stdout!, (message) => {
      if (message.type !== 'control_response') return
      const response = message.response as Record<string, unknown> | undefined
      if (!response) return
      if (response.request_id === 'init') {
        if (response.subtype === 'error') finish({ kind: 'error', detail: `initialize: ${errorText(response.error)}` })
        else send({ type: 'control_request', request_id: 'usage', request: { subtype: 'get_usage', skip_behaviors: true } })
        return
      }
      if (response.request_id !== 'usage') return
      // An older Claude Code does not know the request.
      if (response.subtype === 'error') return finish({ kind: 'unsupported', detail: `get_usage: ${errorText(response.error)}` })
      const body = response.response as Record<string, unknown> | undefined
      if (!body || (body.rate_limits_available !== true && !body.subscription_type)) {
        return finish({ kind: 'unsupported', detail: 'no claude.ai plan limits for this login (API key or gateway)' })
      }
      if (body.rate_limits_available !== true) return finish({ kind: 'error', detail: 'claude could not read the plan limits right now' })
      finish({ kind: 'ok', usage: parseClaudeAccountUsage(body, now()) })
    })
    send({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } })
  })
}

/** Codex's app-server with `-s read-only -a never`; plugins off so none load just for this. */
export const CODEX_ACCOUNT_ARGS = ['codex', '-s', 'read-only', '-a', 'never', '-c', 'features.plugins=false', 'app-server'] as const

/** After this long without a request the app-server is closed (an idle poll every 10 minutes starts a new one). */
export const CODEX_IDLE_CLOSE_MS = 3 * 60_000

interface Pending {
  resolve(result: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * A `codex app-server` for account reads. `read()` starts it when needed (initialize, then `account/rateLimits/read`);
 * `account/rateLimits/updated` pushes go to `onUpdate`.
 */
export class CodexAccountClient {
  private child: ChildProcess | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** Codex before 0.151 takes no params for the read ("expected unit"); remembered once seen. */
  private plainRead = false

  constructor(
    private readonly shell: string,
    private readonly onUpdate: (usage: VendorUsage) => void,
    private readonly options: { timeoutMs?: number; idleCloseMs?: number; now?: () => number; args?: readonly string[] } = {}
  ) {}

  async read(): Promise<PollOutcome> {
    try {
      await this.start()
      return { kind: 'ok', usage: parseCodexAccountRateLimits(await this.readRateLimits(), this.now()) }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      // API-key logins and third-party providers have no plan limits (0.142.5: "chatgpt authentication required…").
      if (/authentication required|not installed|not found on PATH/i.test(detail)) return { kind: 'unsupported', detail }
      return { kind: 'error', detail }
    } finally {
      this.armIdleClose()
    }
  }

  /** Newer Codex skips its reset-credit lookup for a background poll when asked; an older one rejects any params. */
  private async readRateLimits(): Promise<unknown> {
    if (this.plainRead) return this.request('account/rateLimits/read', {})
    try {
      return await this.request('account/rateLimits/read', { excludeResetCreditDetails: true })
    } catch (error) {
      if (!(error instanceof Error) || !/expected unit/i.test(error.message)) throw error
      this.plainRead = true
      return this.request('account/rateLimits/read', {})
    }
  }

  close(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const child = this.child
    this.child = null
    this.ready = null
    this.failAll(new Error('codex app-server closed'))
    child?.kill()
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private armIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.close(), this.options.idleCloseMs ?? CODEX_IDLE_CLOSE_MS)
    this.idleTimer.unref?.()
  }

  private failAll(error: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(error)
    }
    this.pending.clear()
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready
    const child = spawnInLoginShell(this.shell, this.options.args ?? CODEX_ACCOUNT_ARGS)
    this.child = child
    child.stdin?.on('error', () => undefined)
    const gone = (error: Error) => {
      if (this.child !== child) return
      this.child = null
      this.ready = null
      this.failAll(error)
    }
    child.once('error', (error) => gone(new Error(`could not start ${this.shell}: ${error.message}`)))
    child.once('close', (code, signal) =>
      gone(new Error(code === EXIT_COMMAND_NOT_FOUND ? 'codex was not found on PATH in a login shell' : `codex app-server exited (${signal ?? `code ${String(code)}`})`))
    )
    onJsonLines(child.stdout!, (message) => {
      if (typeof message.id === 'number') {
        const p = this.pending.get(message.id)
        if (!p) return
        this.pending.delete(message.id)
        clearTimeout(p.timer)
        const error = message.error as { message?: unknown } | undefined
        if (error) p.reject(new Error(errorText(error.message)))
        else p.resolve(message.result)
        return
      }
      if (message.method === 'account/rateLimits/updated') {
        const params = message.params as Record<string, unknown> | undefined
        const usage = parseCodexAccountRateLimits({ rateLimits: params?.rateLimits }, this.now())
        if (usage) this.onUpdate({ ...usage, complete: false })
      }
    })
    this.ready = this.request('initialize', { clientInfo: { name: 'wavi', version: '0' } }).then(() => {
      this.write({ method: 'initialized' })
    })
    // A failed start is not kept: the next read starts over.
    this.ready.catch(() => {
      if (this.child === child) this.close()
    })
    return this.ready
  }

  private write(message: object): void {
    this.child?.stdin?.write(`${JSON.stringify(message)}\n`)
  }

  private request(method: string, params: object): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`codex did not answer ${method} in time`))
      }, this.options.timeoutMs ?? ACCOUNT_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }
}
