import { describe, expect, it } from 'vitest'
import { createClaudeDriver } from './claude-driver'
import type { DriverIO, ImageBlock, Rec } from './driver'

function driverWith(image: (path: string) => Promise<ImageBlock | null>) {
  const writes: Rec[] = []
  const io: DriverIO = {
    write: (message) => writes.push(message) > 0,
    emit: () => undefined,
    ready: () => undefined,
    agentSession: () => undefined,
    turnEnd: () => undefined,
    fail: () => undefined,
    image,
    relaunch: () => Promise.resolve(false)
  }
  return { driver: createClaudeDriver(io, { cwd: '/w', clientVersion: '0' }), writes }
}

describe('Claude driver · send', () => {
  it('inlines images up to 20 MB per message and names the rest by path (one line must fit the daemon’s frame)', async () => {
    // 5 MB each, the most Claude takes per image.
    const fiveMb: ImageBlock = { mediaType: 'image/png', data: 'A'.repeat(((5 * 1024 * 1024) / 3) * 4) }
    const { driver, writes } = driverWith(() => Promise.resolve(fiveMb))
    const shots = Array.from({ length: 6 }, (_, i) => `/tmp/shot-${i}.png`)
    expect(await driver.send('look', shots)).toBe(true)
    const content = (writes.at(-1)!.message as { content: Rec[] }).content
    expect(content.filter((b) => b.type === 'image')).toHaveLength(4)
    expect(content[0]).toEqual({ type: 'text', text: 'look\n\n/tmp/shot-4.png\n/tmp/shot-5.png' })
  })
})
