// The IPC side of the workspace store: snapshots that arrive once the quit goes ahead are written at once.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const dir = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tr-ws-store-'))
})
const handlers = vi.hoisted(() => new Map<string, (event: unknown, raw?: unknown) => void>())
vi.mock('electron', () => ({
  app: { getPath: () => dir, on: () => {} },
  ipcMain: { on: (channel: string, handler: (event: unknown, raw?: unknown) => void) => handlers.set(channel, handler) }
}))

const { IPC } = await import('@shared/ipc')
const { registerWorkspaceStore, workspaceQuitting } = await import('./workspace-store')

const file = (draft: string) => ({
  version: 2,
  projects: [{ id: 'p1', name: 'acme', rootPath: '/code/acme' }],
  worktrees: [{ id: 'w1', projectId: 'p1', branch: '', path: '/code/acme', isMain: true }],
  sessions: [{ id: 's1', worktreeId: 'w1', kind: 'claude', title: 'T', startedAt: 1, lastActivityAt: 2 }],
  activeSessionId: 's1',
  sidebarCollapsed: false,
  rightPanel: null,
  collapsedProjectIds: [],
  drafts: { s1: draft }
})

describe('workspace store during quit', () => {
  it('debounces before the quit, and writes a snapshot that arrives after it at once', () => {
    registerWorkspaceStore()
    const path = join(dir, 'workspace.json')
    const save = handlers.get(IPC.workspaceSave)!
    save({}, file('before'))
    expect(existsSync(path)).toBe(false)
    workspaceQuitting()
    expect(JSON.parse(readFileSync(path, 'utf8')).drafts.s1).toBe('before')
    // A window closing during the quit sends its last snapshot now.
    save({}, file('closing'))
    expect(JSON.parse(readFileSync(path, 'utf8')).drafts.s1).toBe('closing')
  })
})
