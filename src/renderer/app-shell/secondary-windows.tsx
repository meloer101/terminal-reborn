// Secondary windows on screen (PRD F20 · 多窗口). The workspace store says which windows exist; this opens each as a
// child window of the main window's page (`window.open('about:blank', …)`, which main turns into an app window) and
// draws it with a React root of its own — the same renderer, so the sessions, their terminals and the PTY streams stay
// where they are and a terminal only moves its DOM between windows. Closing one hands its terminals back first.
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MAIN_WINDOW, WINDOW_FRAME_PREFIX, type SecondaryWindow, type WindowKey } from '@shared/window-layout'
import { useWorkspace, windowEffects } from '../state/workspace'
import { WindowScopeContext } from '../state/window-context'
import { useArchiveSheet } from '../archive/store'
import { useMergeSheet } from '../panels/merge/store'
import { useSettingsDialog } from '../settings/SettingsDialog'
import { addWindow, removeWindow, windowOf } from './windows-runtime'
import { SecondaryShell } from './SecondaryShell'

interface Open {
  win: Window
  root: Root
  /** Undoes the style / attribute mirroring and the focus listener. */
  stop(): void
}

const open = new Map<WindowKey, Open>()

function features(window: SecondaryWindow): string {
  const parts: string[] = []
  if (window.bounds) {
    const { x, y, width, height } = window.bounds
    parts.push(`left=${x}`, `top=${y}`, `width=${width}`, `height=${height}`)
  }
  if (window.fullScreen) parts.push('fullscreen=yes')
  return parts.join(',')
}

/** Copies the attributes of `from` onto `to` (theme, appearance variables) and keeps them in step. */
function mirrorAttributes(from: Element, to: Element): MutationObserver {
  const copy = (): void => {
    for (const attr of [...to.attributes]) if (!from.hasAttribute(attr.name)) to.removeAttribute(attr.name)
    for (const attr of [...from.attributes]) if (to.getAttribute(attr.name) !== attr.value) to.setAttribute(attr.name, attr.value)
  }
  copy()
  const observer = new MutationObserver(copy)
  observer.observe(from, { attributes: true })
  return observer
}

const isStyle = (node: Node): node is HTMLStyleElement | HTMLLinkElement =>
  node.nodeName === 'STYLE' || (node.nodeName === 'LINK' && (node as HTMLLinkElement).rel === 'stylesheet')

/** Clones the page's stylesheets into the window and follows changes (Vite's hot updates in development). */
function mirrorStyles(doc: Document): MutationObserver {
  const clones = new Map<Node, Node>()
  const add = (node: Node, before: Node | null = null): void => {
    if (!isStyle(node) || clones.has(node)) return
    const clone = doc.importNode(node, true)
    clones.set(node, clone)
    doc.head.insertBefore(clone, before)
  }
  for (const node of document.head.childNodes) add(node)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        const clone = clones.get(node)
        clone?.parentNode?.removeChild(clone)
        clones.delete(node)
      }
      for (const node of record.addedNodes) add(node)
      // A style element whose text changed (a hot update): copy the text.
      const style = record.target.nodeName === 'STYLE' ? record.target : record.target.parentNode
      const clone = style ? clones.get(style) : undefined
      if (style && clone) clone.textContent = style.textContent
    }
  })
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  return observer
}

function title(window: SecondaryWindow): string {
  const project = window.projectId !== null ? useWorkspace.getState().projects.find((p) => p.id === window.projectId) : undefined
  return project ? project.name : 'Wavi'
}

function openWindow(window: SecondaryWindow): void {
  const key = window.key
  const win = globalThis.window.open('about:blank', WINDOW_FRAME_PREFIX + key, features(window))
  if (!win) {
    console.error('[windows] could not open a window')
    useWorkspace.getState().closeWindow(key)
    return
  }
  const doc = win.document
  doc.documentElement.lang = document.documentElement.lang
  doc.title = title(window)
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'UTF-8')
  doc.head.append(charset)
  const styles = mirrorStyles(doc)
  const html = mirrorAttributes(document.documentElement, doc.documentElement)
  const body = mirrorAttributes(document.body, doc.body)
  const host = doc.createElement('div')
  host.id = 'root'
  doc.body.append(host)
  const onFocus = (): void => useWorkspace.getState().focusWindow(key)
  win.addEventListener('focus', onFocus)
  addWindow(key, win)
  const root = createRoot(host)
  root.render(
    <StrictMode>
      <WindowScopeContext.Provider value={{ key, win }}>
        <SecondaryShell />
      </WindowScopeContext.Provider>
    </StrictMode>
  )
  open.set(key, {
    win,
    root,
    stop: () => {
      styles.disconnect()
      html.disconnect()
      body.disconnect()
      win.removeEventListener('focus', onFocus)
    }
  })
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

