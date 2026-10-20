import { describe, expect, it } from 'vitest'
import { MAIN_MIN_WIDTH, PANEL_INSET, panelMode, sidebarWidthFor } from './layout'

describe('panelMode', () => {
  it('docks when main keeps its minimum width', () => {
    expect(panelMode(1440, 264, 480)).toBe('docked') // 1440 − 264 − 488 = 688
    expect(panelMode(264 + 480 + PANEL_INSET + MAIN_MIN_WIDTH, 264, 480)).toBe('docked')
  })

  it('floats over main when docking would squeeze it', () => {
    expect(panelMode(1200, 264, 480)).toBe('overlay') // 448
    expect(panelMode(1440, 264, 700)).toBe('overlay') // 468
    expect(panelMode(264 + 480 + PANEL_INSET + MAIN_MIN_WIDTH - 1, 264, 480)).toBe('overlay')
  })

  it('counts the sidebar at its width, and not at all when hidden', () => {
    expect(panelMode(1100, 0, 480)).toBe('docked')
    expect(panelMode(1100, 264, 480)).toBe('overlay')
    expect(panelMode(1300, 200, 480)).toBe('docked') // 612
    expect(panelMode(1300, 300, 480)).toBe('overlay') // 512
  })
})

describe('sidebarWidthFor', () => {
  it('keeps the saved width while main has room', () => {
    expect(sidebarWidthFor(1440, 264)).toBe(264)
    expect(sidebarWidthFor(1440, 480)).toBe(480)
  })

  it('narrows the sidebar so main keeps its minimum, but not below the sidebar minimum', () => {
    expect(sidebarWidthFor(960, 480)).toBe(400) // 960 − 560
    expect(sidebarWidthFor(700, 480)).toBe(200)
  })
})
