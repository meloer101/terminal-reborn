import { describe, expect, it } from 'vitest'
import { MAIN_MIN_WIDTH, PANEL_INSET, WINDOW_INSET, panelMode, panelWidthFor, sidebarWidthFor } from './layout'

describe('panelMode', () => {
  it('docks when main keeps its minimum width', () => {
    expect(panelMode(1440, 264, 480)).toBe('docked') // 1440 − 264 − 6 − 486 = 684
    expect(panelMode(264 + 480 + PANEL_INSET + WINDOW_INSET + MAIN_MIN_WIDTH, 264, 480)).toBe('docked')
  })

  it('floats over main when docking would squeeze it', () => {
    expect(panelMode(1200, 264, 480)).toBe('overlay') // 448
    expect(panelMode(1440, 264, 700)).toBe('overlay') // 468
    expect(panelMode(264 + 480 + PANEL_INSET + WINDOW_INSET + MAIN_MIN_WIDTH - 1, 264, 480)).toBe('overlay')
  })

  it('counts the sidebar at its width, and not at all when hidden', () => {
    expect(panelMode(1100, 0, 480)).toBe('docked')
    expect(panelMode(1100, 264, 480)).toBe('overlay')
    expect(panelMode(1300, 200, 480)).toBe('docked') // 608
    expect(panelMode(1300, 300, 480)).toBe('overlay') // 508
  })

  it('keeps the glass at the window edge out of main minimum: one side with the sidebar, both without', () => {
    expect(panelMode(264 + 480 + PANEL_INSET + WINDOW_INSET + MAIN_MIN_WIDTH, 264, 480)).toBe('docked')
    expect(panelMode(480 + PANEL_INSET + 2 * WINDOW_INSET + MAIN_MIN_WIDTH, 0, 480)).toBe('docked')
    expect(panelMode(480 + PANEL_INSET + 2 * WINDOW_INSET + MAIN_MIN_WIDTH - 1, 0, 480)).toBe('overlay')
  })
})

describe('sidebarWidthFor', () => {
  it('keeps the saved width while main has room', () => {
    expect(sidebarWidthFor(1440, 264)).toBe(264)
    expect(sidebarWidthFor(1440, 480)).toBe(480)
  })

  it('narrows the sidebar so main keeps its minimum, but not below the sidebar minimum', () => {
    expect(sidebarWidthFor(960, 480)).toBe(394) // 960 − 6 − 560
    expect(sidebarWidthFor(700, 480)).toBe(200)
  })
})

describe('panelWidthFor', () => {
  it('keeps the saved width while main has room', () => {
    expect(panelWidthFor(1440, 264, 480)).toBe(480)
  })

  it('narrows the panel so main keeps its minimum, instead of floating over it', () => {
    // The author's case: 1470 wide, sidebar 200, the panel dragged to 830 — it docks at 704, main keeps 560.
    const shown = panelWidthFor(1470, 200, 830)
    expect(shown).toBe(1470 - 200 - WINDOW_INSET - PANEL_INSET - MAIN_MIN_WIDTH)
    expect(panelMode(1470, 200, shown)).toBe('docked')
  })

  it('floats only when not even the panel minimum fits', () => {
    expect(panelWidthFor(1100, 264, 480)).toBe(400) // 1100 − 264 − 12 − 560 = 264, below the minimum
    expect(panelMode(1100, 264, panelWidthFor(1100, 264, 480))).toBe('overlay')
  })
})
