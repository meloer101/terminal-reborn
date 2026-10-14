import { describe, expect, it } from 'vitest'
import { parseMenuEntries } from './menu-spec'

describe('parseMenuEntries', () => {
  it('accepts items, separators and submenus', () => {
    const entries = [
      { type: 'item', id: 'new:claude', label: 'Claude Code' },
      { type: 'separator' },
      { type: 'submenu', label: 'acme', items: [{ type: 'item', id: 'x', label: 'X', enabled: false }] }
    ]
    expect(parseMenuEntries(entries)).toEqual(entries)
  })

  it('drops unknown fields', () => {
    expect(parseMenuEntries([{ type: 'item', id: 'a', label: 'A', click: 'evil' }])).toEqual([
      { type: 'item', id: 'a', label: 'A' }
    ])
  })

  it.each([
    ['not an array', {}],
    ['unknown type', [{ type: 'role', role: 'quit' }]],
    ['bad id', [{ type: 'item', id: 'a b', label: 'A' }]],
    ['empty label', [{ type: 'item', id: 'a', label: '' }]],
    ['too deep', [{ type: 'submenu', label: 'a', items: [{ type: 'submenu', label: 'b', items: [{ type: 'submenu', label: 'c', items: [] }] }] }]]
  ])('rejects %s', (_name, payload) => {
    expect(() => parseMenuEntries(payload)).toThrow()
  })
})
