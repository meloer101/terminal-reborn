// The board overlay's tiles (PRD F9): up to four sessions in columns, each column a stack of tiles. Tiles can be
// dragged onto another tile — its middle swaps the two, an edge puts the dragged tile beside it on that side — and
// the gaps between columns and between tiles in a column drag to resize. Pure: the overlay measures and draws it.
import type { SessionId } from '@shared/types'

export const MAX_PANES = 4
/** The picker's slot while the overlay offers one more session; never a session id (those are UUIDs). */
export const PICKER_SLOT: SessionId = 'overlay:picker'
/** No column or tile gets narrower / shorter than this share of its parent when resizing. */
export const MIN_SHARE = 0.15

export interface PaneColumn {
  ids: SessionId[]
  /** Height shares of `ids`, summing to 1. */
  sizes: number[]
}

export interface PaneLayout {
  columns: PaneColumn[]
  /** Width shares of `columns`, summing to 1. */
  sizes: number[]
}

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface TileBox extends Rect {
  id: SessionId
}

export type SplitHandle = Rect & ({ kind: 'column'; index: number } | { kind: 'row'; column: number; index: number })

const equal = (n: number): number[] => Array.from({ length: n }, () => 1 / n)

const normalize = (sizes: readonly number[]): number[] => {
  const total = sizes.reduce((a, b) => a + b, 0)
  return total > 0 ? sizes.map((s) => s / total) : equal(sizes.length)
}

export function singleLayout(id: SessionId): PaneLayout {
  return { columns: [{ ids: [id], sizes: [1] }], sizes: [1] }
}

const slots = (layout: PaneLayout): SessionId[] => layout.columns.flatMap((c) => c.ids)

/** The sessions in a layout; the picker's slot is not one. */
export function layoutIds(layout: PaneLayout): SessionId[] {
  return slots(layout).filter((id) => id !== PICKER_SLOT)
}

/**
 * The next session's place: a second column first, then under the column with the fewest tiles (the rightmost on a
 * tie) — 1 fills the overlay, 2 side by side, 3 one tall on the left and two stacked on the right, 4 a 2×2 grid.
 */
export function addToLayout(layout: PaneLayout, id: SessionId): PaneLayout {
  const ids = slots(layout)
  if (ids.includes(id) || ids.length >= MAX_PANES) return layout
  if (layout.columns.length < 2) {
    return { columns: [...layout.columns, { ids: [id], sizes: [1] }], sizes: equal(layout.columns.length + 1) }
  }
  let at = 0
  layout.columns.forEach((c, i) => {
    if (c.ids.length <= (layout.columns[at]?.ids.length ?? Infinity)) at = i
  })
  return {
    ...layout,
    columns: layout.columns.map((c, i) => (i === at ? { ids: [...c.ids, id], sizes: equal(c.ids.length + 1) } : c))
  }
}

/** Puts `id` where `slot` is, at its size: the picked session takes the picker's tile as the user left it. */
export function replaceInLayout(layout: PaneLayout, slot: SessionId, id: SessionId): PaneLayout {
  const ids = slots(layout)
  if (!ids.includes(slot) || ids.includes(id)) return layout
  return { ...layout, columns: layout.columns.map((c) => ({ ...c, ids: c.ids.map((x) => (x === slot ? id : x)) })) }
}

/** Takes a session out; the space it leaves goes to its neighbours in proportion, and an empty column goes away. */
export function removeFromLayout(layout: PaneLayout, id: SessionId): PaneLayout {
  const columns: PaneColumn[] = []
  const sizes: number[] = []
  layout.columns.forEach((c, i) => {
    const keep = c.ids.map((x, j) => [x, c.sizes[j] ?? 0] as const).filter(([x]) => x !== id)
    if (keep.length === 0) return
    columns.push({ ids: keep.map(([x]) => x), sizes: normalize(keep.map(([, s]) => s)) })
    sizes.push(layout.sizes[i] ?? 0)
  })
  return { columns, sizes: normalize(sizes) }
}

/** Drops `dragged` on `target`: the middle swaps them, an edge puts it beside the target on that side. */
export function moveInLayout(layout: PaneLayout, dragged: SessionId, target: SessionId, zone: DropZone): PaneLayout {
  const ids = layoutIds(layout)
  if (dragged === target || !ids.includes(dragged) || !ids.includes(target)) return layout
  if (zone === 'center') {
    const swap = (x: SessionId): SessionId => (x === dragged ? target : x === target ? dragged : x)
    return { ...layout, columns: layout.columns.map((c) => ({ ...c, ids: c.ids.map(swap) })) }
  }
  const rest = removeFromLayout(layout, dragged)
  const col = rest.columns.findIndex((c) => c.ids.includes(target))
  const column = rest.columns[col]
  if (!column) return layout
  if (zone === 'top' || zone === 'bottom') {
    const row = column.ids.indexOf(target)
    const half = (column.sizes[row] ?? 0) / 2
    const at = zone === 'top' ? row : row + 1
    const idsNext = [...column.ids]
    idsNext.splice(at, 0, dragged)
    const sizesNext = column.sizes.map((s, j) => (j === row ? half : s))
    sizesNext.splice(at, 0, half)
    return { ...rest, columns: rest.columns.map((c, i) => (i === col ? { ids: idsNext, sizes: sizesNext } : c)) }
  }
  const half = (rest.sizes[col] ?? 0) / 2
  const at = zone === 'left' ? col : col + 1
  const columns = [...rest.columns]
  columns.splice(at, 0, { ids: [dragged], sizes: [1] })
  const sizes = rest.sizes.map((s, i) => (i === col ? half : s))
  sizes.splice(at, 0, half)
  return { columns, sizes }
}

