import { beforeEach, describe, expect, it } from 'vitest'
import { addTab, adoptTabs, nextTabId, removeTab, selectTab, setTabTitle, tabsOf, usePanelTerminals } from './store'

beforeEach(() => usePanelTerminals.setState({ worktrees: {}, titles: {}, issued: {} }))

describe('终端 view tabs', () => {
  it('numbers new tabs per worktree and shows the newest', () => {
    const first = nextTabId('w-a')
    addTab(first)
    const second = nextTabId('w-a')
    addTab(second)
    addTab(nextTabId('w-b'))
    expect(tabsOf('w-a')).toEqual({ ids: ['panel-w-a-1', 'panel-w-a-2'], active: 'panel-w-a-2' })
    expect(tabsOf('w-b').ids).toEqual(['panel-w-b-1'])
    expect(tabsOf('w-c')).toEqual({ ids: [], active: null })
  })

  it('never hands out a closed tab’s number again, nor one the daemon still runs', () => {
    addTab(nextTabId('w-a'))
    const second = nextTabId('w-a')
    addTab(second)
    removeTab(second)
    expect(nextTabId('w-a')).toBe('panel-w-a-3')
    expect(nextTabId('w-b', ['panel-w-b-7', 'panel-w-a-9'])).toBe('panel-w-b-8')
  })

  it('closing the shown tab shows the one after it, else the one before; the last leaves none', () => {
    for (const n of [1, 2, 3]) addTab(`panel-w-a-${n}`)
    selectTab('panel-w-a-2')
    removeTab('panel-w-a-2')
    expect(tabsOf('w-a')).toEqual({ ids: ['panel-w-a-1', 'panel-w-a-3'], active: 'panel-w-a-3' })
    removeTab('panel-w-a-3')
    expect(tabsOf('w-a').active).toBe('panel-w-a-1')
    removeTab('panel-w-a-1')
    expect(tabsOf('w-a')).toEqual({ ids: [], active: null })
  })

  it('closing a tab that is not shown keeps the shown one', () => {
    addTab('panel-w-a-1')
    addTab('panel-w-a-2')
    removeTab('panel-w-a-1')
    expect(tabsOf('w-a')).toEqual({ ids: ['panel-w-a-2'], active: 'panel-w-a-2' })
  })

  it('adopts running shells in number order, keeping the shown tab', () => {
    adoptTabs('w-a', ['panel-w-a-3', 'panel-w-a-1', 'panel-w-b-1', 's-1'])
    expect(tabsOf('w-a')).toEqual({ ids: ['panel-w-a-1', 'panel-w-a-3'], active: 'panel-w-a-1' })
    selectTab('panel-w-a-3')
    adoptTabs('w-a', ['panel-w-a-2', 'panel-w-a-3'])
    expect(tabsOf('w-a')).toEqual({ ids: ['panel-w-a-1', 'panel-w-a-2', 'panel-w-a-3'], active: 'panel-w-a-3' })
    expect(tabsOf('w-b').ids).toEqual([])
  })

  it('keeps the shell’s title while its tab is open', () => {
    addTab('panel-w-a-1')
    setTabTitle('panel-w-a-1', ' pnpm dev ')
    expect(usePanelTerminals.getState().titles['panel-w-a-1']).toBe('pnpm dev')
    setTabTitle('panel-w-a-1', '')
    expect(usePanelTerminals.getState().titles['panel-w-a-1']).toBeUndefined()
    setTabTitle('panel-w-a-1', 'vim')
    removeTab('panel-w-a-1')
    setTabTitle('panel-w-a-1', 'late')
    expect(usePanelTerminals.getState().titles).toEqual({})
  })
})
