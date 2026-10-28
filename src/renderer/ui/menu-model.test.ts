import { describe, expect, it } from 'vitest'
import { formatAccelerator, MENU_GAP, MENU_INSET, MENU_MARGIN, placeMenu, stepIndex, type MenuEntry } from './menu-model'

const viewport = { width: 1000, height: 800 }
const size = { width: 200, height: 120 }

describe('placeMenu', () => {
  it('opens at the pointer, flipping away from the right and bottom edges', () => {
    expect(placeMenu(size, { kind: 'point', x: 100, y: 100 }, viewport)).toEqual({ left: 100, top: 100 })
    expect(placeMenu(size, { kind: 'point', x: 900, y: 750 }, viewport)).toEqual({ left: 700, top: 630 })
  })

  it('opens under a control, left-aligned, or right-aligned / above when that does not fit', () => {
    const box = { left: 40, top: 10, right: 64, bottom: 34 }
    expect(placeMenu(size, { kind: 'below', box }, viewport)).toEqual({ left: 40, top: 34 + MENU_GAP })
    const corner = { left: 960, top: 760, right: 984, bottom: 784 }
    expect(placeMenu(size, { kind: 'below', box: corner }, viewport)).toEqual({ left: 784, top: 760 - MENU_GAP - 120 })
  })

  it('opens a submenu beside its row, on the left when the right side is full', () => {
    const row = { left: 300, top: 200, right: 480, bottom: 228 }
    expect(placeMenu(size, { kind: 'beside', box: row }, viewport)).toEqual({ left: 480 + MENU_GAP / 2, top: 200 - MENU_INSET })
    const nearEdge = { left: 700, top: 200, right: 880, bottom: 228 }
    expect(placeMenu(size, { kind: 'beside', box: nearEdge }, viewport).left).toBe(700 - MENU_GAP / 2 - 200)
  })

  it('never leaves the window margin, even when the window is too small', () => {
    expect(placeMenu(size, { kind: 'point', x: 2, y: 2 }, viewport)).toEqual({ left: MENU_MARGIN, top: MENU_MARGIN })
    expect(placeMenu(size, { kind: 'point', x: 50, y: 50 }, { width: 100, height: 100 })).toEqual({ left: MENU_MARGIN, top: MENU_MARGIN })
  })
})

describe('formatAccelerator', () => {
  it('renders macOS symbols in the standard modifier order', () => {
    expect(formatAccelerator('CmdOrCtrl+N')).toBe('⌘N')
    expect(formatAccelerator('CmdOrCtrl+W')).toBe('⌘W')
    expect(formatAccelerator('Shift+CmdOrCtrl+a')).toBe('⇧⌘A')
    expect(formatAccelerator('Cmd+Alt+Ctrl+K')).toBe('⌃⌥⌘K')
    expect(formatAccelerator('CmdOrCtrl+,')).toBe('⌘,')
  })
})

describe('stepIndex', () => {
  const entries: MenuEntry[] = [
    { type: 'item', id: 'a', label: 'A' },
    { type: 'item', id: 'b', label: 'B', enabled: false },
    { type: 'submenu', label: 'C', items: [] }
  ]

  it('skips disabled items, and wraps', () => {
    expect(stepIndex(entries, -1, 1)).toBe(0)
    expect(stepIndex(entries, 0, 1)).toBe(2)
    expect(stepIndex(entries, 2, 1)).toBe(0)
    expect(stepIndex(entries, 0, -1)).toBe(2)
    expect(stepIndex(entries, entries.length, -1)).toBe(2)
  })

  it('returns -1 when nothing can be chosen', () => {
    expect(stepIndex([{ type: 'item', id: 'x', label: 'X', enabled: false }], -1, 1)).toBe(-1)
    expect(stepIndex([], -1, 1)).toBe(-1)
  })
})
