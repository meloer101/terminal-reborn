// An open menu that follows live state (U5: the merge chain's ⋯ menu while the preflight answers).
import { describe, expect, it, vi } from 'vitest'
import type { MenuEntry } from './menu-model'

vi.mock('../app-shell/windows-runtime', () => ({ keyDocument: () => ({ activeElement: null, body: null }) }))

const { closeMenu, popupMenu, updateMenu, useMenu } = await import('./menu')

/** A control a menu drops down from, as far as menu.ts touches it. */
function control(): Element {
  const attributes = new Map<string, string>()
  return {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 10, bottom: 10 }),
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    contains: () => false,
    ownerDocument: { activeElement: null, body: null }
  } as unknown as Element
}

const item = (id: string, enabled: boolean, detail?: string): MenuEntry => ({ type: 'item', id, label: id, enabled, ...(detail ? { detail } : {}) })

describe('updateMenu', () => {
  it('replaces the entries of the menu the control opened, in the same menu', async () => {
    const anchor = control()
    const chosen = popupMenu([item('sync', false, '正在检查…')], anchor)
    const serial = useMenu.getState().menu!.serial
    expect(updateMenu(anchor, [item('sync', true)])).toBe(true)
    expect(useMenu.getState().menu).toMatchObject({ serial, entries: [item('sync', true)] })
    closeMenu('sync')
    await expect(chosen).resolves.toBe('sync')
  })

  it('leaves a menu another control opened, and does nothing once it is closed', async () => {
    const mine = control()
    const other = control()
    const chosen = popupMenu([item('a', true)], other)
    expect(updateMenu(mine, [item('b', true)])).toBe(false)
    expect(useMenu.getState().menu?.entries).toEqual([item('a', true)])
    closeMenu(null)
    await chosen
    expect(updateMenu(other, [item('b', true)])).toBe(false)
    expect(useMenu.getState().menu).toBeNull()
  })
})
