import { describe, expect, it } from 'vitest'
import { MAIN_MIN_WIDTH, panelMode } from './layout'

describe('panelMode', () => {
  it('docks the panel while main keeps its minimum width', () => {
    expect(panelMode(1440, true, 'changes')).toBe('docked') // 1440 − 264 − 440 = 736
    expect(panelMode(264 + 440 + MAIN_MIN_WIDTH, true, 'changes')).toBe('docked')
    expect(panelMode(1440, true, 'graph')).toBe('docked') // 616
  })

  it('floats the panel over main when docking would squeeze it (the 960×600 minimum window)', () => {
    expect(panelMode(960, true, 'changes')).toBe('overlay')
    expect(panelMode(960, true, 'graph')).toBe('overlay')
    expect(panelMode(1300, true, 'graph')).toBe('overlay') // 1300 − 264 − 560 = 476
  })

  it('a hidden sidebar leaves room to dock', () => {
    expect(panelMode(1100, false, 'changes')).toBe('docked')
    expect(panelMode(1100, true, 'changes')).toBe('overlay')
  })
})
