import { describe, expect, it } from 'vitest'
import { PortWatches } from './port-watches'

const vite = { port: 5173, pid: 1, host: 'localhost', label: 'vite' }

describe('PortWatches', () => {
  it('counts watchers per window and session', () => {
    const w = new PortWatches<string>()
    expect(w.add('win', 's1')).toBe(true)
    expect(w.add('win', 's1')).toBe(false)
    expect(w.add('win', 's2')).toBe(false)
    expect(w.size).toBe(2)
    w.remove('win', 's1')
    expect(w.size).toBe(2)
    w.remove('win', 's1')
    expect(w.size).toBe(1)
    w.remove('win', 's2')
    expect(w.size).toBe(0)
    expect(w.hasOwner('win')).toBe(false)
    // Unknown removals are ignored.
    w.remove('win', 's9')
    expect(w.size).toBe(0)
  })

  it('drops every watch of a window that reloaded or crashed', () => {
    const w = new PortWatches<string>()
    w.add('win', 's1')
    w.add('win', 's1')
    w.add('other', 's1')
    w.dropOwner('win')
    expect(w.all().map((x) => x.owner)).toEqual(['other'])
    // The reloaded window watches again from scratch.
    expect(w.add('win', 's1')).toBe(true)
    w.remove('win', 's1')
    expect(w.hasOwner('win')).toBe(false)
  })

  it('sends a scan only when it changed, or to a new watcher', () => {
    const w = new PortWatches<string>()
    w.add('win', 's1')
    const [watch] = w.all()
    expect(w.update(watch!, [])).toBe(true)
    expect(w.update(watch!, [])).toBe(false)
    expect(w.update(watch!, [vite])).toBe(true)
    w.add('win', 's1')
    expect(w.update(watch!, [vite])).toBe(true)
  })
})
