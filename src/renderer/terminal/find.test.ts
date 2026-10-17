import { describe, expect, it } from 'vitest'
import { findStatus, isFindShortcut } from './find'

describe('findStatus', () => {
  it.each<[string, { resultIndex: number; resultCount: number } | null, string]>([
    ['', null, ''],
    ['x', null, ''],
    ['x', { resultIndex: -1, resultCount: 0 }, '无结果'],
    ['x', { resultIndex: 2, resultCount: 12 }, '3/12'],
    ['x', { resultIndex: -1, resultCount: 1000 }, '1000+']
  ])('%j %j → %j', (query, results, expected) => {
    expect(findStatus(query, results)).toBe(expected)
  })
})

describe('isFindShortcut', () => {
  const key = (extra: Partial<KeyboardEvent>) => ({ key: 'f', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...extra })
  it('is ⌘F only', () => {
    expect(isFindShortcut(key({}))).toBe(true)
    expect(isFindShortcut(key({ key: 'F' }))).toBe(true)
    expect(isFindShortcut(key({ shiftKey: true }))).toBe(false)
    expect(isFindShortcut(key({ metaKey: false, ctrlKey: true }))).toBe(false)
  })
})
