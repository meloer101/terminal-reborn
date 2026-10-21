import { describe, expect, it } from 'vitest'
import {
  adjacentPane,
  canSplit,
  dropRect,
  dropTargetAt,
  dropZone,
  evenSplit,
  fitShares,
  fitsIn,
  hasPane,
  measureSplit,
  minSize,
  MIN_PANE,
  MIN_SHARE,
  movePane,
  normalizeTree,
  pane,
  paneIds,
  persistedSplit,
  PICKER_PANE,
  placeSession,
  removePane,
  replacePane,
  resizeSplit,
  sanitizeSplit,
  sessionsIn,
  splitPane,
  swapPanes,
  type SplitNode
} from './split-layout'

/** A compact picture of a tree: `a` for a pane, `row(a b)` / `col(a b)` for splits. */
function shape(node: SplitNode | null): string {
  if (!node) return '∅'
  if (node.type === 'pane') return node.id
  return `${node.dir === 'row' ? 'row' : 'col'}(${node.children.map(shape).join(' ')})`
}

const two = (): SplitNode => splitPane(pane('a'), 'a', 'right', 'b')
/** a tall on the left; b over c on the right (Figma 21B). */
const three = (): SplitNode => splitPane(two(), 'b', 'bottom', 'c')
/** 2×2: a over d on the left, b over c on the right (Figma 21C). */
const four = (): SplitNode => splitPane(three(), 'a', 'bottom', 'd')
const AREA = { width: 1176, height: 900 }

describe('splitPane', () => {
  it('builds 2, 3 and 4 panes like the overview overlay', () => {
    expect(shape(two())).toBe('row(a b)')
    expect(shape(three())).toBe('row(a col(b c))')
    expect(shape(four())).toBe('row(col(a d) col(b c))')
  })

  it('puts the new pane before the target for left / top', () => {
    expect(shape(splitPane(pane('a'), 'a', 'left', 'b'))).toBe('row(b a)')
    expect(shape(splitPane(pane('a'), 'a', 'top', 'b'))).toBe('col(b a)')
  })

  it('joins a split running the same way, taking half of the target', () => {
    const tree = splitPane(two(), 'b', 'right', 'c')
    expect(shape(tree)).toBe('row(a b c)')
    expect(tree.type === 'split' && tree.sizes).toEqual([0.5, 0.25, 0.25])
  })

  it('splits a pane in a stack across the stack (rows of different widths)', () => {
    // Two stacked, then ⌘D on the top one: only the top row gets two panes.
    const tree = splitPane(splitPane(pane('a'), 'a', 'bottom', 'b'), 'a', 'right', 'c')
    expect(shape(tree)).toBe('col(row(a c) b)')
  })

  it('never shows a session twice and needs the target', () => {
    const tree = two()
    expect(splitPane(tree, 'a', 'right', 'b')).toBe(tree)
    expect(splitPane(tree, 'x', 'right', 'c')).toBe(tree)
  })
})

describe('replace, swap, remove, move', () => {
  it('replaces a pane at its size', () => {
    const tree = replacePane(resizeSplit(two(), [], 0, 200, 1175), 'b', 'z')
    expect(shape(tree)).toBe('row(a z)')
    expect(tree.type === 'split' && tree.sizes[0]).toBeGreaterThan(0.6)
    expect(replacePane(two(), 'b', 'a')).toEqual(two())
  })

  it('swaps two panes', () => {
    expect(shape(swapPanes(four(), 'a', 'c'))).toBe('row(col(c d) col(b a))')
  })

  it('removes a pane, closes up the rest and names the pane that takes over', () => {
    const { node, successor } = removePane(three(), 'b')
    expect(shape(node)).toBe('row(a c)')
    expect(successor).toBe('c')
    expect(removePane(three(), 'c').successor).toBe('b')
    expect(removePane(three(), 'a').successor).toBe('b')
    expect(removePane(pane('a'), 'a')).toEqual({ node: null, successor: null })
  })

  it('gives the space of a removed pane to its neighbours in proportion', () => {
    const tree = splitPane(two(), 'b', 'right', 'c') // 0.5 / 0.25 / 0.25
    const { node } = removePane(tree, 'c')
    expect(node?.type === 'split' && node.sizes).toEqual([2 / 3, 1 / 3])
  })

  it('folds a split into its parent when one pane is left in it', () => {
    expect(shape(removePane(four(), 'd').node)).toBe('row(a col(b c))')
    expect(shape(removePane(removePane(four(), 'd').node!, 'a').node)).toBe('col(b c)')
  })

  it('moves a pane to an edge of another, or swaps on the middle', () => {
    expect(shape(movePane(three(), 'a', 'c', 'bottom'))).toBe('col(b c a)')
    expect(shape(movePane(three(), 'c', 'a', 'left'))).toBe('row(c a b)')
    expect(shape(movePane(three(), 'a', 'b', 'center'))).toBe('row(b col(a c))')
    expect(movePane(three(), 'a', 'a', 'left')).toEqual(three())
  })

  it('places a session from the sidebar: middle replaces, edge adds, a shown one moves', () => {
    expect(shape(placeSession(two(), 'z', 'b', 'center'))).toBe('row(a z)')
    expect(shape(placeSession(two(), 'z', 'b', 'bottom'))).toBe('row(a col(b z))')
    expect(shape(placeSession(three(), 'a', 'c', 'center'))).toBe('row(c col(b a))')
  })
})

