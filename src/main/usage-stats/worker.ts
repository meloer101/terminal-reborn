// The usage-stats worker thread (PRD F11 · 额度页): owns the scanner and its in-memory cache, so reading the logs never
// blocks the main process. Messages: { id, type: 'scan' } → { id, data } | { id, error }.
import { parentPort } from 'node:worker_threads'
import type { UsageDataset } from '@shared/usage-stats'
import { UsageScanner } from './scanner'
import { defaultStatsDirs } from './sources'

const scanner = new UsageScanner(defaultStatsDirs())
let running: Promise<UsageDataset> | null = null

parentPort?.on('message', (msg: unknown) => {
  if (typeof msg !== 'object' || msg === null || (msg as { type?: unknown }).type !== 'scan') return
  const id = (msg as { id?: unknown }).id
  running ??= scanner.scan().finally(() => {
    running = null
  })
  running.then(
    (data) => parentPort?.postMessage({ id, data }),
    (error: unknown) => parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  )
})
