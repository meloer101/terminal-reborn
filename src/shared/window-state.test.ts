import { describe, expect, it } from 'vitest'
import { sanitizeWindowState } from './window-state'

const limits = { minWidth: 960, minHeight: 600 }
const screen = { x: 0, y: 25, width: 1920, height: 1055 }
const second = { x: 1920, y: 0, width: 1440, height: 900 }

const saved = (bounds: unknown, extra: object = {}) => ({ bounds, maximized: false, fullScreen: false, ...extra })

describe('sanitizeWindowState', () => {
  it('restores bounds that are on a display', () => {
    expect(sanitizeWindowState(saved({ x: 100, y: 80, width: 1200, height: 800 }), [screen], limits)).toEqual({
      bounds: { x: 100, y: 80, width: 1200, height: 800 },
      maximized: false,
      fullScreen: false
    })
  })

  it('keeps maximized and full-screen flags', () => {
    const state = sanitizeWindowState(saved({ x: 0, y: 25, width: 1200, height: 800 }, ), [screen], limits)
    expect(state?.maximized).toBe(false)
    expect(sanitizeWindowState(saved({ x: 0, y: 25, width: 1200, height: 800 }, { maximized: true, fullScreen: true }), [screen], limits)).toMatchObject({
      maximized: true,
      fullScreen: true
    })
  })

  it('drops the position when the display it was on is gone, keeping the size', () => {
    expect(sanitizeWindowState(saved({ x: 2500, y: 100, width: 1200, height: 800 }), [screen], limits)?.bounds).toEqual({ width: 1200, height: 800 })
    expect(sanitizeWindowState(saved({ x: 2500, y: 100, width: 1200, height: 800 }), [screen, second], limits)?.bounds).toMatchObject({ x: 2500 })
  })

  it('treats a sliver at the edge as unreachable', () => {
    expect(sanitizeWindowState(saved({ x: 1900, y: 100, width: 1200, height: 800 }), [screen], limits)?.bounds).toEqual({ width: 1200, height: 800 })
  })

  it('clamps the size to the minimum and to the largest display', () => {
    expect(sanitizeWindowState(saved({ x: 0, y: 25, width: 100, height: 100 }), [screen], limits)?.bounds).toEqual({ x: 0, y: 25, width: 960, height: 600 })
    expect(sanitizeWindowState(saved({ x: 0, y: 25, width: 9000, height: 9000 }), [screen], limits)?.bounds).toEqual({ x: 0, y: 25, width: 1920, height: 1055 })
  })

  it('returns null for junk and tolerates a missing position', () => {
    expect(sanitizeWindowState(null, [screen], limits)).toBeNull()
    expect(sanitizeWindowState('x', [screen], limits)).toBeNull()
    expect(sanitizeWindowState({ bounds: { width: 'a', height: 5 } }, [screen], limits)).toBeNull()
    expect(sanitizeWindowState(saved({ width: 1200, height: 800 }), [screen], limits)?.bounds).toEqual({ width: 1200, height: 800 })
    expect(sanitizeWindowState(saved({ x: NaN, y: 1, width: 1200, height: 800 }), [screen], limits)?.bounds).toEqual({ width: 1200, height: 800 })
  })
})
