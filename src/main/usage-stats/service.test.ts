import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UsageStatsService } from './service'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wavi-usage-worker-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const workerFile = async (body: string): Promise<string> => {
  const path = join(dir, 'w.mjs')
  await writeFile(path, `import { parentPort } from 'node:worker_threads'\n${body}\n`)
  return path
}

describe('UsageStatsService', () => {
  it('returns the worker’s dataset and shares one scan between callers', async () => {
    const path = await workerFile(
      "let n = 0; parentPort.on('message', (m) => { n++; setTimeout(() => parentPort.postMessage({ id: m.id, data: { buckets: [], sessions: [], firstAt: {}, skipped: n, scannedAt: 1 } }), 20) })"
    )
    const service = new UsageStatsService(path, () => {})
    const [a, b] = await Promise.all([service.scan(), service.scan()])
    expect(a).toBe(b)
    expect(a.skipped).toBe(1)
    expect((await service.scan()).skipped).toBe(2)
    service.dispose()
  })

  it('rejects a scan that takes too long, and the worker keeps going so the next call gets the figures', async () => {
    // Like the real worker: a call while a scan runs joins it; once done, answers come from the cache at once.
    const path = await workerFile(
      "let running = null; let done = false; parentPort.on('message', (m) => { const reply = () => parentPort.postMessage({ id: m.id, data: { buckets: [], sessions: [], firstAt: {}, skipped: 0, scannedAt: 7 } }); if (done) return reply(); running ??= new Promise((r) => setTimeout(() => { done = true; r() }, 150)); running.then(reply) })"
    )
    const logs: string[] = []
    const service = new UsageStatsService(path, (m) => logs.push(m), 100)
    await expect(service.scan()).rejects.toThrow('timed out')
    expect(logs[0]).toContain('longer than 100 ms')
    expect((await service.scan()).scannedAt).toBe(7)
    service.dispose()
  })

  it('rejects when the worker reports an error', async () => {
    const path = await workerFile("parentPort.on('message', (m) => parentPort.postMessage({ id: m.id, error: 'EACCES' }))")
    const service = new UsageStatsService(path, () => {})
    await expect(service.scan()).rejects.toThrow('EACCES')
    service.dispose()
  })
})
