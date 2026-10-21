// The main area's split (PRD F20 · Figma 21): two to four sessions side by side inside the terminal area, kept as a
// tree of splits — a split runs its children left to right ('row') or top to bottom ('column'), each child a pane or
// another split. The panes exactly fill the area; a 1 px hairline between neighbours is where they resize.
// Pure: the main area measures and draws it, the workspace store keeps it and workspace.json saves it.
// The overview overlay (renderer/overview/pane-layout.ts) shares the drop zones and limits below.
import type { SessionId } from './types'

export const MAX_PANES = 4
/** No pane gets narrower / shorter than this share of its split when resizing (as in the overview overlay). */
export const MIN_SHARE = 0.15
/** Nor smaller than this, in px; the area cannot be split further when the panes would not fit. */
export const MIN_PANE: Size = { width: 320, height: 200 }
/** The hairline between two panes, in px. */
export const SPLIT_GAP = 1
/** The new pane's slot while ⌘D / ⇧⌘D picks its session; never a session id (those are UUIDs or `s-…`). */
export const PICKER_PANE: SessionId = 'split:picker'

/** 'row': children side by side, left to right; 'column': stacked, top to bottom. */
export type SplitDir = 'row' | 'column'

export type SplitNode = { type: 'pane'; id: SessionId } | { type: 'split'; dir: SplitDir; children: SplitNode[]; sizes: number[] }

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'
export type Side = Exclude<DropZone, 'center'>
export type Direction = 'left' | 'right' | 'up' | 'down'

export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  x: number
  y: number
}

export interface PaneBox extends Rect {
  id: SessionId
}

/** The hairline after child `index` of the split at `path` (child indices from the root). */
export interface SplitHandle extends Rect {
  path: number[]
  index: number
  dir: SplitDir
  /** The split's length along `dir` without its hairlines, in px: what a share is a share of. */
  span: number
}

export const pane = (id: SessionId): SplitNode => ({ type: 'pane', id })

const equal = (n: number): number[] => Array.from({ length: n }, () => 1 / n)

function normalize(sizes: readonly number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0)
  return total > 0 ? sizes.map((s) => s / total) : equal(sizes.length)
}

/** Every pane, picker included, left to right and top to bottom. */
export function paneIds(node: SplitNode): SessionId[] {
  return node.type === 'pane' ? [node.id] : node.children.flatMap(paneIds)
}

/** The sessions shown, without the picker. */
export function sessionsIn(node: SplitNode | null | undefined): SessionId[] {
  return node ? paneIds(node).filter((id) => id !== PICKER_PANE) : []
}

export function hasPane(node: SplitNode | null | undefined, id: SessionId): boolean {
  return node ? paneIds(node).includes(id) : false
}

const firstPane = (node: SplitNode): SessionId => paneIds(node)[0] ?? ''
const lastPane = (node: SplitNode): SessionId => paneIds(node).at(-1) ?? ''

/** Collapses one-child splits, folds a split into its parent when both run the same way, and renormalizes shares. */
export function normalizeTree(node: SplitNode): SplitNode {
  if (node.type === 'pane') return node
  const children: SplitNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, i) => {
    const next = normalizeTree(child)
    const share = node.sizes[i] ?? 0
    if (next.type === 'split' && next.dir === node.dir) {
      next.children.forEach((grandchild, j) => {
        children.push(grandchild)
        sizes.push(share * (next.sizes[j] ?? 0))
      })
    } else {
      children.push(next)
      sizes.push(share)
    }
  })
  if (children.length === 1 && children[0]) return children[0]
  return { type: 'split', dir: node.dir, children, sizes: normalize(sizes) }
}

const dirOf = (side: Side): SplitDir => (side === 'left' || side === 'right' ? 'row' : 'column')
const goesBefore = (side: Side): boolean => side === 'left' || side === 'top'

