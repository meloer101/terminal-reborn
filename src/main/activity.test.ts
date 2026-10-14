import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { on: vi.fn() } }))

import { parseActivity } from './activity'

describe('parseActivity', () => {
  it('floors and bounds the count', () => {
    expect(parseActivity({ active: 2.9 })).toEqual({ active: 2 })
    expect(parseActivity({ active: 1e9 }).active).toBe(10_000)
  })
  it('rejects malformed reports', () => {
    expect(() => parseActivity(null)).toThrow()
    expect(() => parseActivity({ active: -1 })).toThrow()
    expect(() => parseActivity({ active: 'x' })).toThrow()
    expect(() => parseActivity({ active: Number.NaN })).toThrow()
  })
})
