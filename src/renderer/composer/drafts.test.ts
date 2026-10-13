import { describe, expect, it } from 'vitest'
import { createDraftStore, DRAFTS_STORAGE_KEY } from './drafts'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    }
  }
}

describe('draft store', () => {
  it('keeps drafts separate per session', () => {
    const store = createDraftStore(memoryStorage())
    store.set('a', 'one')
    store.set('b', 'two')
    expect(store.get('a')).toBe('one')
    expect(store.get('b')).toBe('two')
    expect(store.get('c')).toBe('')
  })

  it('persists across store instances (app restart)', () => {
    const storage = memoryStorage()
    createDraftStore(storage).set('a', '多行\n草稿')
    expect(createDraftStore(storage).get('a')).toBe('多行\n草稿')
  })

  it('removes the entry when text becomes empty', () => {
    const storage = memoryStorage()
    const store = createDraftStore(storage)
    store.set('a', 'x')
    store.set('a', '')
    expect(JSON.parse(storage.data[DRAFTS_STORAGE_KEY] ?? '')).toEqual({})
  })

  it('ignores corrupt or malformed persisted data', () => {
    expect(createDraftStore(memoryStorage({ [DRAFTS_STORAGE_KEY]: '{not json' })).get('a')).toBe('')
    expect(createDraftStore(memoryStorage({ [DRAFTS_STORAGE_KEY]: '[1,2]' })).get('a')).toBe('')
    const mixed = memoryStorage({ [DRAFTS_STORAGE_KEY]: '{"a":5,"b":"ok"}' })
    expect(createDraftStore(mixed).get('a')).toBe('')
    expect(createDraftStore(mixed).get('b')).toBe('ok')
  })

  it('works without storage', () => {
    const store = createDraftStore(null)
    store.set('a', 'x')
    expect(store.get('a')).toBe('x')
  })

  it('survives a throwing storage', () => {
    const store = createDraftStore({
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      }
    })
    store.set('a', 'x')
    expect(store.get('a')).toBe('x')
  })
})
