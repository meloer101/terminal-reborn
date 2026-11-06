import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const save = vi.fn()
let unload: (() => void) | null = null

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  save.mockClear()
  unload = null
  vi.stubGlobal('window', {
    tr: { workspace: { loadSync: () => null, save } },
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'beforeunload') unload = listener
    }
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function load() {
  const persistence = await import('./persistence')
  let n = 0
  persistence.setSnapshotProvider(() => ({ n: ++n }) as never)
  return persistence
}

describe('requestSave', () => {
  it('sends one snapshot for a burst of saves (a drag asks on every pointer move)', async () => {
    const { requestSave, SAVE_COALESCE_MS } = await load()
    for (let i = 0; i < 120; i++) requestSave()
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SAVE_COALESCE_MS)
    expect(save).toHaveBeenCalledTimes(1)
    requestSave()
    vi.advanceTimersByTime(SAVE_COALESCE_MS)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('sends what is still waiting when the window goes away', async () => {
    const { requestSave } = await load()
    requestSave()
    unload?.()
    expect(save).toHaveBeenCalledTimes(1)
    vi.runAllTimers()
    expect(save).toHaveBeenCalledTimes(1)
  })
})