describe('normalizeTree', () => {
  it('collapses one-child splits and folds same-direction splits with their shares', () => {
    const tree: SplitNode = {
      type: 'split',
      dir: 'row',
      sizes: [1, 1],
      children: [pane('a'), { type: 'split', dir: 'row', sizes: [1, 3], children: [pane('b'), { type: 'split', dir: 'column', sizes: [1], children: [pane('c')] }] }]
    }
    const out = normalizeTree(tree)
    expect(shape(out)).toBe('row(a b c)')
    expect(out.type === 'split' && out.sizes).toEqual([0.5, 0.125, 0.375])
  })
})

describe('measureSplit', () => {
  it('fills the area exactly, with a 1 px hairline between neighbours', () => {
    const { panes, handles } = measureSplit(two(), 1176, 900)
    expect(panes).toEqual([
      { id: 'a', x: 0, y: 0, width: 588, height: 900 },
      { id: 'b', x: 589, y: 0, width: 587, height: 900 }
    ])
    expect(handles).toEqual([{ path: [], index: 0, dir: 'row', span: 1175, x: 588, y: 0, width: 1, height: 900 }])
  })

  it('lays out a 2×2 grid with a handle per hairline', () => {
    const { panes, handles } = measureSplit(four(), 1176, 900)
    expect(panes.map((p) => p.id)).toEqual(['a', 'd', 'b', 'c'])
    expect(panes.find((p) => p.id === 'c')).toEqual({ id: 'c', x: 589, y: 451, width: 587, height: 449 })
    expect(handles.map((h) => `${h.dir}:${h.path.join('.')}:${h.index}`)).toEqual(['column:0:0', 'row::0', 'column:1:0'])
    // The panes and hairlines cover every pixel of the area once.
    const covered = panes.reduce((n, p) => n + p.width * p.height, 0) + handles.reduce((n, h) => n + h.width * h.height, 0)
    expect(covered).toBe(1176 * 900)
  })
})

describe('minimum sizes', () => {
  it('adds up panes of at least 320 × 200 and the hairlines', () => {
    expect(minSize(four())).toEqual({ width: 641, height: 401 })
    expect(minSize(splitPane(two(), 'b', 'right', 'c'))).toEqual({ width: 962, height: 200 })
  })

  it('refuses a split that would not fit, or a fifth pane', () => {
    expect(canSplit(two(), 'b', 'right', AREA)).toBe(true)
    expect(canSplit(splitPane(two(), 'b', 'right', 'c'), 'c', 'right', AREA)).toBe(false)
    expect(canSplit(pane('a'), 'a', 'bottom', { width: 600, height: 380 })).toBe(false)
    expect(canSplit(four(), 'a', 'right', { width: 4000, height: 4000 })).toBe(false)
    expect(fitsIn(four(), { width: 641, height: 401 })).toBe(true)
  })

  it('resizes within MIN_SHARE and the panes’ minimum size', () => {
    const tree = two()
    const wider = resizeSplit(tree, [], 0, 2000, 1175)
    const share = wider.type === 'split' ? (wider.sizes[1] ?? 0) : 0
    expect(share).toBeCloseTo(Math.max(MIN_SHARE, MIN_PANE.width / 1175))
    const narrower = resizeSplit(tree, [], 0, -100, 1175)
    expect(narrower.type === 'split' && narrower.sizes[0]).toBeCloseTo(0.5 - 100 / 1175)
  })

  it('resizes a nested split by its path, and evens a pair out again', () => {
    const tree = resizeSplit(three(), [1], 0, 100, 899)
    const right = tree.type === 'split' ? tree.children[1] : undefined
    expect(right?.type === 'split' && right.sizes[0]).toBeCloseTo(0.5 + 100 / 899)
    const even = evenSplit(tree, [1], 0)
    const evened = even.type === 'split' ? even.children[1] : undefined
    expect(evened?.type === 'split' && evened.sizes).toEqual([0.5, 0.5])
  })

  it('fits shares so a squeezed pane gets back to its minimum', () => {
    const tree: SplitNode = { type: 'split', dir: 'row', sizes: [0.9, 0.1], children: [pane('a'), pane('b')] }
    const fitted = fitShares(tree, AREA)
    expect(fitted.type === 'split' && (fitted.sizes[1] ?? 0) * 1175).toBeCloseTo(320)
  })
})

describe('adjacentPane', () => {
  const { panes } = measureSplit(three(), 1176, 900)
  it('moves across, up and down between the panes that line up', () => {
    expect(adjacentPane(panes, 'a', 'right')).toBe('b')
    expect(adjacentPane(panes, 'c', 'left')).toBe('a')
    expect(adjacentPane(panes, 'b', 'down')).toBe('c')
    expect(adjacentPane(panes, 'c', 'up')).toBe('b')
    expect(adjacentPane(panes, 'a', 'left')).toBeNull()
    expect(adjacentPane(panes, 'a', 'up')).toBeNull()
  })
})