/**
 * Takes a window off the screen: its React root unmounts (its panes give their terminals back), the terminals'
 * DOM is home before the native window goes, then main closes it.
 */
async function closeWindow(key: WindowKey): Promise<void> {
  const entry = open.get(key)
  if (!entry) return
  open.delete(key)
  entry.root.unmount()
  // The main window's terminal panes take their terminals back in their next effects.
  await nextFrame()
  await nextFrame()
  // Anything still there (an effect that did not run) waits in the main window until its pane picks it up.
  const stray = [...entry.win.document.querySelectorAll('.xterm')]
  if (stray.length > 0) {
    const holder = document.createElement('div')
    holder.hidden = true
    document.body.append(holder)
    for (const element of stray) holder.append(element)
  }
  entry.stop()
  removeWindow(key)
  window.tr.ui.closeWindow(key)
}

/** Opens the windows the store has and follows it; returns the function that stops (the page is going away). */
export function startSecondaryWindows(): () => void {
  const sync = (windows: readonly SecondaryWindow[]): void => {
    const keys = new Set(windows.map((w) => w.key))
    for (const key of [...open.keys()]) if (!keys.has(key)) void closeWindow(key)
    for (const window of windows) if (!open.has(window.key)) openWindow(window)
  }
  // Titles follow project renames.
  const retitle = (): void => {
    for (const window of useWorkspace.getState().windows) {
      const entry = open.get(window.key)
      if (entry && entry.win.document.title !== title(window)) entry.win.document.title = title(window)
    }
  }
  sync(useWorkspace.getState().windows)
  const unsubscribe = useWorkspace.subscribe((state, prev) => {
    if (state.windows !== prev.windows) sync(state.windows)
    if (state.projects !== prev.projects) retitle()
    // The overview opened (a merged notification, ⇧⌘A, the sidebar): it is in the main window, which comes forward.
    if (state.mainView === 'overview' && prev.mainView !== 'overview' && open.size > 0) windowEffects.reveal(MAIN_WINDOW)
  })
  const onMainFocus = (): void => useWorkspace.getState().focusWindow(MAIN_WINDOW)
  window.addEventListener('focus', onMainFocus)
  // The keyboard went to a session in another window: bring that window forward (it may be in another Space).
  windowEffects.reveal = (key) => {
    const win = windowOf(key)
    if (open.size === 0 && key === MAIN_WINDOW) return
    if (win?.document.hasFocus()) return
    window.tr.ui.focusWindow(key)
  }
  const offClose = window.tr.ui.onWindowCloseRequest((key) => {
    // The red button: the store forgets the window, sync() above hands its terminals back and closes it.
    if (open.has(key)) useWorkspace.getState().closeWindow(key)
    else window.tr.ui.closeWindow(key)
  })
  // Settings and the merge / archive sheets are the main window's: opened from another window, it comes forward.
  const toMain = (): void => {
    if (useWorkspace.getState().keyWindow === MAIN_WINDOW) return
    useWorkspace.getState().focusWindow(MAIN_WINDOW)
    window.tr.ui.focusWindow(MAIN_WINDOW)
  }
  const offSheets = [
    useSettingsDialog.subscribe((s, prev) => s.open && !prev.open && toMain()),
    useMergeSheet.subscribe((s, prev) => s.target && s.generation !== prev.generation && toMain()),
    useArchiveSheet.subscribe((s, prev) => s.target && s.generation !== prev.generation && toMain())
  ]
  const offState = window.tr.ui.onWindowState(({ key, bounds, fullScreen }) => useWorkspace.getState().setWindowState(key, bounds, fullScreen))
  return () => {
    unsubscribe()
    offClose()
    offState()
    for (const off of offSheets) off()
    window.removeEventListener('focus', onMainFocus)
    windowEffects.reveal = () => {}
  }
}
