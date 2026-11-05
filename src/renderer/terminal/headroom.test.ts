import { describe, expect, it } from 'vitest'
import { blankBottomRows, headroomFor, type HeadroomInput } from './headroom'

const base: HeadroomInput = { headroom: 36, padTop: 12, cellHeight: 17, alt: false, baseY: 0, viewportY: 0, blankRows: 0 }

describe('headroomFor', () => {
  it('keeps a short output clear of the header', () => {
    expect(headroomFor({ ...base, blankRows: 20 })).toEqual({ shift: 36, under: false, alt: false })
  })

  it('lets the grid rise as the blank rows run out, blurring once text reaches under the header', () => {
    expect(headroomFor({ ...base, blankRows: 2 })).toEqual({ shift: 34, under: false, alt: false })
    expect(headroomFor({ ...base, blankRows: 1 })).toEqual({ shift: 17, under: true, alt: false })
    expect(headroomFor({ ...base, blankRows: 0 })).toEqual({ shift: 0, under: true, alt: false })
  })

  it('scrolls old output under the header once there is more than a screen', () => {
    expect(headroomFor({ ...base, baseY: 40, viewportY: 40 })).toEqual({ shift: 0, under: true, alt: false })
    expect(headroomFor({ ...base, baseY: 40, viewportY: 12 })).toEqual({ shift: 0, under: true, alt: false })
  })

  it('shows the very first lines in full when scrolled back to them', () => {
    expect(headroomFor({ ...base, baseY: 40, viewportY: 0 })).toEqual({ shift: 36, under: false, alt: false })
  })

  it('gives a full-screen program the rows below the header', () => {
    expect(headroomFor({ ...base, alt: true, baseY: 40, viewportY: 40 })).toEqual({ shift: 0, under: false, alt: true })
  })

  it('does nothing without a header or before the grid is measured', () => {
    const none = { shift: 0, under: false, alt: false }
    expect(headroomFor({ ...base, headroom: 0, baseY: 40, viewportY: 40 })).toEqual(none)
    expect(headroomFor({ ...base, cellHeight: 0, blankRows: 5 })).toEqual(none)
    expect(headroomFor({ ...base, headroom: 0, alt: true })).toEqual(none)
  })
})

describe('blankBottomRows', () => {
  const buffer = (lines: string[], cursorY: number, baseY = 0) => ({
    baseY,
    cursorY,
    getLine: (y: number) => {
      const text = lines[y]
      return text === undefined ? undefined : ({ translateToString: (trim?: boolean) => (trim ? text.trimEnd() : text) } as never)
    }
  })

  it('counts the blank rows under the last text, up to max', () => {
    expect(blankBottomRows(buffer(['a', 'b', '', '', '', ''], 1), 6, 3)).toBe(3)
    expect(blankBottomRows(buffer(['a', 'b', '', '  ', '', ''], 1), 6, 10)).toBe(4)
  })

  it('stops at text near the bottom', () => {
    expect(blankBottomRows(buffer(['a', '', '', 'status', ''], 0), 5, 4)).toBe(1)
  })

  it('never counts the cursor row or above', () => {
    expect(blankBottomRows(buffer(['a', '', '', ''], 2), 4, 4)).toBe(1)
    expect(blankBottomRows(buffer(['a', '', '', ''], 3), 4, 4)).toBe(0)
  })

  it('reads the screen, not the scrollback', () => {
    expect(blankBottomRows(buffer(['old', 'old', 'a', '', ''], 0, 2), 3, 4)).toBe(2)
  })
})