describe('drops', () => {
  it('splits panes into a middle and four edges', () => {
    expect(dropZone(0.5, 0.5)).toBe('center')
    expect(dropZone(0.1, 0.5)).toBe('left')
    expect(dropZone(0.5, 0.95)).toBe('bottom')
    expect(dropRect({ x: 0, y: 0, width: 100, height: 80 }, 'right')).toEqual({ x: 50, y: 0, width: 50, height: 80 })
  })

  it('finds the pane and zone under the pointer, never the dragged pane itself', () => {
    const tree = two()
    const { panes } = measureSplit(tree, 1176, 900)
    expect(dropTargetAt(tree, panes, 880, 850, 'z', AREA)).toEqual({ id: 'b', zone: 'bottom' })
    expect(dropTargetAt(tree, panes, 880, 450, 'z', AREA)).toEqual({ id: 'b', zone: 'center' })
    expect(dropTargetAt(tree, panes, 880, 450, 'b', AREA)).toBeNull()
    expect(dropTargetAt(tree, panes, 2000, 450, 'z', AREA)).toBeNull()
  })

  it('refuses an edge with four panes open (the middle still replaces), and an edge with no room', () => {
    const tree = four()
    const { panes } = measureSplit(tree, 1176, 900)
    expect(dropTargetAt(tree, panes, 600, 700, 'z', AREA)).toEqual({ id: 'c', zone: 'left', refused: 'max' })
    expect(dropTargetAt(tree, panes, 880, 675, 'z', AREA)).toEqual({ id: 'c', zone: 'center' })
    // Moving a shown pane keeps the count: allowed.
    expect(dropTargetAt(tree, panes, 600, 700, 'a', AREA)).toEqual({ id: 'c', zone: 'left' })
    const small = { width: 700, height: 600 }
    const narrow = measureSplit(two(), small.width, small.height)
    expect(dropTargetAt(two(), narrow.panes, 690, 300, 'z', small)).toEqual({ id: 'b', zone: 'right', refused: 'space' })
  })
})

describe('persistence', () => {
  it('reads a saved split back, dropping unknown, repeated and picker panes', () => {
    const saved = JSON.parse(JSON.stringify(four())) as unknown
    expect(sanitizeSplit(saved, () => true)).toEqual(four())
    expect(shape(sanitizeSplit(saved, (id) => id !== 'd'))).toBe('row(a col(b c))')
    expect(sanitizeSplit(saved, (id) => id === 'a')).toBeNull()
    const repeated = { type: 'split', dir: 'row', sizes: [1, 1, 1], children: [pane('a'), pane('a'), pane('b')] }
    expect(shape(sanitizeSplit(repeated, () => true))).toBe('row(a b)')
    const picker = { type: 'split', dir: 'row', sizes: [1, 1, 1], children: [pane('a'), pane(PICKER_PANE), pane('b')] }
    expect(shape(sanitizeSplit(picker, () => true))).toBe('row(a b)')
  })

  it('rejects malformed input instead of throwing', () => {
    for (const bad of [null, 1, 'x', [], { type: 'split' }, { type: 'split', dir: 'diag', children: [], sizes: [] }, { type: 'split', dir: 'row', children: [pane('a')], sizes: [] }]) {
      expect(sanitizeSplit(bad, () => true)).toBeNull()
    }
    const negative = { type: 'split', dir: 'row', sizes: [-1, 1, 1], children: [pane('a'), pane('b'), pane('c')] }
    expect(shape(sanitizeSplit(negative, () => true))).toBe('row(b c)')
    const five = { type: 'split', dir: 'row', sizes: [1, 1], children: [pane('a'), { type: 'split', dir: 'column', sizes: [1, 1, 1, 1], children: [pane('b'), pane('c'), pane('d'), pane('e')] }] }
    expect(paneIds(sanitizeSplit(five, () => true)!)).toEqual(['a', 'b', 'c', 'd'])
    const mismatched = { type: 'split', dir: 'row', sizes: [1, 1], children: [pane('a'), { type: 'split', dir: 'column', sizes: [1], children: [pane('b'), pane('c')] }] }
    expect(sanitizeSplit(mismatched, () => true)).toBeNull()
  })

  it('saves without the picker, and nothing once a single pane is left', () => {
    const picking = splitPane(two(), 'b', 'bottom', PICKER_PANE)
    expect(shape(persistedSplit(picking))).toBe('row(a b)')
    expect(persistedSplit(splitPane(pane('a'), 'a', 'right', PICKER_PANE))).toBeNull()
    expect(persistedSplit(null)).toBeNull()
  })

  it('lists the sessions shown, without the picker', () => {
    const picking = splitPane(two(), 'b', 'bottom', PICKER_PANE)
    expect(sessionsIn(picking)).toEqual(['a', 'b'])
    expect(hasPane(picking, PICKER_PANE)).toBe(true)
    expect(sessionsIn(null)).toEqual([])
  })
})
