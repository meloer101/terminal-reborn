// In-app context / dropdown menus. Drawn by the renderer (ui/MenuHost.tsx, mounted once by AppShell) so they share
// the product's type, tokens and both themes instead of the system's vibrant popover.
import { create } from 'zustand'
import type { MenuEntry, Placement } from './menu-model'

export type { MenuEntry } from './menu-model'

/**
 * Where to open: a pointer position (right-click; `owner` is the element right-clicked) or the control that opened
 * the menu (drops down under it). The owner / control carries `data-menu-open` while the menu is up.
 */
export type MenuAnchor = { x: number; y: number; owner?: Element } | Element

export interface OpenMenu {
  /** Fresh per open, so the host remounts (state, focus, placement) for each menu. */
  serial: number
  entries: MenuEntry[]
  placement: Placement
  /** Focus goes back here when the menu closes (the terminal, a sidebar row, …). */
  restoreTo: HTMLElement | null
  resolve(id: string | null): void
}

export const useMenu = create<{ menu: OpenMenu | null }>()(() => ({ menu: null }))

let serial = 0
let openedBy: Element | null = null
let owner: Element | null = null
/** A press outside closed the menu opened by this control; its click must not reopen it (toggle). */
let dismissedBy: { element: Element; at: number } | null = null

function placementOf(anchor: MenuAnchor): Placement {
  if (!(anchor instanceof Element)) return { kind: 'point', x: anchor.x, y: anchor.y }
  const { left, top, right, bottom } = anchor.getBoundingClientRect()
  return { kind: 'below', box: { left, top, right, bottom } }
}

/** Shows a menu; resolves to the chosen item id, or null when it is dismissed. */
export function popupMenu(entries: MenuEntry[], anchor: MenuAnchor): Promise<string | null> {
  const anchorElement = anchor instanceof Element ? anchor : null
  if (anchorElement && dismissedBy?.element === anchorElement && performance.now() - dismissedBy.at < 500) {
    dismissedBy = null
    return Promise.resolve(null)
  }
  closeMenu(null)
  const active = document.activeElement
  const restoreTo = active instanceof HTMLElement && active !== document.body ? active : null
  openedBy = anchorElement
  owner = anchorElement ?? (anchor instanceof Element ? null : (anchor.owner ?? null))
  owner?.setAttribute('data-menu-open', '')
  anchorElement?.setAttribute('aria-expanded', 'true')
  return new Promise((resolve) => {
    useMenu.setState({ menu: { serial: ++serial, entries, placement: placementOf(anchor), restoreTo, resolve } })
  })
}

/**
 * Closes the open menu (if any), hands focus back, then resolves its promise with `id`. `pressedOutsideOn` is the
 * target of the press outside the menu that dismissed it.
 */
export function closeMenu(id: string | null, pressedOutsideOn?: Node): void {
  const { menu } = useMenu.getState()
  if (!menu) return
  dismissedBy = pressedOutsideOn && openedBy?.contains(pressedOutsideOn) ? { element: openedBy, at: performance.now() } : null
  useMenu.setState({ menu: null })
  // Before the owner loses data-menu-open: hover-only controls (the header's ＋ / …) are still shown, so focusable.
  if (menu.restoreTo?.isConnected) menu.restoreTo.focus({ preventScroll: true })
  openedBy?.setAttribute('aria-expanded', 'false')
  openedBy = null
  owner?.removeAttribute('data-menu-open')
  owner = null
  menu.resolve(id)
}

/** A right-click's position (and the element right-clicked), for `popupMenu`. */
export const pointerAnchor = (event: { clientX: number; clientY: number; currentTarget: Element }): MenuAnchor => ({
  x: event.clientX,
  y: event.clientY,
  owner: event.currentTarget
})
