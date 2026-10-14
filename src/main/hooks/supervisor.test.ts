// Real sockets and files in a temp dir: the self-check is only worth anything if it survives what really happens
// to the socket (file deleted, directory deleted, server error).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HooksHealth } from '@shared/agent-events'
import { probeSocket, startHookServer, type HookServer, type HookServerOptions } from './server'
import { HookSupervisor } from './supervisor'

let dir: string
let supervisor: HookSupervisor | null = null
const settings = () => ({ hooks: { Stop: [] } })

beforeEach(() => {
  // Short on purpose: Unix socket paths are limited to 104 bytes.
  dir = mkdtempSync(join(tmpdir(), 'tr-sup-'))
})
afterEach(async () => {
  await supervisor?.stop()
  supervisor = null
  rmSync(dir, { recursive: true, force: true })
})

function make(extra: Partial<ConstructorParameters<typeof HookSupervisor>[0]> = {}) {
  const health: HooksHealth[] = []
  const handler = vi.fn(() => 'ok')
  supervisor = new HookSupervisor({ dir, handler, settings, onHealth: (h) => health.push(h), log: () => undefined, ...extra })
  return { sup: supervisor, health, handler }
}

describe('HookSupervisor', () => {
  it('starts the server and writes the settings file (0600) in its directory', async () => {
    const { sup, health } = make()
    expect(await sup.start()).toEqual({ ok: true })
    expect(await probeSocket(sup.socketPath)).toBe(true)
    expect(JSON.parse(readFileSync(sup.settingsPath, 'utf8'))).toEqual(settings())
    expect(health).toEqual([{ ok: true }])
  })

  it('restarts on the same socket path and token when the socket file is deleted', async () => {
    const { sup, health } = make()
    await sup.start()
    rmSync(sup.socketPath)
    expect(await probeSocket(sup.socketPath)).toBe(false)

    expect(await sup.check()).toEqual({ ok: true })
    expect(sup.restarts).toBe(1)
    expect(await probeSocket(sup.socketPath)).toBe(true)
    // Healthy before and after: no flicker reported to the UI.
    expect(health).toEqual([{ ok: true }])
  })

  it('recreates the whole directory and the settings file when the directory is wiped (temp cleaner)', async () => {
    const { sup } = make()
    await sup.start()
    rmSync(dir, { recursive: true, force: true })

    expect(await sup.check()).toEqual({ ok: true })
    expect(await probeSocket(sup.socketPath)).toBe(true)
    expect(existsSync(sup.settingsPath)).toBe(true)
  })

  it('rewrites a deleted or damaged settings file without restarting the server', async () => {
    const { sup } = make()
    await sup.start()
    rmSync(sup.settingsPath)
    await sup.check()
    expect(existsSync(sup.settingsPath)).toBe(true)
    writeFileSync(sup.settingsPath, '{"hooks":')
    await sup.check()
    expect(JSON.parse(readFileSync(sup.settingsPath, 'utf8'))).toEqual(settings())
    expect(sup.restarts).toBe(0)
  })

  it('serves requests with the original token after a restart (running agents keep working)', async () => {
    const { sup, handler } = make()
    await sup.start()
    rmSync(sup.socketPath)
    await sup.check()
    const status = await post(sup.socketPath, sup.token)
    expect(status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('treats a server error event as broken and restarts it on the next check', async () => {
    let onError: HookServerOptions['onError']
    const starts: HookServer[] = []
    const startServer = async (handler: Parameters<typeof startHookServer>[0], options: HookServerOptions) => {
      onError = options.onError
      const server = await startHookServer(handler, options)
      starts.push(server)
      return server
    }
    const { sup } = make({ startServer })
    await sup.start()
    onError?.(new Error('EMFILE'))
    await sup.check()
    expect(starts).toHaveLength(2)
    expect(sup.restarts).toBe(1)
    expect(await probeSocket(sup.socketPath)).toBe(true)
  })

  it('reports unavailable when the server cannot start, and recovers on a later check', async () => {
    let fail = true
    const startServer = (handler: Parameters<typeof startHookServer>[0], options: HookServerOptions) =>
      fail ? Promise.reject(new Error('EADDRINUSE')) : startHookServer(handler, options)
    const { sup, health } = make({ startServer })
    expect(await sup.start()).toEqual({ ok: false, reason: 'server-unavailable', detail: 'EADDRINUSE' })
    fail = false
    expect(await sup.check()).toEqual({ ok: true })
    expect(health).toEqual([{ ok: false, reason: 'server-unavailable', detail: 'EADDRINUSE' }, { ok: true }])
  })

  it('does not report the same failure twice', async () => {
    const { sup, health } = make({ startServer: () => Promise.reject(new Error('boom')) })
    await sup.start()
    await sup.check()
    await sup.check()
    expect(health).toHaveLength(1)
  })

  it('runs the periodic self-check and stops it on stop()', async () => {
    vi.useFakeTimers()
    try {
      const probe = vi.fn().mockResolvedValue(true)
      const { sup } = make({ probe, intervalMs: 1000 })
      await sup.start()
      expect(probe).toHaveBeenCalledTimes(0) // first check starts the server, nothing to probe yet
      await vi.advanceTimersByTimeAsync(3000)
      expect(probe).toHaveBeenCalledTimes(3)
      await sup.stop()
      await vi.advanceTimersByTimeAsync(3000)
      expect(probe).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares one run between concurrent checks', async () => {
    const probe = vi.fn().mockResolvedValue(true)
    const { sup } = make({ probe })
    await sup.start()
    await Promise.all([sup.check(), sup.check(), sup.check()])
    expect(probe).toHaveBeenCalledTimes(1)
  })
})

function post(socketPath: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/hook/Stop?session=s1&agent=claude', method: 'POST', headers: { 'x-tr-token': token } }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end('{}')
  })
}
