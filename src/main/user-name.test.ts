import { describe, expect, it } from 'vitest'
import { cleanFullName } from './user-name'

describe('cleanFullName', () => {
  it('keeps the first line, trimmed', () => {
    expect(cleanFullName('Jacoy\n')).toBe('Jacoy')
    expect(cleanFullName('  Jacob Yu  \nextra')).toBe('Jacob Yu')
  })

  it('answers empty for no name or an implausible one', () => {
    expect(cleanFullName('')).toBe('')
    expect(cleanFullName('\n')).toBe('')
    expect(cleanFullName('x'.repeat(65))).toBe('')
  })
})
