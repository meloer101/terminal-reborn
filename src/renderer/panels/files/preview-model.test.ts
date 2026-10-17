import { describe, expect, it } from 'vitest'
import { MAX_PREVIEW_LINES, previewLines } from './preview-model'

describe('previewLines', () => {
  it('numbers lines and marks the changed ones', () => {
    const { rows, truncated } = previewLines('a\nb\nc\nd\n', [
      { from: 2, to: 2, kind: 'add' },
      { from: 4, to: 9, kind: 'mod' }
    ])
    expect(rows).toEqual([
      { number: 1, text: 'a', mark: null },
      { number: 2, text: 'b', mark: 'add' },
      { number: 3, text: 'c', mark: null },
      { number: 4, text: 'd', mark: 'mod' }
    ])
    expect(truncated).toBe(false)
  })

  it('marks every line of an untracked file and keeps an empty file as one line', () => {
    expect(previewLines('x\r\ny', 'all-added').rows.map((r) => r.mark)).toEqual(['add', 'add'])
    expect(previewLines('', []).rows).toEqual([{ number: 1, text: '', mark: null }])
  })

  it('expands tabs and stops at the line cap', () => {
    expect(previewLines('\tx', []).rows[0]!.text).toBe('  x')
    const long = previewLines('l\n'.repeat(MAX_PREVIEW_LINES + 5), [])
    expect(long.rows).toHaveLength(MAX_PREVIEW_LINES)
    expect(long.truncated).toBe(true)
  })
})