/**
 * A new pane `id` on one side of `target`, taking half of its space: beside it in its split when that split runs the
 * same way, otherwise the two share a new split where the target was.
 */
export function splitPane(root: SplitNode, target: SessionId, side: Side, id: SessionId): SplitNode {
  if (hasPane(root, id) || !hasPane(root, target)) return root
  const dir = dirOf(side)
  const visit = (node: SplitNode): SplitNode => {
    if (node.type === 'pane') {
      if (node.id !== target) return node
      return { type: 'split', dir, children: goesBefore(side) ? [pane(id), node] : [node, pane(id)], sizes: [0.5, 0.5] }
    }
    const at = node.children.findIndex((c) => c.type === 'pane' && c.id === target)
    if (at !== -1 && node.dir === dir) {
      const half = (node.sizes[at] ?? 0) / 2
      const children = [...node.children]
      const sizes = node.sizes.map((s, i) => (i === at ? half : s))
      const insertAt = goesBefore(side) ? at : at + 1
      children.splice(insertAt, 0, pane(id))
      sizes.splice(insertAt, 0, half)
      return { ...node, children, sizes }
    }
    return { ...node, children: node.children.map(visit) }
  }
  return normalizeTree(visit(root))
}

/** Puts `id` where `target` is, at its size. */
export function replacePane(root: SplitNode, target: SessionId, id: SessionId): SplitNode {
  if (!hasPane(root, target) || hasPane(root, id)) return root
  const visit = (node: SplitNode): SplitNode =>
    node.type === 'pane' ? (node.id === target ? pane(id) : node) : { ...node, children: node.children.map(visit) }
  return visit(root)
}

export function swapPanes(root: SplitNode, a: SessionId, b: SessionId): SplitNode {
  if (a === b || !hasPane(root, a) || !hasPane(root, b)) return root
  const visit = (node: SplitNode): SplitNode =>
    node.type === 'pane' ? (node.id === a ? pane(b) : node.id === b ? pane(a) : node) : { ...node, children: node.children.map(visit) }
  return visit(root)
}

/**
 * Takes a pane out; its neighbours share the space it leaves in proportion. `successor` is the pane that takes over
 * from it (the next one in its split, else the previous one) — where the keyboard goes when it was the focused one.
 */
export function removePane(root: SplitNode, id: SessionId): { node: SplitNode | null; successor: SessionId | null } {
  let successor: SessionId | null = null
  const visit = (node: SplitNode): SplitNode | null => {
    if (node.type === 'pane') return node.id === id ? null : node
    const children: SplitNode[] = []
    const sizes: number[] = []
    node.children.forEach((child, i) => {
      const next = visit(child)
      if (next) {
        children.push(next)
        sizes.push(node.sizes[i] ?? 0)
      } else if (child.type === 'pane') {
        const after = node.children[i + 1]
        const before = node.children[i - 1]
        successor = after ? firstPane(after) : before ? lastPane(before) : null
      }
    })
    return children.length === 0 ? null : { ...node, children, sizes: normalize(sizes) }
  }
  const node = visit(root)
  return { node: node ? normalizeTree(node) : null, successor }
}

/** Drops a pane on another: the middle swaps the two, an edge moves it to that side of the target. */
export function movePane(root: SplitNode, dragged: SessionId, target: SessionId, zone: DropZone): SplitNode {
  if (dragged === target || !hasPane(root, dragged) || !hasPane(root, target)) return root
  if (zone === 'center') return swapPanes(root, dragged, target)
  const { node } = removePane(root, dragged)
  return node ? splitPane(node, target, zone, dragged) : root
}

/** Drops a session on a pane: the middle shows it there instead, an edge adds a pane on that side; one already shown moves. */
export function placeSession(root: SplitNode, id: SessionId, target: SessionId, zone: DropZone): SplitNode {
  if (hasPane(root, id)) return movePane(root, id, target, zone)
  return zone === 'center' ? replacePane(root, target, id) : splitPane(root, target, zone, id)
}

