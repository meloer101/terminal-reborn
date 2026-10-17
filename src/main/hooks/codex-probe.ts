// Asks the installed Codex for the trust hash of our per-launch hook definitions (PRD §6.7):
// `codex app-server` speaks JSON-RPC over stdio, and its `hooks/list` reports every hook it would load for a
// directory together with `currentHash`. We start it with the same `-c hooks.<Event>=…` overrides the real
// launch will use, take the hashes of the `sessionFlags` entries, and pin exactly those with `hooks.state`.
// Nothing here touches `~/.codex`; the probe never starts a thread, so it costs no model turn (~0.3 s).
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { Readable, Writable } from 'node:stream'
import type { HooksUnavailableReason } from '@shared/agent-events'
import { shellQuote } from '@shared/agent-launch'
import { buildCodexHookOverrides, buildCodexTrustOverride, coversAllEvents, sessionFlagHashes } from './codex-config'

export const PROBE_TIMEOUT_MS = 10_000
/** How long a failed probe is remembered, so every Codex launch does not pay for the same failure again. */
export const NEGATIVE_CACHE_MS = 3 * 60_000
/** Shells report an unknown command with 127. */
const EXIT_COMMAND_NOT_FOUND = 127

export type CodexUnavailableReason = Extract<HooksUnavailableReason, 'codex-not-installed' | 'codex-probe-failed'>

export class CodexProbeError extends Error {
  constructor(
    readonly reason: CodexUnavailableReason,
    message: string
  ) {
    super(message)
  }
}

export type CodexHookPreparation = { ok: true; config: string[] } | { ok: false; reason: CodexUnavailableReason; detail: string }

/**
 * Sends `initialize` + `hooks/list` and resolves with the `hooks/list` result; rejects on timeout, a JSON-RPC
 * error, or when `signal` aborts (its reason becomes the rejection, e.g. the child process exited).
 */
export function requestHooksList(input: Writable, output: Readable, cwd: string, timeoutMs = PROBE_TIMEOUT_MS, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => finish(new Error('codex did not answer hooks/list in time')), timeoutMs)

    function finish(error: Error | null, result?: unknown): void {
      clearTimeout(timer)
      output.off('data', onData)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(result)
    }

    function onAbort(): void {
      finish(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
    }

    function onData(chunk: Buffer | string): void {
      buffer += chunk.toString()
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        let message: { id?: unknown; result?: unknown; error?: { message?: unknown } }
        try {
          message = JSON.parse(line) as typeof message
        } catch {
          continue // shell rc noise, logs
        }
        if (message.id !== 2) continue
        if (message.error) finish(new Error(`hooks/list failed: ${String(message.error.message ?? 'unknown error')}`))
        else finish(null, message.result)
        return
      }
    }

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    output.on('data', onData)
    // A dead child's stdin raises EPIPE; the exit handler reports the real reason.
    input.on('error', () => undefined)
    const send = (message: object): void => void input.write(`${JSON.stringify(message)}\n`)
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'terminal-reborn', version: '0' } } })
    send({ method: 'initialized' })
    send({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } })
  })
}

/**
 * Runs `codex app-server -c <overrides>` the way the agent itself is started (in the user's login shell, so a
 * version manager puts `codex` on PATH), asks for the hook list and returns our hashes. Fails as soon as the
 * child exits (`CodexProbeError` 'codex-not-installed' for exit 127) instead of waiting for the timeout.
 */
export async function probeCodexHookHashes(overrides: readonly string[], shell: string, cwd: string = tmpdir()): Promise<Record<string, string>> {
  const words = ['codex', 'app-server', ...overrides.flatMap((o) => ['-c', o])].map(shellQuote).join(' ')
  const child = spawn(shell, ['-l', '-i', '-c', `exec ${words}`], { cwd, stdio: ['pipe', 'pipe', 'ignore'] })
  const gone = new AbortController()
  child.once('error', (error) => gone.abort(new CodexProbeError('codex-probe-failed', `could not start ${shell}: ${error.message}`)))
  child.once('close', (code, signal) =>
    gone.abort(
      code === EXIT_COMMAND_NOT_FOUND
        ? new CodexProbeError('codex-not-installed', 'codex was not found on PATH in a login shell')
        : new CodexProbeError('codex-probe-failed', `codex exited before answering (${signal ?? `code ${String(code)}`})`)
    )
  )
  try {
    return sessionFlagHashes(await requestHooksList(child.stdin, child.stdout, cwd, PROBE_TIMEOUT_MS, gone.signal))
  } finally {
    child.kill()
  }
}

/**
 * The `-c` override values to launch Codex with: our hook definitions plus the trust pins.
 * Not ok (Codex then runs without our hooks, with the slower title-based status) when the probe fails or
 * does not cover every event; `reason` says why.
 */
export async function prepareCodexHookConfig(scriptPath: string, shell: string, probe = probeCodexHookHashes): Promise<CodexHookPreparation> {
  const overrides = buildCodexHookOverrides(scriptPath)
  try {
    const hashes = await probe(overrides, shell)
    const trust = coversAllEvents(hashes) ? buildCodexTrustOverride(hashes) : null
    if (!trust) {
      console.error('[hooks] codex did not report trust hashes for our hooks; starting it without hooks')
      return { ok: false, reason: 'codex-probe-failed', detail: 'codex did not report trust hashes for every hook event' }
    }
    return { ok: true, config: [...overrides, trust] }
  } catch (error) {
    const reason: CodexUnavailableReason = error instanceof CodexProbeError ? error.reason : 'codex-probe-failed'
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[hooks] could not probe codex hook hashes:', detail)
    return { ok: false, reason, detail }
  }
}

/**
 * Per app run: a successful probe is kept for good (the hashes only depend on our hook definitions), a failed
 * one for `negativeTtlMs`, so a missing or broken Codex costs one probe, not one per launch. Concurrent
 * callers share the in-flight probe.
 */
export class CodexConfigCache {
  private entry: { result: CodexHookPreparation; at: number } | null = null
  private inFlight: Promise<CodexHookPreparation> | null = null

  constructor(
    private readonly prepare: () => Promise<CodexHookPreparation>,
    private readonly negativeTtlMs = NEGATIVE_CACHE_MS,
    private readonly now: () => number = Date.now
  ) {}

  get(): Promise<CodexHookPreparation> {
    const cached = this.entry
    if (cached && (cached.result.ok || this.now() - cached.at < this.negativeTtlMs)) return Promise.resolve(cached.result)
    this.inFlight ??= this.prepare()
      .then((result) => {
        this.entry = { result, at: this.now() }
        return result
      })
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  /** Forget a cached failure (e.g. the user just installed Codex). */
  invalidate(): void {
    this.entry = null
  }
}
