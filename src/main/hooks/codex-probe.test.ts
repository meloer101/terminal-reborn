import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CodexConfigCache, CodexProbeError, prepareCodexHookConfig, probeCodexHookHashes, requestHooksList, type CodexHookPreparation } from './codex-probe'

let dir: string
/** A stand-in for the user's login shell: the probe runs `<shell> -l -i -c "exec codex app-server …"`. */
function fakeShell(name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tr-probe-test-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('probeCodexHookHashes failure paths', () => {
  it('fails fast with codex-not-installed when the shell cannot find codex (exit 127)', async () => {
    const shell = fakeShell('missing', 'echo "command not found: codex" >&2; exit 127')
    const started = Date.now()
    await expect(probeCodexHookHashes([], shell)).rejects.toMatchObject({ name: 'Error', reason: 'codex-not-installed' })
    expect(Date.now() - started).toBeLessThan(8000) // well under the 10 s probe timeout (generous: a loaded CI box spawns slowly)
  })

  it('fails fast with codex-probe-failed when codex exits before answering', async () => {
    const shell = fakeShell('crashes', 'exit 3')
    const started = Date.now()
    const error = await probeCodexHookHashes([], shell).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CodexProbeError)
    expect(error).toMatchObject({ reason: 'codex-probe-failed' })
    expect((error as Error).message).toContain('code 3')
    expect(Date.now() - started).toBeLessThan(8000)
  })

  it('reports a shell that cannot be started', async () => {
    await expect(probeCodexHookHashes([], join(dir, 'does-not-exist'))).rejects.toMatchObject({ reason: 'codex-probe-failed' })
  })
})

describe('requestHooksList with an abort signal', () => {
  it('rejects with the signal reason as soon as it aborts', async () => {
    const abort = new AbortController()
    const pending = requestHooksList(new PassThrough(), new PassThrough(), '/tmp', 10_000, abort.signal)
    abort.abort(new Error('child gone'))
    await expect(pending).rejects.toThrow('child gone')
  })

  it('rejects immediately when already aborted', async () => {
    const abort = new AbortController()
    abort.abort(new Error('already gone'))
    await expect(requestHooksList(new PassThrough(), new PassThrough(), '/tmp', 10_000, abort.signal)).rejects.toThrow('already gone')
  })
})

describe('prepareCodexHookConfig reasons', () => {
  it('passes the not-installed reason through', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await prepareCodexHookConfig('/s/tr-hook.sh', '/bin/zsh', () => Promise.reject(new CodexProbeError('codex-not-installed', 'nope')))
    expect(result).toEqual({ ok: false, reason: 'codex-not-installed', detail: 'nope' })
    error.mockRestore()
  })
})

describe('CodexConfigCache', () => {
  const ok: CodexHookPreparation = { ok: true, config: ['a=1'] }
  const failed: CodexHookPreparation = { ok: false, reason: 'codex-not-installed', detail: 'missing' }

  it('keeps a successful result for good', async () => {
    let now = 0
    const prepare = vi.fn().mockResolvedValue(ok)
    const cache = new CodexConfigCache(prepare, 1000, () => now)
    expect(await cache.get()).toBe(ok)
    now = 10 * 60_000
    expect(await cache.get()).toBe(ok)
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('remembers a failure for the TTL, then probes again', async () => {
    let now = 0
    const prepare = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(ok)
    const cache = new CodexConfigCache(prepare, 1000, () => now)
    expect(await cache.get()).toBe(failed)
    now = 999
    expect(await cache.get()).toBe(failed)
    expect(prepare).toHaveBeenCalledTimes(1)
    now = 1000
    expect(await cache.get()).toBe(ok)
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight probe between concurrent launches', async () => {
    const prepare = vi.fn().mockResolvedValue(failed)
    const cache = new CodexConfigCache(prepare)
    const results = await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(results).toEqual([failed, failed, failed])
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('invalidate() drops a cached failure', async () => {
    const prepare = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(ok)
    const cache = new CodexConfigCache(prepare)
    await cache.get()
    cache.invalidate()
    expect(await cache.get()).toBe(ok)
  })
})