/** The smallest the panes of `node` can be laid out in: MIN_PANE each, plus the hairlines between them. */
export function minSize(node: SplitNode, gap = SPLIT_GAP): Size {
  if (node.type === 'pane') return MIN_PANE
  const sizes = node.children.map((c) => minSize(c, gap))
  const gaps = gap * (node.children.length - 1)
  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)
  return node.dir === 'row'
    ? { width: sum(sizes.map((s) => s.width)) + gaps, height: Math.max(...sizes.map((s) => s.height)) }
    : { width: Math.max(...sizes.map((s) => s.width)), height: sum(sizes.map((s) => s.height)) + gaps }
}

/** Whether every pane of `node` can be at least MIN_PANE in a `area`. */
export function fitsIn(node: SplitNode, area: Size, gap = SPLIT_GAP): boolean {
  const min = minSize(node, gap)
  return min.width <= area.width && min.height <= area.height
}

/** Whether one more pane fits beside `target` (⌘D / ⇧⌘D and dropping on an edge). */
export function canSplit(root: SplitNode, target: SessionId, side: Side, area: Size): boolean {
  if (paneIds(root).length >= MAX_PANES || !hasPane(root, target)) return false
  return fitsIn(splitPane(root, target, side, PICKER_PANE), area)
}

/** Raises children below their minimum share to it, taking the difference from the others in proportion to their slack. */
function raiseToMinimums(sizes: readonly number[], mins: readonly number[]): number[] {
  if (mins.reduce((a, b) => a + b, 0) > 1) return [...sizes]
  const low = sizes.map((s, i) => s < (mins[i] ?? 0) - 1e-9)
  if (!low.some(Boolean)) return [...sizes]
  const need = sizes.reduce((total, s, i) => total + (low[i] ? (mins[i] ?? 0) - s : 0), 0)
  const slack = sizes.map((s, i) => (low[i] ? 0 : Math.max(0, s - (mins[i] ?? 0))))
  const totalSlack = slack.reduce((a, b) => a + b, 0)
  if (totalSlack <= 0) return [...sizes]
  return sizes.map((s, i) => (low[i] ? (mins[i] ?? 0) : s - (need * (slack[i] ?? 0)) / totalSlack))
}

/** Shares adjusted so that every pane is at least MIN_PANE and MIN_SHARE in a `width` × `height` area, where that fits. */
export function fitShares(root: SplitNode, area: Size, gap = SPLIT_GAP): SplitNode {
  const visit = (node: SplitNode, width: number, height: number): SplitNode => {
    if (node.type === 'pane') return node
    const row = node.dir === 'row'
    const span = (row ? width : height) - gap * (node.children.length - 1)
    if (span <= 0) return node
    const mins = node.children.map((c) => Math.max(MIN_SHARE, (row ? minSize(c, gap).width : minSize(c, gap).height) / span))
    const sizes = raiseToMinimums(node.sizes, mins)
    const children = node.children.map((c, i) => visit(c, row ? span * (sizes[i] ?? 0) : width, row ? height : span * (sizes[i] ?? 0)))
    return { ...node, children, sizes }
  }
  return visit(root, area.width, area.height)
}