/** Moves the boundary after `index` by `delta` (a share of the whole), keeping both sides at least MIN_SHARE. */
function shiftBoundary(sizes: readonly number[], index: number, delta: number): number[] {
  const a = sizes[index]
  const b = sizes[index + 1]
  if (a === undefined || b === undefined) return [...sizes]
  const pair = a + b
  const nextA = Math.min(pair - MIN_SHARE, Math.max(MIN_SHARE, a + delta))
  return sizes.map((s, i) => (i === index ? nextA : i === index + 1 ? pair - nextA : s))
}

export function resizeColumns(layout: PaneLayout, index: number, delta: number): PaneLayout {
  return { ...layout, sizes: shiftBoundary(layout.sizes, index, delta) }
}

export function resizeRows(layout: PaneLayout, column: number, index: number, delta: number): PaneLayout {
  return {
    ...layout,
    columns: layout.columns.map((c, i) => (i === column ? { ...c, sizes: shiftBoundary(c.sizes, index, delta) } : c))
  }
}

/** Where every tile and every resize handle (the gaps) goes in a `width` × `height` box. */
export function measureLayout(layout: PaneLayout, width: number, height: number, gap: number): { tiles: TileBox[]; handles: SplitHandle[] } {
  const tiles: TileBox[] = []
  const handles: SplitHandle[] = []
  const n = layout.columns.length
  const spanX = Math.max(0, width - gap * (n - 1))
  let x = 0
  layout.columns.forEach((column, i) => {
    const w = spanX * (layout.sizes[i] ?? 0)
    const m = column.ids.length
    const spanY = Math.max(0, height - gap * (m - 1))
    let y = 0
    column.ids.forEach((id, j) => {
      const h = spanY * (column.sizes[j] ?? 0)
      tiles.push({ id, x, y, width: w, height: h })
      if (j < m - 1) handles.push({ kind: 'row', column: i, index: j, x, y: y + h, width: w, height: gap })
      y += h + gap
    })
    if (i < n - 1) handles.push({ kind: 'column', index: i, x: x + w, y: 0, width: gap, height })
    x += w + gap
  })
  return { tiles, handles }
}

/** The zone of a tile under the pointer (`px`, `py` as 0…1 across the tile): the middle, or the nearest edge. */
export function dropZone(px: number, py: number): DropZone {
  if (px > 0.3 && px < 0.7 && py > 0.3 && py < 0.7) return 'center'
  const edges: [DropZone, number][] = [
    ['left', px],
    ['right', 1 - px],
    ['top', py],
    ['bottom', 1 - py]
  ]
  return edges.reduce((best, e) => (e[1] < best[1] ? e : best))[0]
}

/** The part of a tile a drop in `zone` will take: the whole tile to swap, or the half on that side. */
export function dropRect(tile: Rect, zone: DropZone): Rect {
  const { x, y, width, height } = tile
  switch (zone) {
    case 'left':
      return { x, y, width: width / 2, height }
    case 'right':
      return { x: x + width / 2, y, width: width / 2, height }
    case 'top':
      return { x, y, width, height: height / 2 }
    case 'bottom':
      return { x, y: y + height / 2, width, height: height / 2 }
    default:
      return tile
  }
}

/** The tile in the top-right corner, which carries the "add a session" button. */
export function cornerTile(layout: PaneLayout): SessionId | undefined {
  return layout.columns[layout.columns.length - 1]?.ids[0]
}

/** An edge or corner of the whole overlay, dragged to resize it. */
export type PanelEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface Size {
  width: number
  height: number
}

/** The overlay never gets smaller than this, nor closer than PANEL_MARGIN to the window's edges. */
export const MIN_PANEL: Size = { width: 480, height: 320 }
export const PANEL_MARGIN = 16

/**
 * The overlay's rect (in the window) after dragging `edge` by (dx, dy) from `start`: only the dragged edges move —
 * the right edge widens to the right, the top edge grows upwards — within the window and above the minimum size.
 */
export function resizeRect(start: Rect, edge: PanelEdge, dx: number, dy: number, viewport: Size): Rect {
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (edge.includes('e')) right = Math.min(viewport.width - PANEL_MARGIN, Math.max(left + MIN_PANEL.width, right + dx))
  if (edge.includes('w')) left = Math.max(PANEL_MARGIN, Math.min(right - MIN_PANEL.width, left + dx))
  if (edge.includes('s')) bottom = Math.min(viewport.height - PANEL_MARGIN, Math.max(top + MIN_PANEL.height, bottom + dy))
  if (edge.includes('n')) top = Math.max(PANEL_MARGIN, Math.min(bottom - MIN_PANEL.height, top + dy))
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }
}

/** A remembered rect, shrunk and moved to fit a window that has since become smaller. */
export function fitRect(rect: Rect, viewport: Size): Rect {
  const width = Math.max(Math.min(MIN_PANEL.width, viewport.width), Math.min(rect.width, viewport.width - 2 * PANEL_MARGIN))
  const height = Math.max(Math.min(MIN_PANEL.height, viewport.height), Math.min(rect.height, viewport.height - 2 * PANEL_MARGIN))
  const x = Math.max(0, Math.min(rect.x, viewport.width - PANEL_MARGIN - width))
  const y = Math.max(0, Math.min(rect.y, viewport.height - PANEL_MARGIN - height))
  return { x, y, width, height }
}
