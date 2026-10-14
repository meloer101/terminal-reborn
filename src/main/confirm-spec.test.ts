import { describe, expect, it } from 'vitest'
import { parseConfirmOptions } from './confirm-spec'

describe('parseConfirmOptions', () => {
  it('accepts a well-formed request', () => {
    expect(parseConfirmOptions({ message: 'm', confirmLabel: '退出', cancelLabel: '取消', destructive: true })).toEqual({
      message: 'm',
      confirmLabel: '退出',
      cancelLabel: '取消',
      destructive: true
    })
  })
  it('rejects malformed payloads', () => {
    expect(() => parseConfirmOptions(null)).toThrow()
    expect(() => parseConfirmOptions({ message: '', confirmLabel: 'x' })).toThrow()
    expect(() => parseConfirmOptions({ message: 'm' })).toThrow()
    expect(() => parseConfirmOptions({ message: 'm', confirmLabel: 'x', destructive: 'yes' })).toThrow()
    expect(() => parseConfirmOptions({ message: 'm'.repeat(501), confirmLabel: 'x' })).toThrow()
  })
})
