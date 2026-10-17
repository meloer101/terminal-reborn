// Pure parts of the in-app menu (ui/MenuHost.tsx): entries, placement, shortcut labels, keyboard movement.
import type { ComponentType } from 'react'

/** A 16px lucide-style icon shown before an item's label. */
export type MenuIcon = ComponentType<{ size?: number; strokeWidth?: number }>

/** A menu entry. Choosing an item resolves `popupMenu()` with its id. */
export type MenuEntry =
  | {
      type: 'item'
      id: string
      label: string
      enabled?: boolean
      /** Shortcut shown next to the label (display only, e.g. 'CmdOrCtrl+N'); the key itself is handled elsewhere. */
      accelerator?: string
      icon?: MenuIcon
    }
  | { type: 'submenu'; label: string; items: MenuEntry[] }
  | { type: 'separator' }

export interface Size {
  width: number
  height: number
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Where a menu opens: at the pointer (right-click), under the control that opened it, or beside the
 * submenu row it belongs to (`box` spans the parent menu horizontally and the row vertically).
 */
export type Placement = { kind: 'point'; x: number; y: number } | { kind: 'below'; box: Box } | { kind: 'beside'; box: Box }

/** Window edge the menu keeps clear of. */
export const MENU_MARGIN = 8
/** Gap between a control and the menu under it. */
export const MENU_GAP = 4
/** Panel padding + border: a submenu's first row lines up with the row that opened it. */
export const MENU_INSET = 5

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)))

/** Top-left corner for a menu of `size`, flipped and then clamped so it stays inside `viewport`. */
export function placeMenu(size: Size, placement: Placement, viewport: Size): { left: number; top: number } {
  const maxLeft = viewport.width - MENU_MARGIN - size.width
  const maxTop = viewport.height - MENU_MARGIN - size.height
  let left: number
  let top: number
  switch (placement.kind) {
    case 'point':
      left = placement.x <= maxLeft ? placement.x : placement.x - size.width
      top = placement.y <= maxTop ? placement.y : placement.y - size.height
      break
    case 'below': {
      const { box } = placement
      left = box.left <= maxLeft ? box.left : box.right - size.width
      top = box.bottom + MENU_GAP <= maxTop ? box.bottom + MENU_GAP : box.top - MENU_GAP - size.height
      break
    }
    case 'beside': {
      const { box } = placement
      left = box.right + MENU_GAP / 2 <= maxLeft ? box.right + MENU_GAP / 2 : box.left - MENU_GAP / 2 - size.width
      top = box.top - MENU_INSET <= maxTop ? box.top - MENU_INSET : box.bottom + MENU_INSET - size.height
      break
    }
  }
  return { left: clamp(left, MENU_MARGIN, maxLeft), top: clamp(top, MENU_MARGIN, maxTop) }
}

const MODIFIERS: Record<string, { symbol: string; order: number }> = {
  ctrl: { symbol: '⌃', order: 0 },
  control: { symbol: '⌃', order: 0 },
  alt: { symbol: '⌥', order: 1 },
  option: { symbol: '⌥', order: 1 },
  shift: { symbol: '⇧', order: 2 },
  cmd: { symbol: '⌘', order: 3 },
  command: { symbol: '⌘', order: 3 },
  cmdorctrl: { symbol: '⌘', order: 3 },
  commandorcontrol: { symbol: '⌘', order: 3 }
}

/** Electron key names drawn as the symbol on the key. */
const KEY_SYMBOL: Record<string, string> = { plus: '+', enter: '↵', return: '↵', escape: 'esc', backspace: '⌫', delete: '⌦' }

/** 'CmdOrCtrl+Shift+A' → '⇧⌘A', in macOS modifier order (⌃⌥⇧⌘). */
export function formatAccelerator(accelerator: string): string {
  const parts = accelerator.split('+')
  const key = parts.pop() ?? ''
  const mods = parts
    .map((part) => MODIFIERS[part.toLowerCase()])
    .filter((mod) => mod !== undefined)
    .sort((a, b) => a.order - b.order)
    .map((mod) => mod.symbol)
  return mods.join('') + (KEY_SYMBOL[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key))
}

/** Items and submenus that can be activated (separators and disabled items are skipped). */
export function isActionable(entry: MenuEntry): boolean {
  return entry.type === 'submenu' || (entry.type === 'item' && entry.enabled !== false)
}

/**
 * The next actionable index from `from` in `direction`, wrapping around; `from` = -1 starts before the
 * first entry. Returns -1 when nothing is actionable.
 */
export function stepIndex(entries: MenuEntry[], from: number, direction: 1 | -1): number {
  const n = entries.length
  for (let step = 1; step <= n; step++) {
    const index = (((from + direction * step) % n) + n) % n
    if (isActionable(entries[index]!)) return index
  }
  return -1
}
