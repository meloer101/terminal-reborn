import { describe, expect, it } from 'vitest'
import {
  addToLayout,
  cornerTile,
  dropRect,
  dropZone,
  layoutIds,
  measureLayout,
  MIN_PANEL,
  MIN_SHARE,
  PANEL_MARGIN,
  moveInLayout,
  PICKER_SLOT,
  removeFromLayout,
  replaceInLayout,
  resizeColumns,
  resizeRect,
  fitRect,
  resizeRows,
  singleLayout,
  type PaneLayout
} from './pane-layout'

const build = (...ids: string[]): PaneLayout => ids.slice(1).reduce(addToLayout, singleLayout(ids[0] ?? 'a'))
const shape = (l: PaneLayout): string[][] => l.columns.map((c) => c.ids)

describe('addToLayout', () => {
  it('fills 1 → 2 side by side → 3 one + two stacked → 4 a 2×2 grid', () => {
    expect(shape(build('a'))).toEqual([['a']])
    expect(shape(build('a', 'b'))).toEqual([['a'], ['b']])
    expect(shape(build('a', 'b', 'c'))).toEqual([['a'], ['b', 'c']])
    expect(shape(build('a', 'b', 'c', 'd'))).toEqual([['a', 'd'], ['b', 'c']])
  })

  it('never adds a session twice or a fifth one', () => {
    const four = build('a', 'b', 'c', 'd')
    expect(addToLayout(four, 'e')).toBe(four)
    expect(addToLayout(build('a'), 'a')).toEqual(build('a'))
  })

  it('splits the target evenly', () => {
    expect(build('a', 'b').sizes).toEqual([0.5, 0.5])
    expect(build('a', 'b', 'c').columns[1]?.sizes).toEqual([0.5, 0.5])
  })
})

describe('removeFromLayout', () => {
  it('gives the space to the neighbours and drops an empty column', () => {
    const l = removeFromLayout(build('a', 'b', 'c'), 'a')
    expect(shape(l)).toEqual([['b', 'c']])
    expect(l.sizes).toEqual([1])
    const r = removeFromLayout(build('a', 'b', 'c'), 'c')
    expect(shape(r)).toEqual([['a'], ['b']])
    expect(r.columns[1]?.sizes).toEqual([1])
  })
})

describe('moveInLayout', () => {
  const three = build('a', 'b', 'c')

  it('swaps on the middle: the tall left tile goes to the right, top or bottom', () => {
    expect(shape(moveInLayout(three, 'a', 'b', 'center'))).toEqual([['b'], ['a', 'c']])
    expect(shape(moveInLayout(three, 'a', 'c', 'center'))).toEqual([['c'], ['b', 'a']])
  })

  it('puts the tile above / below the target in its column', () => {
    const l = moveInLayout(build('a', 'b'), 'a', 'b', 'bottom')
    expect(shape(l)).toEqual([['b', 'a']])
    expect(l.columns[0]?.sizes).toEqual([0.5, 0.5])
    expect(shape(moveInLayout(three, 'a', 'b', 'top'))).toEqual([['a', 'b', 'c']])
  })

  it('puts the tile in a new column beside the target', () => {
    const l = moveInLayout(three, 'c', 'a', 'left')
    expect(shape(l)).toEqual([['c'], ['a'], ['b']])
    expect(l.sizes).toEqual([0.25, 0.25, 0.5])
    expect(shape(moveInLayout(three, 'a', 'c', 'right'))).toEqual([['b', 'c'], ['a']])
  })

  it('ignores dropping a tile on itself or an unknown one', () => {
    expect(moveInLayout(three, 'a', 'a', 'left')).toBe(three)
    expect(moveInLayout(three, 'a', 'x', 'left')).toBe(three)
  })
})

describe('resizing', () => {
  it('moves the boundary and keeps both sides at least MIN_SHARE', () => {
    const two = build('a', 'b')
    const wider = resizeColumns(two, 0, 0.2).sizes
    expect(wider[0]).toBeCloseTo(0.7)
    expect(wider[1]).toBeCloseTo(0.3)
    expect(resizeColumns(two, 0, 0.9).sizes[1]).toBeCloseTo(MIN_SHARE)
    expect(resizeColumns(two, 0, -0.9).sizes[0]).toBeCloseTo(MIN_SHARE)
    expect(resizeRows(build('a', 'b', 'c'), 1, 0, -0.1).columns[1]?.sizes[0]).toBeCloseTo(0.4)
  })
})

