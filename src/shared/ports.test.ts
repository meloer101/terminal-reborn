import { describe, expect, it } from 'vitest'
import { allocatePortBlock, DEFAULT_PORT_BASE, portBlockCount, portOf } from './ports'

const all = () => true

describe('port blocks', () => {
  it('are blocks of 10 from the base', () => {
    expect(portOf(DEFAULT_PORT_BASE, 0)).toBe(41000)
    expect(portOf(DEFAULT_PORT_BASE, 3)).toBe(41030)
    expect(portBlockCount(65530)).toBe(0)
    expect(portBlockCount(65526)).toBe(1)
    // The last block ends at 65535.
    expect(portOf(41000, portBlockCount(41000) - 1) + 9).toBeLessThanOrEqual(65535)
  })

  it('keep a folder on the block it has', () => {
    const result = allocatePortBlock({ '/w/a': 4 }, '/w/a', 41000, all)
    expect(result).toEqual({ assigned: { '/w/a': 4 }, index: 4 })
  })

  it('give a new folder the lowest free block, never one in use', () => {
    const result = allocatePortBlock({ '/w/a': 0, '/w/b': 2 }, '/w/c', 41000, all)
    expect(result?.index).toBe(1)
    expect(result?.assigned).toEqual({ '/w/a': 0, '/w/b': 2, '/w/c': 1 })
    let assigned: Record<string, number> = {}
    for (let n = 0; n < 50; n++) assigned = allocatePortBlock(assigned, `/w/${n}`, 41000, all)!.assigned
    expect(new Set(Object.values(assigned)).size).toBe(50)
  })

  it('give back blocks of folders that are gone', () => {
    const exists = (path: string) => path !== '/w/gone'
    const result = allocatePortBlock({ '/w/gone': 0, '/w/b': 1 }, '/w/new', 41000, exists)
    expect(result).toEqual({ assigned: { '/w/b': 1, '/w/new': 0 }, index: 0 })
  })

  it('move a folder whose block no longer fits under a higher base, and fail when none is left', () => {
    const base = 65500 // three blocks: 65500, 65510, 65520
    expect(allocatePortBlock({ '/w/a': 9 }, '/w/a', base, all)?.index).toBe(0)
    expect(allocatePortBlock({ '/w/a': 0, '/w/b': 1, '/w/c': 2 }, '/w/d', base, all)).toBeNull()
  })
})
