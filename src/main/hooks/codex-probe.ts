// Asks the installed Codex for the trust hash of our per-launch hook definitions (docs/spikes/codex.md §3):
// `codex app-server` speaks JSON-RPC over stdio, and its `hooks/list` reports every hook it would load for a
// directory together with `currentHash`. We start it with the same `-c hooks.<Event>=…` overrides the real
// launch will use, take the hashes of the `sessionFlags` entries, and pin exactly those with `hooks.state`.
// Nothing here touches `~/.codex`; the probe never starts a thread, so it costs no model turn (~0.3 s).
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { Readable, Writable } from 'node:stream'
import { shellQuote } from '@shared/agent-launch'
import { buildCodexHookOverrides, buildCodexTrustOverride, coversAllEvents, sessionFlagHashes } from './codex-config'

export const PROBE_TIMEOUT_MS = 10_000

/** Sends `initialize` + `hooks/list` and resolves with the `hooks/list` result; rejects on timeout or a JSON-RPC error. */
export function requestHooksList(input: Writable, output: Readable, cwd: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => finish(new Error('codex did not answer hooks/list in time')), timeoutMs)

    function finish(error: Error | null, result?: unknown): void {
      clearTimeout(timer)
      output.off('data', onData)
      if (error) reject(error)
      else resolve(result)
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

    output.on('data', onData)
    const send = (message: object): void => void input.write(`${JSON.stringify(message)}\n`)
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'terminal-reborn', version: '0' } } })
    send({ method: 'initialized' })
    send({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } })
  })
}

/**
 * Runs `codex app-server -c <overrides>` the way the agent itself is started (in the user's login shell, so a
 * version manager puts `codex` on PATH), asks for the hook list and returns our hashes.
 */
export async function probeCodexHookHashes(overrides: readonly string[], shell: string, cwd: string = tmpdir()): Promise<Record<string, string>> {
  const words = ['codex', 'app-server', ...overrides.flatMap((o) => ['-c', o])].map(shellQuote).join(' ')
  const child = spawn(shell, ['-l', '-i', '-c', `exec ${words}`], { cwd, stdio: ['pipe', 'pipe', 'ignore'] })
  child.on('error', () => undefined) // spawn failure surfaces as the timeout below
  try {
    return sessionFlagHashes(await requestHooksList(child.stdin, child.stdout, cwd))
  } finally {
    child.kill()
  }
}

/**
 * The `-c` override values to launch Codex with: our hook definitions plus the trust pins.
 * Returns `[]` (Codex then runs without our hooks, with the slower title-based status) when the probe fails or
 * does not cover every event.
 */
export async function prepareCodexHookConfig(scriptPath: string, shell: string, probe = probeCodexHookHashes): Promise<string[]> {
  const overrides = buildCodexHookOverrides(scriptPath)
  try {
    const hashes = await probe(overrides, shell)
    const trust = coversAllEvents(hashes) ? buildCodexTrustOverride(hashes) : null
    if (!trust) {
      console.error('[hooks] codex did not report trust hashes for our hooks; starting it without hooks')
      return []
    }
    return [...overrides, trust]
  } catch (error) {
    console.error('[hooks] could not probe codex hook hashes:', error)
    return []
  }
}
