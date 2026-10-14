import { describe, expect, it, vi } from 'vitest'
import { guarded } from './guard'

describe('guarded', () => {
  it('returns true when the operation completes', () => {
    const fn = vi.fn()
    expect(guarded('op', fn)).toBe(true)
    expect(fn).toHaveBeenCalled()
  })

  it('logs and swallows a throw so the host keeps serving', () => {
    const log = vi.fn()
    const boom = new Error('EBADF')
    expect(guarded('write s1', () => { throw boom }, log)).toBe(false)
    expect(log).toHaveBeenCalledWith('write s1', boom)
  })
})
