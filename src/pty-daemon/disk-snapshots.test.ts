import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSnapshot } from '@shared/ipc'
import { TerminalSnapshotFiles } from '../main/terminal-snapshot-file'
import { HeadlessMirror } from '../pty-host/headless-mirror'
import { DiskSnapshots, type DiskSnapshotDeps } from './disk-snapshots'

const QUIET = 30_000

function setup(attached = new Set<string>()): { snapshots: DiskSnapshots; saved: Array<[string, TerminalSnapshot]>; deps: DiskSnapshotDeps } {
  const saved: Array<[string, TerminalSnapshot]> = []
  const deps: DiskSnapshotDeps = {
    capture: vi.fn((id: string) => Promise.resolve({ cols: 80, rows: 24, data: `screen of ${id}` })),
    isAttached: (id) => attached.has(id),
    save: (id, snapshot) => {
      saved.push([id, snapshot])
    }
  }
  return { snapshots: new DiskSnapshots(QUIET, deps), saved, deps }
}

describe('DiskSnapshots', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('writes a detached session once its output has been quiet for the whole period', async () => {
    const { snapshots, saved } = setup()
    snapshots.touch('a')
    await vi.advanceTimersByTimeAsync(QUIET - 1000)
    snapshots.touch('a')
    await vi.advanceTimersByTimeAsync(QUIET - 1)
    expect(saved).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(saved).toEqual([['a', { cols: 80, rows: 24, data: 'screen of a' }]])
    expect(snapshots.pending).toBe(0)
  })

  it('writes a burst of output once, after it ends', async () => {
    const { snapshots, saved } = setup()
    for (let i = 0; i < 1000; i++) {
      snapshots.touch('a')
      await vi.advanceTimersByTimeAsync(50)
    }
    expect(saved).toEqual([])
    await vi.advanceTimersByTimeAsync(QUIET)
    expect(saved).toHaveLength(1)
  })

  it('leaves the file to the renderer once a client attaches', async () => {
    const attached = new Set<string>()
    const { snapshots, saved } = setup(attached)
    snapshots.touch('a')
    snapshots.touch('b')
    snapshots.cancel('a')
    attached.add('b')
    await vi.advanceTimersByTimeAsync(QUIET)
    expect(saved).toEqual([])
  })

  it('does not write a screen captured while a client was attaching', async () => {
    const attached = new Set<string>()
    const { snapshots, saved, deps } = setup(attached)
    deps.capture = (id) => {
      attached.add(id)
      return Promise.resolve({ cols: 80, rows: 24, data: 'x' })
    }
    snapshots.touch('a')
    await vi.advanceTimersByTimeAsync(QUIET)
    expect(saved).toEqual([])
  })

  it('skips sessions the host no longer has, and empty screens', async () => {
    const { snapshots, saved, deps } = setup()
    deps.capture = (id) => Promise.resolve(id === 'gone' ? null : { cols: 80, rows: 24, data: '' })
    snapshots.touch('gone')
    snapshots.touch('empty')
    await vi.advanceTimersByTimeAsync(QUIET)
    expect(saved).toEqual([])
  })

  it('flushes pending screens at once when the daemon exits, and nothing twice', async () => {
    const { snapshots, saved } = setup()
    snapshots.touch('a')
    snapshots.touch('b')
    await snapshots.flush()
    expect(saved.map(([id]) => id).sort()).toEqual(['a', 'b'])
    await vi.advanceTimersByTimeAsync(QUIET)
    expect(saved).toHaveLength(2)
  })

  it('survives a failing capture or save', async () => {
    const { snapshots, deps } = setup()
    deps.capture = () => Promise.reject(new Error('boom'))
    snapshots.touch('a')
    await expect(snapshots.flush()).resolves.toBeUndefined()
    deps.capture = () => Promise.resolve({ cols: 80, rows: 24, data: 'x' })
    deps.save = () => {
      throw new Error('disk full')
    }
    snapshots.touch('a')
    await expect(snapshots.flush()).resolves.toBeUndefined()
  })
})

describe('daemon snapshot on disk', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tr-ptyd-snap-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("is the renderer's format: loads back and keeps a full-screen program's frame after the alt-screen marker", async () => {
    const mirror = new HeadlessMirror(40, 6)
    mirror.write('$ claude\r\nhello 你好\r\n')
    mirror.write('\x1b[?1049h\x1b[?2004h\x1b[Hframe line')
    const files = new TerminalSnapshotFiles(dir)
    const snapshots = new DiskSnapshots(QUIET, {
      capture: async () => {
        const { screen } = await mirror.capture()
        return { cols: screen.cols, rows: screen.rows, data: screen.data }
      },
      isAttached: () => false,
      save: (id, snapshot) => files.save(id, snapshot)
    })
    snapshots.touch('s1')
    await snapshots.flush()
    const loaded = await files.load('s1')
    expect(loaded).not.toBeNull()
    expect(loaded).toMatchObject({ cols: 40, rows: 6 })
    const data = loaded?.data ?? ''
    // snapshot-payload.ts splits on exactly this marker; modes (bracketed paste) are not part of the file.
    const alt = data.indexOf('\x1b[?1049h\x1b[H')
    expect(alt).toBeGreaterThan(data.indexOf('hello 你好'))
    expect(data.slice(alt)).toContain('frame line')
    expect(data).not.toContain('\x1b[?2004h')
    mirror.dispose()
  })
})
