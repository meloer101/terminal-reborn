import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filesOf, openRoot, setExpanded, setNotice, showPreview } from './store'

describe('setNotice', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a line for a few seconds, per worktree root', () => {
    setNotice('/repo', '没有插入路径：终端里有选择框，请先在终端中处理')
    expect(filesOf('/repo').notice).toBe('没有插入路径：终端里有选择框，请先在终端中处理')
    expect(filesOf('/other').notice).toBeNull()
    vi.advanceTimersByTime(5_000)
    expect(filesOf('/repo').notice).not.toBeNull()
    vi.advanceTimersByTime(1_500)
    expect(filesOf('/repo').notice).toBeNull()
  })

  it('a newer notice restarts the time, and null clears it at once', () => {
    setNotice('/repo', '一')
    vi.advanceTimersByTime(4_000)
    setNotice('/repo', '二')
    vi.advanceTimersByTime(4_000)
    expect(filesOf('/repo').notice).toBe('二')
    setNotice('/repo', null)
    expect(filesOf('/repo').notice).toBeNull()
    vi.advanceTimersByTime(10_000)
    expect(filesOf('/repo').notice).toBeNull()
  })
})

describe('openRoot', () => {
  const listDir = vi.fn(async (_root: string, dir: string) => (dir === '' ? [{ name: 'a', dir: true }, { name: 'plan.md', dir: false }] : [{ name: 'b.txt', dir: false }]))
  beforeEach(() => {
    listDir.mockClear()
    vi.stubGlobal('window', { tr: { worktree: { listDir, gitStatus: vi.fn(async () => null) } } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists the top level when a terminal file link opened the preview before the view', async () => {
    showPreview('/linked', 'plan.md')
    openRoot('/linked')
    await vi.waitFor(() => expect(filesOf('/linked').children['']).toHaveLength(2))
  })

  it('reloads what is loaded on reopen, since nothing watched it while closed', async () => {
    openRoot('/reopened')
    setExpanded('/reopened', 'a', true)
    await vi.waitFor(() => expect(filesOf('/reopened').children.a).toBeDefined())
    listDir.mockClear()
    openRoot('/reopened')
    expect(listDir.mock.calls.map(([, dir]) => dir).sort()).toEqual(['', 'a'])
  })
})
