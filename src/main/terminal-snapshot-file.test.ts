import { mkdtempSync, readdirSync, readFileSync, utimesSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_SNAPSHOT_CHARS, TerminalSnapshotFiles } from './terminal-snapshot-file'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})

const snap = { cols: 80, rows: 24, data: '\x1b[1mhello\x1b[0m\r\nworld' }
const tempDir = (): string => mkdtempSync(join(tmpdir(), 'tr-snap-'))

describe('TerminalSnapshotFiles', () => {
  afterEach(() => vi.mocked(fsp.writeFile).mockClear())

  it('round-trips a snapshot', async () => {
    const files = new TerminalSnapshotFiles(tempDir())
    await files.save('s1', snap)
    expect(await files.load('s1')).toEqual(snap)
    await files.remove('s1')
    expect(await files.load('s1')).toBeNull()
  })

  it('rejects bad ids and oversized or malformed payloads', async () => {
    const files = new TerminalSnapshotFiles(tempDir())
    await expect(files.save('../x', snap)).rejects.toThrow()
    await expect(files.save('s1', { ...snap, data: 'x'.repeat(MAX_SNAPSHOT_CHARS + 1) })).rejects.toThrow()
    await expect(files.save('s1', { cols: 0, rows: 24, data: '' })).rejects.toThrow()
    expect(await files.load('../x')).toBeNull()
    expect(files.writing).toBe(0)
  })

  it('serialises the writes of one session and writes only the newest of those queued behind one in flight', async () => {
    const dir = tempDir()
    const files = new TerminalSnapshotFiles(dir)
    const writes = Array.from({ length: 5 }, (_, i) => files.save('s1', { ...snap, data: `frame ${i}` }))
    expect(files.writing).toBe(1)
    await Promise.all(writes)
    // Frame 0 was already being written; 1–3 were superseded by 4 before their turn.
    const written = vi.mocked(fsp.writeFile).mock.calls.map(([, json]) => JSON.parse(String(json)).data)
    expect(written).toEqual(['frame 0', 'frame 4'])
    expect(JSON.parse(readFileSync(join(dir, 's1.json'), 'utf8')).data).toBe('frame 4')
    expect(readdirSync(dir)).toEqual(['s1.json'])
    expect(files.writing).toBe(0)
  })

  it('never has two writes of one session in flight at once', async () => {
    const files = new TerminalSnapshotFiles(tempDir())
    let inFlight = 0
    let most = 0
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fsp.writeFile).mockImplementation(async (...args: Parameters<typeof actual.writeFile>) => {
      most = Math.max(most, ++inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      await actual.writeFile(...args)
      inFlight--
    })
    try {
      const first = files.save('s1', { ...snap, data: 'a' })
      await new Promise((resolve) => setTimeout(resolve, 1))
      const second = files.save('s1', { ...snap, data: 'b' })
      const other = files.save('s2', { ...snap, data: 'c' })
      await Promise.all([first, second, other])
      // s1's two writes ran one after the other; s2 ran alongside them.
      expect(most).toBe(2)
      expect((await files.load('s1'))?.data).toBe('b')
    } finally {
      vi.mocked(fsp.writeFile).mockImplementation(actual.writeFile)
    }
  })

  it('reports a failed write, and the next save writes again', async () => {
    const files = new TerminalSnapshotFiles(tempDir())
    vi.mocked(fsp.writeFile).mockRejectedValueOnce(new Error('disk full'))
    await expect(files.save('s1', snap)).rejects.toThrow('disk full')
    expect(files.writing).toBe(0)
    await files.save('s1', snap)
    expect(await files.load('s1')).toEqual(snap)
  })

  it('load waits for a write in flight; remove drops queued writes', async () => {
    const dir = tempDir()
    const files = new TerminalSnapshotFiles(dir)
    void files.save('s1', { ...snap, data: 'new' })
    expect((await files.load('s1'))?.data).toBe('new')
    void files.save('s1', { ...snap, data: 'a' })
    void files.save('s1', { ...snap, data: 'b' })
    await files.remove('s1')
    await files.idle()
    expect(readdirSync(dir)).toEqual([])
  })

  it('prunes old snapshots', async () => {
    const dir = tempDir()
    const files = new TerminalSnapshotFiles(dir)
    await files.save('old', snap)
    await files.save('new', snap)
    const past = new Date(Date.now() - 40 * 24 * 3600 * 1000)
    utimesSync(join(dir, 'old.json'), past, past)
    await files.pruneOlderThan(30 * 24 * 3600 * 1000)
    expect(readdirSync(dir)).toEqual(['new.json'])
  })
})
