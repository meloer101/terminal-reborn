import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceFileStore } from './workspace-file-store'

const file = {
  version: 2,
  projects: [{ id: 'p1', name: 'acme', rootPath: '/code/acme' }],
  worktrees: [{ id: 'w1', projectId: 'p1', branch: '', path: '/code/acme', isMain: true }],
  sessions: [{ id: 's1', worktreeId: 'w1', kind: 'claude', title: 'T', agentSessionId: 'abc', startedAt: 1, lastActivityAt: 2 }],
  activeSessionId: 's1',
  sidebarCollapsed: false,
  rightPanel: null,
  collapsedProjectIds: [],
  drafts: { s1: 'hi' }
}

let dir: string
let path: string
beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'tr-ws-'))
  path = join(dir, 'workspace.json')
})
afterEach(() => vi.useRealTimers())

describe('WorkspaceFileStore', () => {
  it('returns null when there is no file yet', () => {
    expect(new WorkspaceFileStore(path).load()).toBeNull()
  })

  it('coalesces saves within the window, then writes the latest atomically', () => {
    const store = new WorkspaceFileStore(path, { debounceMs: 300 })
    store.save({ ...file, drafts: { s1: 'first' } })
    vi.advanceTimersByTime(200)
    store.save({ ...file, drafts: { s1: 'second' } })
    vi.advanceTimersByTime(99)
    expect(existsSync(path)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(JSON.parse(readFileSync(path, 'utf8')).drafts).toEqual({ s1: 'second' })
    expect(readdirSync(dir)).toEqual(['workspace.json']) // no stray .tmp
    expect(new WorkspaceFileStore(path).load()).toEqual({ ...file, drafts: { s1: 'second' } })
  })

  it('flush writes immediately and cancels the timer', () => {
    const store = new WorkspaceFileStore(path)
    store.save(file)
    store.flush()
    expect(existsSync(path)).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(readdirSync(dir)).toEqual(['workspace.json'])
  })

  it('sanitizes what it is given and ignores payloads that are not a workspace', () => {
    const store = new WorkspaceFileStore(path)
    store.save('junk')
    store.save({ version: 1 })
    store.flush()
    expect(existsSync(path)).toBe(false)
    store.save({ ...file, sessions: [...file.sessions, { id: 'x', worktreeId: 'nope', kind: 'claude', title: 't' }] })
    store.flush()
    expect(JSON.parse(readFileSync(path, 'utf8')).sessions).toHaveLength(1)
  })

  it('backs up a corrupt file before it can be overwritten, and starts empty', () => {
    writeFileSync(path, '{truncated')
    const store = new WorkspaceFileStore(path, { now: () => 42 })
    expect(store.load()).toBeNull()
    expect(readFileSync(`${path}.bad-42`, 'utf8')).toBe('{truncated')
  })

  it('backs up a file from an unknown version', () => {
    writeFileSync(path, JSON.stringify({ ...file, version: 9 }))
    const store = new WorkspaceFileStore(path, { now: () => 7 })
    expect(store.load()).toBeNull()
    expect(existsSync(`${path}.bad-7`)).toBe(true)
  })

  it('reports a failed write without throwing', () => {
    const log = vi.fn()
    // A regular file where a directory should be makes the write fail.
    writeFileSync(join(dir, 'a'), 'not a directory')
    const store = new WorkspaceFileStore(join(dir, 'a', 'workspace.json'), { log })
    store.save(file)
    expect(() => store.flush()).not.toThrow()
    expect(log).toHaveBeenCalled()
  })
})
