import { describe, expect, it } from 'vitest'
import { drawerIsWide, drawerPhaseFor } from './drawer-motion'

describe('drawerPhaseFor', () => {
  it('opens a closed drawer through one layout at width 0', () => {
    expect(drawerPhaseFor('closed', true)).toBe('enter')
  })
  it('turns a closing drawer straight back around', () => {
    expect(drawerPhaseFor('closing', true)).toBe('opening')
  })
  it('closes from any open phase', () => {
    for (const phase of ['enter', 'opening', 'open'] as const) expect(drawerPhaseFor(phase, false)).toBe('closing')
  })
  it('leaves a drawer alone when it already heads where it is asked to', () => {
    for (const phase of ['enter', 'opening', 'open'] as const) expect(drawerPhaseFor(phase, true)).toBeNull()
    for (const phase of ['closed', 'closing'] as const) expect(drawerPhaseFor(phase, false)).toBeNull()
  })
})

describe('drawerIsWide', () => {
  it('is wide only while opening or open', () => {
    expect(['closed', 'enter', 'opening', 'open', 'closing'].filter((p) => drawerIsWide(p as never))).toEqual(['opening', 'open'])
  })
})