describe('measureLayout', () => {
  it('places tiles and the gaps between them as handles', () => {
    const { tiles, handles } = measureLayout(build('a', 'b', 'c'), 1012, 512, 12)
    expect(tiles).toEqual([
      { id: 'a', x: 0, y: 0, width: 500, height: 512 },
      { id: 'b', x: 512, y: 0, width: 500, height: 250 },
      { id: 'c', x: 512, y: 262, width: 500, height: 250 }
    ])
    expect(handles).toEqual([
      { kind: 'column', index: 0, x: 500, y: 0, width: 12, height: 512 },
      { kind: 'row', column: 1, index: 0, x: 512, y: 250, width: 500, height: 12 }
    ])
  })
})

describe('drop zones', () => {
  it('the middle swaps, otherwise the nearest edge', () => {
    expect(dropZone(0.5, 0.5)).toBe('center')
    expect(dropZone(0.1, 0.5)).toBe('left')
    expect(dropZone(0.9, 0.4)).toBe('right')
    expect(dropZone(0.5, 0.05)).toBe('top')
    expect(dropZone(0.6, 0.95)).toBe('bottom')
  })

  it('previews the half of the tile the drop takes', () => {
    const tile = { x: 10, y: 20, width: 100, height: 60 }
    expect(dropRect(tile, 'right')).toEqual({ x: 60, y: 20, width: 50, height: 60 })
    expect(dropRect(tile, 'bottom')).toEqual({ x: 10, y: 50, width: 100, height: 30 })
    expect(dropRect(tile, 'center')).toBe(tile)
  })
})

it('the top-right tile carries the add button', () => {
  expect(cornerTile(build('a'))).toBe('a')
  expect(cornerTile(build('a', 'b', 'c'))).toBe('b')
  expect(layoutIds(build('a', 'b', 'c'))).toEqual(['a', 'b', 'c'])
})

describe('the picker slot', () => {
  it('takes a tile but is not a session', () => {
    const picking = addToLayout(build('a', 'b', 'c'), PICKER_SLOT)
    expect(shape(picking)).toEqual([['a', PICKER_SLOT], ['b', 'c']])
    expect(layoutIds(picking)).toEqual(['a', 'b', 'c'])
    expect(addToLayout(picking, 'd')).toBe(picking)
  })

  it('hands its tile, as resized, to the picked session', () => {
    const picking = resizeRows(resizeColumns(addToLayout(build('a', 'b', 'c'), PICKER_SLOT), 0, 0.1), 0, 0, -0.2)
    const picked = replaceInLayout(picking, PICKER_SLOT, 'd')
    expect(shape(picked)).toEqual([['a', 'd'], ['b', 'c']])
    expect(picked.sizes).toEqual(picking.sizes)
    expect(picked.columns[0]?.sizes).toEqual(picking.columns[0]?.sizes)
    expect(replaceInLayout(picking, PICKER_SLOT, 'a')).toBe(picking)
  })
})

describe('resizeRect', () => {
  const viewport = { width: 1440, height: 900 }
  const start = { x: 200, y: 100, width: 1000, height: 600 }

  it('moves only the dragged edges', () => {
    expect(resizeRect(start, 'e', 50, 0, viewport)).toEqual({ x: 200, y: 100, width: 1050, height: 600 })
    expect(resizeRect(start, 'w', 50, 0, viewport)).toEqual({ x: 250, y: 100, width: 950, height: 600 })
    expect(resizeRect(start, 'n', 0, -40, viewport)).toEqual({ x: 200, y: 60, width: 1000, height: 640 })
    expect(resizeRect(start, 'se', -100, 30, viewport)).toEqual({ x: 200, y: 100, width: 900, height: 630 })
  })

  it('stays inside the window less its margin and above the minimum', () => {
    expect(resizeRect(start, 'e', 1000, 0, viewport).width).toBe(1440 - PANEL_MARGIN - 200)
    expect(resizeRect(start, 'w', -1000, 0, viewport).x).toBe(PANEL_MARGIN)
    expect(resizeRect(start, 'nw', 2000, 2000, viewport)).toEqual({ x: 1200 - MIN_PANEL.width, y: 700 - MIN_PANEL.height, ...MIN_PANEL })
  })

  it('fits a remembered rect into a smaller window', () => {
    expect(fitRect(start, { width: 1000, height: 700 })).toEqual({ x: 16, y: 84, width: 968, height: 600 })
    expect(fitRect(start, viewport)).toEqual(start)
  })
})
