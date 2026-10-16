import { mkdtempSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_SNAPSHOT_CHARS, TerminalSnapshotFiles } from './terminal-snapshot-file'

const snap = { cols: 80, rows: 24, data: '\x1b[1mhello\x1b[0m\r\nworld' }

describe('TerminalSnapshotFiles', () => {
  it('round-trips a snapshot', () => {
    const files = new TerminalSnapshotFiles(mkdtempSync(join(tmpdir(), 'tr-snap-')))
    files.save('s1', snap)
    expect(files.load('s1')).toEqual(snap)
    files.remove('s1')
    expect(files.load('s1')).toBeNull()
  })

  it('rejects bad ids and oversized or malformed payloads', () => {
    const files = new TerminalSnapshotFiles(mkdtempSync(join(tmpdir(), 'tr-snap-')))
    expect(() => files.save('../x', snap)).toThrow()
    expect(() => files.save('s1', { ...snap, data: 'x'.repeat(MAX_SNAPSHOT_CHARS + 1) })).toThrow()
    expect(() => files.save('s1', { cols: 0, rows: 24, data: '' })).toThrow()
    expect(files.load('../x')).toBeNull()
  })

  it('prunes old snapshots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tr-snap-'))
    const files = new TerminalSnapshotFiles(dir)
    files.save('old', snap)
    files.save('new', snap)
    const past = new Date(Date.now() - 40 * 24 * 3600 * 1000)
    utimesSync(join(dir, 'old.json'), past, past)
    files.pruneOlderThan(30 * 24 * 3600 * 1000)
    expect(readdirSync(dir)).toEqual(['new.json'])
  })
})