/** Where every pane and every hairline goes in a `width` × `height` area. Neighbours meet on whole pixels. */
export function measureSplit(root: SplitNode, width: number, height: number, gap = SPLIT_GAP): { panes: PaneBox[]; handles: SplitHandle[] } {
  const panes: PaneBox[] = []
  const handles: SplitHandle[] = []
  const visit = (node: SplitNode, rect: Rect, path: number[]): void => {
    if (node.type === 'pane') {
      panes.push({ id: node.id, ...rect })
      return
    }
    const row = node.dir === 'row'
    const length = row ? rect.width : rect.height
    const n = node.children.length
    const span = Math.max(0, length - gap * (n - 1))
    let offset = 0
    node.children.forEach((child, i) => {
      const exactEnd = offset + span * (node.sizes[i] ?? 0)
      const start = Math.round(offset)
      const end = i === n - 1 ? length : Math.round(exactEnd)
      const size = Math.max(0, end - start)
      visit(child, row ? { x: rect.x + start, y: rect.y, width: size, height: rect.height } : { x: rect.x, y: rect.y + start, width: rect.width, height: size }, [...path, i])
      if (i < n - 1) {
        handles.push({
          path,
          index: i,
          dir: node.dir,
          span,
          ...(row ? { x: rect.x + end, y: rect.y, width: gap, height: rect.height } : { x: rect.x, y: rect.y + end, width: rect.width, height: gap })
        })
      }
      offset = exactEnd + gap
    })
  }
  visit(root, { x: 0, y: 0, width, height }, [])
  return { panes, handles }
}

function splitAt(root: SplitNode, path: readonly number[], update: (node: Extract<SplitNode, { type: 'split' }>) => SplitNode): SplitNode {
  const visit = (node: SplitNode, depth: number): SplitNode => {
    if (node.type === 'pane') return node
    if (depth === path.length) return update(node)
    const at = path[depth]
    return { ...node, children: node.children.map((c, i) => (i === at ? visit(c, depth + 1) : c)) }
  }
  return visit(root, 0)
}

/**
 * Moves the hairline after child `index` of the split at `path` by `delta` px (`span` as in SplitHandle), keeping both
 * sides at least MIN_SHARE of the split and big enough for their panes.
 */
export function resizeSplit(root: SplitNode, path: readonly number[], index: number, delta: number, span: number, gap = SPLIT_GAP): SplitNode {
  if (span <= 0) return root
  return splitAt(root, path, (node) => {
    const a = node.sizes[index]
    const b = node.sizes[index + 1]
    const left = node.children[index]
    const right = node.children[index + 1]
    if (a === undefined || b === undefined || !left || !right) return node
    const minOf = (child: SplitNode): number => Math.max(MIN_SHARE, (node.dir === 'row' ? minSize(child, gap).width : minSize(child, gap).height) / span)
    const pair = a + b
    const minA = minOf(left)
    const minB = minOf(right)
    if (minA + minB > pair) return node
    const nextA = Math.min(pair - minB, Math.max(minA, a + delta / span))
    return { ...node, sizes: node.sizes.map((s, i) => (i === index ? nextA : i === index + 1 ? pair - nextA : s)) }
  })
}

/** Double-clicking a hairline: the two panes beside it share their space equally again. */
export function evenSplit(root: SplitNode, path: readonly number[], index: number): SplitNode {
  return splitAt(root, path, (node) => {
    const a = node.sizes[index]
    const b = node.sizes[index + 1]
    if (a === undefined || b === undefined) return node
    const half = (a + b) / 2
    return { ...node, sizes: node.sizes.map((s, i) => (i === index || i === index + 1 ? half : s)) }
  })
}

/** ⌥⌘ arrows: the pane next to `from` in that direction — the nearest one that lines up with it, then the most overlap. */
export function adjacentPane(panes: readonly PaneBox[], from: SessionId, dir: Direction): SessionId | null {
  const a = panes.find((p) => p.id === from)
  if (!a) return null
  const SLOP = 2
  const across = dir === 'left' || dir === 'right'
  const beyond = (p: PaneBox): boolean =>
    dir === 'left'
      ? p.x + p.width <= a.x + SLOP
      : dir === 'right'
        ? p.x >= a.x + a.width - SLOP
        : dir === 'up'
          ? p.y + p.height <= a.y + SLOP
          : p.y >= a.y + a.height - SLOP
  const overlap = (p: PaneBox): number =>
    across ? Math.min(a.y + a.height, p.y + p.height) - Math.max(a.y, p.y) : Math.min(a.x + a.width, p.x + p.width) - Math.max(a.x, p.x)
  const distance = (p: PaneBox): number =>
    dir === 'left' ? a.x - (p.x + p.width) : dir === 'right' ? p.x - (a.x + a.width) : dir === 'up' ? a.y - (p.y + p.height) : p.y - (a.y + a.height)
  const best = panes
    .filter((p) => p.id !== from && beyond(p) && overlap(p) > 0)
    .sort((p, q) => distance(p) - distance(q) || overlap(q) - overlap(p) || p.y - q.y || p.x - q.x)[0]
  return best?.id ?? null
}

