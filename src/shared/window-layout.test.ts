import { describe, expect, it } from 'vitest'
import { pane, PICKER_PANE, sessionsIn, splitPane, type SplitNode } from './split-layout'
import {
  closeWindow,
  EMPTY_VIEW,
  focusWindow,
  isSecondaryKey,
  keyFromFrameName,
  MAIN_WINDOW,
  MAX_WINDOWS,
  newWindowKey,
  openWindow,
  patchWindow,
  reconcileWindows,
  restoreWindows,
  sanitizeBounds,
  sanitizeWindows,
  serializeWindows,
  shownAnywhere,
  SINGLE_WINDOW,
  takeFromOthers,
  viewOf,
  windowShowing,
  withoutSession,
  type PaneView,
  type SecondaryWindow,
  type Windowed
} from './window-layout'

const two = (a: string, b: string): SplitNode => splitPane(pane(a), a, 'right', b)
const three = (): SplitNode => splitPane(two('a', 'b'), 'b', 'bottom', 'c')
const win = (key: string, projectId: string | null = 'p1'): SecondaryWindow => ({ key, projectId, sidebarCollapsed: false })
const single = (id: string | null): PaneView => ({ split: null, activeSessionId: id })

/** Main shows a | b, the keyboard in a. */
const start = (): Windowed => ({ layout: SINGLE_WINDOW, top: { split: two('a', 'b'), activeSessionId: 'a' } })

describe('window keys', () => {
  it('reads only well-formed frame names', () => {
    expect(keyFromFrameName('wavi-window:w-abc123')).toBe('w-abc123')
    expect(keyFromFrameName('wavi-window:main')).toBeNull()
    expect(keyFromFrameName('wavi-window:w-../x')).toBeNull()
    expect(keyFromFrameName('_blank')).toBeNull()
    expect(keyFromFrameName('w-abc')).toBeNull()
  })

  it('makes fresh keys that pass the check', () => {
    for (let i = 0; i < 20; i++) expect(isSecondaryKey(newWindowKey())).toBe(true)
    expect(isSecondaryKey(newWindowKey(() => 0))).toBe(true)
  })
})

describe('withoutSession', () => {
  it('empties a lone pane and leaves other views alone', () => {
    expect(withoutSession(single('a'), 'a')).toEqual(EMPTY_VIEW)
    const view = single('b')
    expect(withoutSession(view, 'a')).toBe(view)
  })

  it('closes up a split and keeps the keyboard where it was', () => {
    expect(withoutSession({ split: three(), activeSessionId: 'a' }, 'c')).toEqual({ split: two('a', 'b'), activeSessionId: 'a' })
  })

  it('moves the keyboard to the pane that took over', () => {
    const next = withoutSession({ split: three(), activeSessionId: 'c' }, 'c')
    expect(sessionsIn(next.split)).toEqual(['a', 'b'])
    expect(next.activeSessionId).toBe('b')
  })

  it('drops the split when one pane is left', () => {
    expect(withoutSession({ split: two('a', 'b'), activeSessionId: 'a' }, 'a')).toEqual(single('b'))
  })

  it('drops a split left with only the picker', () => {
    const split = splitPane(pane('a'), 'a', 'right', PICKER_PANE)
    expect(withoutSession({ split, activeSessionId: 'a' }, 'a')).toEqual(EMPTY_VIEW)
  })
})

