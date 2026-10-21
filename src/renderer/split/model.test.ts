import { describe, expect, it } from 'vitest'
import { pane, splitPane } from '@shared/split-layout'
import { mockProjects, mockSessions, mockWorktrees } from '../state/mock-data'
import { dropLabel, pickerRows } from './model'

const input = { projects: mockProjects, worktrees: mockWorktrees, sessions: mockSessions, now: Date.now(), filter: '' }

describe('pickerRows', () => {
  it('lists the sessions not shown yet, in sidebar order', () => {
    const split = splitPane(pane('s-cookie'), 's-cookie', 'right', 's-sidebar')
    expect(pickerRows({ ...input, split }).map((r) => r.session.id)).toEqual(['s-perf', 's-nav', 's-acme-main', 's-graph'])
  })

  it('filters like the overview, and leaves archived worktrees out', () => {
    expect(pickerRows({ ...input, split: null, filter: 'p:terminal' }).map((r) => r.session.id)).toEqual(['s-sidebar', 's-graph'])
    const worktrees = mockWorktrees.map((w) => (w.id === 'w-graph' ? { ...w, archived: { id: 'abcd1234', at: 1, commit: 'a'.repeat(40), dirty: false } } : w))
    expect(pickerRows({ ...input, worktrees, split: null }).map((r) => r.session.id)).not.toContain('s-graph')
  })
})

describe('dropLabel', () => {
  const split = splitPane(pane('a'), 'a', 'right', 'b')
  it('says what a drop does', () => {
    expect(dropLabel({ id: 'b', zone: 'right' }, 'z', split)).toBe('松开在这里显示这个会话')
    expect(dropLabel({ id: 'b', zone: 'center' }, 'z', split)).toBe('松开换掉这一格')
    expect(dropLabel({ id: 'b', zone: 'center' }, 'a', split)).toBe('松开交换这两格')
    expect(dropLabel({ id: 'b', zone: 'top' }, 'a', split)).toBe('松开把这一格挪到这里')
    expect(dropLabel({ id: 'b', zone: 'left', refused: 'max' }, 'z', split)).toBe('最多 4 格 · 放到格子中间来替换')
  })
})