/** The zone of a pane under the pointer (`px`, `py` as 0…1 across the pane): the middle, or the nearest edge. */
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

/** The part of a pane a drop in `zone` will take: the whole pane, or the half on that side. */
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

/** Where a dragged session would land, or why it cannot (an edge with four panes open, or no room for another). */
export type SplitDrop = { id: SessionId; zone: DropZone } | { id: SessionId; zone: Side; refused: 'max' | 'space' }

/** The drop under (`x`, `y`) in the area, for `dragged` (a session from the sidebar, or a pane being moved). */
export function dropTargetAt(root: SplitNode, panes: readonly PaneBox[], x: number, y: number, dragged: SessionId, area: Size): SplitDrop | null {
  const target = panes.find((p) => x >= p.x && x < p.x + p.width && y >= p.y && y < p.y + p.height)
  if (!target || target.id === dragged || target.width <= 0 || target.height <= 0) return null
  const zone = dropZone((x - target.x) / target.width, (y - target.y) / target.height)
  if (zone === 'center') return { id: target.id, zone }
  const moving = hasPane(root, dragged)
  if (!moving && paneIds(root).length >= MAX_PANES) return { id: target.id, zone, refused: 'max' }
  if (!fitsIn(placeSession(root, dragged, target.id, zone), area)) return { id: target.id, zone, refused: 'space' }
  return { id: target.id, zone }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A split read from workspace.json: well-formed, at most MAX_PANES panes, each a session for which `keep` holds and
 * shown once; panes that fail are dropped and the rest close up. Null when fewer than two panes are left.
 */
export function sanitizeSplit(raw: unknown, keep: (id: SessionId) => boolean): SplitNode | null {
  const seen = new Set<SessionId>()
  const read = (value: unknown, depth: number): SplitNode | null => {
    if (!isRecord(value) || depth > MAX_PANES) return null
    if (value.type === 'pane') {
      const id = value.id
      if (typeof id !== 'string' || id === PICKER_PANE || !keep(id) || seen.has(id) || seen.size >= MAX_PANES) return null
      seen.add(id)
      return pane(id)
    }
    if (value.type !== 'split' || (value.dir !== 'row' && value.dir !== 'column')) return null
    const rawChildren: unknown = value.children
    const rawSizes: unknown = value.sizes
    if (!Array.isArray(rawChildren) || !Array.isArray(rawSizes) || rawChildren.length !== rawSizes.length) return null
    const children: SplitNode[] = []
    const sizes: number[] = []
    rawChildren.slice(0, MAX_PANES).forEach((child: unknown, i: number) => {
      const share: unknown = rawSizes[i]
      if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0) return
      const node = read(child, depth + 1)
      if (!node) return
      children.push(node)
      sizes.push(share)
    })
    return children.length === 0 ? null : { type: 'split', dir: value.dir, children, sizes: normalize(sizes) }
  }
  const node = read(raw, 0)
  if (!node) return null
  const tree = normalizeTree(node)
  return paneIds(tree).length >= 2 ? tree : null
}

/** What workspace.json saves: the split without the picker, or null once fewer than two panes are left. */
export function persistedSplit(root: SplitNode | null | undefined): SplitNode | null {
  if (!root) return null
  const tree = hasPane(root, PICKER_PANE) ? removePane(root, PICKER_PANE).node : root
  return tree && paneIds(tree).length >= 2 ? tree : null
}