describe('openWindow / focusWindow / closeWindow', () => {
  it('moves a pane out into a new window that takes the keyboard', () => {
    const next = openWindow(start(), win('w-1'), 'b')
    expect(next.layout.keyWindow).toBe('w-1')
    expect(next.top).toEqual(single('b'))
    expect(viewOf(next, MAIN_WINDOW)).toEqual(single('a'))
    expect(windowShowing(next, 'b')).toBe('w-1')
    expect(windowShowing(next, 'a')).toBe(MAIN_WINDOW)
    expect(shownAnywhere(next).sort()).toEqual(['a', 'b'])
  })

  it('opens an empty window for a project', () => {
    const next = openWindow(start(), win('w-1'), null)
    expect(next.top).toEqual(EMPTY_VIEW)
    expect(viewOf(next, MAIN_WINDOW)).toEqual(start().top)
  })

  it('takes a session from another secondary window when moving it to a new one', () => {
    const one = openWindow(start(), win('w-1'), 'b')
    const back = focusWindow(one, MAIN_WINDOW)
    const two = openWindow(back, win('w-2'), 'b')
    expect(viewOf(two, 'w-1')).toEqual(EMPTY_VIEW)
    expect(viewOf(two, 'w-2')).toEqual(single('b'))
  })

  it('refuses a duplicate key and the window limit', () => {
    const one = openWindow(start(), win('w-1'), null)
    expect(openWindow(one, win('w-1'), 'a')).toBe(one)
    let many = start()
    for (let i = 0; i < MAX_WINDOWS; i++) many = openWindow(many, win(`w-${i}`), null)
    expect(openWindow(many, win('w-x'), null)).toBe(many)
  })

  it('trades panes when the keyboard moves between windows', () => {
    const opened = openWindow(start(), win('w-1'), 'b')
    const main = focusWindow(opened, MAIN_WINDOW)
    expect(main.layout.keyWindow).toBe(MAIN_WINDOW)
    expect(main.top).toEqual(single('a'))
    expect(main.layout.views['w-1']).toEqual(single('b'))
    expect(main.layout.views[MAIN_WINDOW]).toBeUndefined()
    expect(focusWindow(main, MAIN_WINDOW)).toBe(main)
    expect(focusWindow(main, 'w-unknown')).toBe(main)
    expect(focusWindow(main, 'w-1')).toEqual(opened)
  })

  it('closing a window shows its sessions nowhere and hands the keyboard to the main window', () => {
    const opened = openWindow(start(), win('w-1'), 'b')
    const closed = closeWindow(opened, 'w-1')
    expect(closed.layout).toEqual(SINGLE_WINDOW)
    expect(closed.top).toEqual(single('a'))
    expect(windowShowing(closed, 'b')).toBeNull()
    expect(closeWindow(closed, MAIN_WINDOW)).toBe(closed)
  })

  it('closing a window that is not the key one keeps the keyboard', () => {
    const opened = focusWindow(openWindow(start(), win('w-1'), 'b'), MAIN_WINDOW)
    const closed = closeWindow(opened, 'w-1')
    expect(closed.top).toBe(opened.top)
    expect(closed.layout.windows).toEqual([])
  })

  it('takeFromOthers leaves the key window and unchanged layouts alone', () => {
    const opened = focusWindow(openWindow(start(), win('w-1'), 'b'), MAIN_WINDOW)
    expect(takeFromOthers(opened.layout, 'z')).toBe(opened.layout)
    expect(takeFromOthers(opened.layout, 'b').views['w-1']).toEqual(EMPTY_VIEW)
  })

  it('patchWindow changes one record and skips no-ops', () => {
    const { layout } = openWindow(start(), win('w-1'), null)
    expect(patchWindow(layout, 'w-1', { sidebarCollapsed: false })).toBe(layout)
    expect(patchWindow(layout, 'w-1', { sidebarCollapsed: true }).windows[0]?.sidebarCollapsed).toBe(true)
    expect(patchWindow(layout, 'w-none', { sidebarCollapsed: true })).toBe(layout)
  })
})

describe('reconcileWindows', () => {
  const all = (): boolean => true

  it('closes the panes of sessions that are gone in the other windows', () => {
    const opened = focusWindow(openWindow({ layout: SINGLE_WINDOW, top: { split: three(), activeSessionId: 'a' } }, win('w-1'), 'c'), MAIN_WINDOW)
    const next = reconcileWindows(opened, (id) => id !== 'c', all)
    expect(viewOf(next, 'w-1')).toEqual(EMPTY_VIEW)
  })

  it('never shows a session twice: the key window gives way', () => {
    const opened = openWindow(start(), win('w-1'), 'b')
    // The key window (w-1) picked `a` by itself, which the main window still shows.
    const clash: Windowed = { ...opened, top: single('a') }
    const next = reconcileWindows(clash, all, all)
    expect(next.top).toEqual(EMPTY_VIEW)
    expect(viewOf(next, MAIN_WINDOW)).toEqual(single('a'))
  })

  it('closes windows of removed projects', () => {
    const opened = openWindow(start(), win('w-1', 'gone'), 'b')
    const next = reconcileWindows(opened, all, (id) => id !== 'gone')
    expect(next.layout.windows).toEqual([])
    expect(next.layout.keyWindow).toBe(MAIN_WINDOW)
  })

  it('returns the same state when nothing changes', () => {
    const opened = openWindow(start(), win('w-1'), 'b')
    expect(reconcileWindows(opened, all, all)).toBe(opened)
  })
})

