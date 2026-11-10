// Main's handle on the usage-stats worker (PRD F11 · 额度页). One scan at a time (callers share it). A scan that takes
// longer than the limit rejects this call only: the worker finishes it and keeps its cache, so the next call (which joins
// a scan still running) gets the figures. A worker that dies rejects and the next call starts a fresh one.
import { Worker } from 'node:worker_threads'
import type { UsageDataset } from '@shared/usage-stats'

export const SCAN_TIMEOUT_MS = 60_000

type Reply = { id: number; data?: UsageDataset; error?: string }

export class UsageStatsService {
  private worker: Worker | null = null
  private seq = 0
  private inFlight: Promise<UsageDataset> | null = null

  constructor(
    private readonly workerPath: string,
    private readonly log: (message: string) => void = (m) => console.error(`[usage-stats] ${m}`),
    private readonly timeoutMs = SCAN_TIMEOUT_MS
  ) {}

  scan(): Promise<UsageDataset> {
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  dispose(): void {
    void this.worker?.terminate()
    this.worker = null
  }

  private run(): Promise<UsageDataset> {
    const worker = (this.worker ??= this.spawn())
    const id = ++this.seq
    return new Promise<UsageDataset>((resolve, reject) => {
      const done = (): void => {
        clearTimeout(timer)
        worker.off('message', onMessage)
        worker.off('exit', onExit)
      }
      const onMessage = (reply: Reply): void => {
        if (reply.id !== id) return
        done()
        if (reply.data) resolve(reply.data)
        else {
          this.log(`scan failed: ${reply.error ?? 'no data'}`)
          reject(new Error(reply.error ?? 'scan failed'))
        }
      }
      const onExit = (code: number): void => {
        done()
        this.worker = null
        this.log(`worker exited (${code}) during a scan`)
        reject(new Error(`usage-stats worker exited (${code})`))
      }
      const timer = setTimeout(() => {
        done()
        this.log(`scan took longer than ${this.timeoutMs} ms; the worker goes on with it`)
        reject(new Error('scan timed out'))
      }, this.timeoutMs)
      worker.on('message', onMessage)
      worker.on('exit', onExit)
      worker.postMessage({ id, type: 'scan' })
    })
  }

  private spawn(): Worker {
    const worker = new Worker(this.workerPath)
    worker.on('error', (error) => this.log(`worker error: ${error.message}`))
    worker.unref()
    return worker
  }
}
