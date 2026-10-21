import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filesOf, setNotice } from './store'

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