describe('workspace.json', () => {
  const context = (taken: string[] = [], listed = ['a', 'b', 'c', 'd']) => ({
    listed: (id: string) => listed.includes(id),
    projectExists: (id: string) => id === 'p1',
    taken: new Set(taken)
  })

  it('round-trips windows, whichever window has the keyboard', () => {
    const opened = openWindow(start(), { ...win('w-1'), bounds: { x: 10, y: 20, width: 900, height: 600 }, fullScreen: true, sidebarCollapsed: true }, 'b')
    const saved = serializeWindows(opened)
    expect(saved.main).toEqual(single('a'))
    expect(saved.windows).toEqual([
      { key: 'w-1', projectId: 'p1', activeSessionId: 'b', sidebarCollapsed: true, bounds: { x: 10, y: 20, width: 900, height: 600 }, fullScreen: true }
    ])
    const read = sanitizeWindows(JSON.parse(JSON.stringify(saved.windows)), context(['a']))
    expect(read).toEqual(saved.windows)
    const layout = restoreWindows(read)
    expect(layout.keyWindow).toBe(MAIN_WINDOW)
    expect(layout.views['w-1']).toEqual(single('b'))
    expect(layout.windows[0]).toEqual({ key: 'w-1', projectId: 'p1', sidebarCollapsed: true, bounds: { x: 10, y: 20, width: 900, height: 600 }, fullScreen: true })
    expect(serializeWindows(focusWindow(opened, MAIN_WINDOW))).toEqual(saved)
  })

  it('saves a split without its picker', () => {
    const withPicker = splitPane(two('c', 'd'), 'd', 'bottom', PICKER_PANE)
    const state = openWindow(start(), win('w-1'), null)
    const saved = serializeWindows({ ...state, top: { split: withPicker, activeSessionId: 'c' } })
    expect(saved.windows[0]?.split).toEqual(two('c', 'd'))
    const lone = serializeWindows({ ...state, top: { split: splitPane(pane('c'), 'c', 'right', PICKER_PANE), activeSessionId: PICKER_PANE } })
    expect(lone.windows[0]).toEqual({ key: 'w-1', projectId: 'p1', activeSessionId: 'c' })
  })

  it('reads an old single-window file as no secondary windows', () => {
    expect(sanitizeWindows(undefined, context())).toEqual([])
    expect(restoreWindows(undefined)).toBe(SINGLE_WINDOW)
  })

  it('drops malformed windows, duplicate keys, unknown projects and sessions shown elsewhere', () => {
    const read = sanitizeWindows(
      [
        null,
        { key: 'main' },
        { key: 'w-1', projectId: 'p1', activeSessionId: 'a' },
        { key: 'w-1', projectId: 'p1' },
        { key: 'w-2', projectId: 'gone' },
        { key: 'w-3', projectId: 7 },
        { key: 'w-4', split: { type: 'split', dir: 'row', children: [pane('b'), pane('c')], sizes: [0.5, 0.5] }, activeSessionId: 'x' },
        { key: 'w-5', activeSessionId: 'c' },
        { key: 'w-6', activeSessionId: 'zzz', bounds: { x: 'no' } }
      ],
      context(['a'])
    )
    expect(read).toEqual([
      { key: 'w-1', projectId: 'p1' },
      { key: 'w-4', activeSessionId: 'b', split: two('b', 'c') },
      { key: 'w-5' },
      { key: 'w-6' }
    ])
  })

  it('keeps at most MAX_WINDOWS', () => {
    const raw = Array.from({ length: MAX_WINDOWS + 3 }, (_, i) => ({ key: `w-${i}` }))
    expect(sanitizeWindows(raw, context())).toHaveLength(MAX_WINDOWS)
  })

  it('validates bounds', () => {
    expect(sanitizeBounds({ x: -1440.4, y: 25, width: 1200.6, height: 800 })).toEqual({ x: -1440, y: 25, width: 1201, height: 800 })
    expect(sanitizeBounds({ x: 0, y: 0, width: 50, height: 800 })).toBeNull()
    expect(sanitizeBounds({ x: 1e9, y: 0, width: 500, height: 800 })).toBeNull()
    expect(sanitizeBounds({ x: 0, y: 0, width: Infinity, height: 800 })).toBeNull()
    expect(sanitizeBounds('nope')).toBeNull()
  })
})
