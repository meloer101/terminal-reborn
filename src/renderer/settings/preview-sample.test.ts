import { describe, expect, it } from 'vitest'
import { cellWidth, SAMPLE_LINES, sampleRows } from './preview-sample'

describe('cellWidth', () => {
  it('counts CJK and fullwidth punctuation as two cells', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('中文')).toBe(4)
    expect(cellWidth('，。')).toBe(4)
    expect(cellWidth('● ⎿ ┌─┐ ✻ …')).toBe(11)
  })
})

describe('sampleRows', () => {
  it('is one row per line when the terminal is wide enough', () => {
    expect(sampleRows(200)).toBe(SAMPLE_LINES.length)
  })
  it('counts soft wraps when narrow', () => {
    expect(sampleRows(40)).toBeGreaterThan(SAMPLE_LINES.length)
    expect(sampleRows(20)).toBeGreaterThan(sampleRows(40))
  })
})
