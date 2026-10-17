import { describe, expect, it } from 'vitest'
import { MAIN_MIN_WIDTH, PANEL_INSET, panelMode } from './layout'

describe('panelMode', () => {
  it('docks when main keeps its minimum width', () => {
    expect(panelMode(1440, true, 480)).toBe('docked') // 1440 − 264 − 488 = 688
    expect(panelMode(264 + 480 + PANEL_INSET + MAIN_MIN_WIDTH, true, 480)).toBe('docked')
  })

  it('floats over main when docking would squeeze it', () => {
    expect(panelMode(1200, true, 480)).toBe('overlay') // 448
    expect(panelMode(1440, true, 700)).toBe('overlay') // 468
    expect(panelMode(264 + 480 + PANEL_INSET + MAIN_MIN_WIDTH - 1, true, 480)).toBe('overlay')
  })

  it('counts the sidebar only when it is shown', () => {
    expect(panelMode(1100, false, 480)).toBe('docked')
    expect(panelMode(1100, true, 480)).toBe('overlay')
  })
})

