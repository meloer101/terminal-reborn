import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PhoneEvent } from '@shared/remote'
import { FeedHub, type FeedSource } from './feed'

const line = (o: object): string => JSON.stringify({ timestamp: '2026-11-01T10:00:00.000Z', cwd: '/w', ...o }) + '\n'
const user = (text: string) => line({ type: 'user', message: { content: text } })
const reply = (text: string) => line({ type: 'assistant', message: { id: text, content: [{ type: 'text', text }] } })

afterEach(() => vi.useRealTimers())

function setup(sources: Record<string, FeedSource | null>) {
  const pushed: { to: string; event: PhoneEvent }[] = []
  const triggers = new Map<string, () => void>()
  let watchers = 0
  const hub = new FeedHub({
    sourceOf: (id) => sources[id] ?? null,
    push: (to, event) => pushed.push({ to, event }),
    watchFile: (path, onChange) => {
      triggers.set(path, onChange)
      watchers++
      return { close: () => watchers-- } as never
    }
  })
  return { hub, pushed, triggers, watchers: () => watchers }
}

describe('FeedHub', () => {
  it('serves pages, newest first by default, and older ones before an index', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'))
    const path = join(dir, 's.jsonl')
    writeFileSync(path, Array.from({ length: 250 }, (_, i) => user(`q${i}`)).join(''))
    const { hub, watchers } = setup({ s1: { agent: 'claude', path } })
    const newest = await hub.page('s1')
    expect(newest).toMatchObject({ start: 50, total: 250 })
    expect(newest!.items).toHaveLength(200)
    const older = await hub.page('s1', 50)
    expect(older).toMatchObject({ start: 0, total: 250 })
    expect(older!.items[0]).toMatchObject({ text: 'q0' })
    expect(await hub.page('nope')).toBeNull()
    // Nobody watches: nothing stays open.
    expect(watchers()).toBe(0)
  })

  it('pushes what is appended to the phones watching the session, and stops when they leave', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'))
    const path = join(dir, 's.jsonl')
    writeFileSync(path, user('hi'))
    const { hub, pushed, triggers, watchers } = setup({ s1: { agent: 'claude', path } })
    await hub.page('s1')
    hub.watch('c1', 's1')
    await hub.page('s1')
    expect(watchers()).toBe(1)
    appendFileSync(path, reply('hello'))
    triggers.get(path)!()
    await vi.waitFor(() => expect(pushed).toHaveLength(1))
    expect(pushed[0]).toMatchObject({ to: 'c1', event: { event: 'feed', data: { session: 's1', start: 1, items: [{ kind: 'text', text: 'hello' }] } } })
    hub.drop('c1')
    expect(watchers()).toBe(0)
  })

  it('reads a half-written last line once it is complete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'))
    const path = join(dir, 's.jsonl')
    const whole = reply('done')
    writeFileSync(path, user('a') + whole.slice(0, 20))
    const { hub } = setup({ s1: { agent: 'claude', path } })
    hub.watch('c1', 's1')
    expect((await hub.page('s1'))!.items).toHaveLength(1)
    appendFileSync(path, whole.slice(20))
    expect((await hub.page('s1'))!.items.map((i) => i.kind)).toEqual(['user', 'text'])
    hub.drop('c1')
  })

  it('keeps a Chinese character whole when a write stops in the middle of it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'))
    const path = join(dir, 's.jsonl')
    const bytes = Buffer.from(user('续期失败'))
    // Cut inside the 3-byte UTF-8 of 失.
    const cut = bytes.indexOf(Buffer.from('失')) + 1
    writeFileSync(path, bytes.subarray(0, cut))
    const { hub } = setup({ s1: { agent: 'claude', path } })
    hub.watch('c1', 's1')
    expect((await hub.page('s1'))!.items).toHaveLength(0)
    appendFileSync(path, bytes.subarray(cut))
    expect((await hub.page('s1'))!.items[0]).toMatchObject({ text: '续期失败' })
    hub.drop('c1')
  })

  it('pushes to the watchers what a page request read, and everything anew when the file shrank', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'))
    const path = join(dir, 's.jsonl')
    writeFileSync(path, user('one'))
    const { hub, pushed } = setup({ s1: { agent: 'claude', path } })
    hub.watch('c1', 's1')
    await hub.page('s1')
    appendFileSync(path, user('two'))
    await hub.page('s1', 1)
    expect(pushed).toEqual([{ to: 'c1', event: { event: 'feed', data: { session: 's1', start: 1, items: [expect.objectContaining({ text: 'two' })] } } }])
    writeFileSync(path, user('fresh'))
    await hub.page('s1')
    expect(pushed[1]).toEqual({ to: 'c1', event: { event: 'feed', data: { session: 's1', start: 0, reset: true, items: [expect.objectContaining({ text: 'fresh' })] } } })
    hub.drop('c1')
  })

  it('starts over when the session moves to another transcript', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'))
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    writeFileSync(a, user('old'))
    writeFileSync(b, user('new'))
    const sources: Record<string, FeedSource> = { s1: { agent: 'claude', path: a } }
    const { hub, pushed } = setup(sources)
    hub.watch('c1', 's1')
    expect((await hub.page('s1'))!.items[0]).toMatchObject({ text: 'old' })
    sources.s1 = { agent: 'claude', path: b }
    expect((await hub.page('s1'))!.items[0]).toMatchObject({ text: 'new' })
    expect(pushed).toContainEqual({ to: 'c1', event: { event: 'feed', data: { session: 's1', items: [], start: 0, reset: true } } })
    hub.drop('c1')
  })
})
