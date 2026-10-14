import { describe, expect, it, vi } from 'vitest'
import { createDraftStore } from './drafts'

describe('draft store', () => {
  it('keeps drafts separate per session', () => {
    const store = createDraftStore()
    store.set('a', 'one')
    store.set('b', 'two')
    expect(store.get('a')).toBe('one')
    expect(store.get('b')).toBe('two')
    expect(store.get('c')).toBe('')
  })

  it('starts from saved drafts and ignores empty ones', () => {
    const store = createDraftStore({ a: '多行\n草稿', b: '' })
    expect(store.get('a')).toBe('多行\n草稿')
    expect(store.snapshot()).toEqual({ a: '多行\n草稿' })
  })

  it('removes the entry when text becomes empty', () => {
    const store = createDraftStore()
    store.set('a', 'x')
    store.set('a', '')
    expect(store.snapshot()).toEqual({})
  })

  it('deletes the draft of a closed session', () => {
    const onChange = vi.fn()
    const store = createDraftStore({ a: 'x', b: 'y' }, onChange)
    store.remove('a')
    expect(store.get('a')).toBe('')
    expect(store.snapshot()).toEqual({ b: 'y' })
    expect(onChange).toHaveBeenCalledTimes(1)
    store.remove('a')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reports real changes only', () => {
    const onChange = vi.fn()
    const store = createDraftStore({}, onChange)
    store.set('a', '')
    expect(onChange).not.toHaveBeenCalled()
    store.set('a', 'x')
    store.set('a', 'x')
    store.set('a', 'xy')
    store.set('a', '')
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('snapshot is a copy', () => {
    const store = createDraftStore({ a: 'x' })
    const copy = store.snapshot()
    copy.a = 'changed'
    expect(store.get('a')).toBe('x')
  })
})
