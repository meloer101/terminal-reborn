import { describe, expect, it } from 'vitest'
import { createClaudeDriver } from './claude-driver'
import type { GuiEvent } from '@shared/gui-chat'
import type { DriverIO, ImageBlock, Rec } from './driver'

function driverWith(image: (path: string) => Promise<ImageBlock | null>) {
  const writes: Rec[] = []
  const io: DriverIO = {
    write: (message) => writes.push(message) > 0,
    emit: () => undefined,
    ready: () => undefined,
    agentSession: () => undefined,
    title: () => undefined,
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

  it('marks every message as typed by a person, so Claude names a session that starts with a slash command', async () => {
    const { driver, writes } = driverWith(() => Promise.resolve(null))
    expect(await driver.send('/archify draw this project', [])).toBe(true)
    expect(writes.at(-1)).toEqual({ type: 'user', message: { role: 'user', content: '/archify draw this project' }, origin: { kind: 'human' } })
  })
})

describe('Claude driver · the / menu (Figma 59H)', () => {
  it('marks skills from each turn’s system/init on the commands from initialize and commands_changed', () => {
    const emitted: GuiEvent[] = []
    const io: DriverIO = {
      write: () => true,
      emit: (events) => void emitted.push(...events),
      ready: () => undefined,
      agentSession: () => undefined,
      title: () => undefined,
      turnEnd: () => undefined,
      fail: () => undefined,
      image: () => Promise.resolve(null),
      relaunch: () => Promise.resolve(false)
    }
    const driver = createClaudeDriver(io, { cwd: '/w', clientVersion: '0' })
    const latest = () => emitted.filter((e) => e.type === 'commands').at(-1)
    const kinds = () => {
      const event = latest()
      return event?.type === 'commands' ? event.commands.map((c) => `${c.name}:${c.kind}`) : []
    }
    // A reattached session's kept `initialize` answer.
    driver.line({ type: 'control_response', response: { subtype: 'success', request_id: 'old', response: { commands: [{ name: 'compact', description: '' }, { name: 'research', description: '' }], models: [] } } }, true)
    expect(kinds()).toEqual(['compact:command', 'research:command'])
    driver.line({ type: 'system', subtype: 'init', session_id: 's', skills: ['research'], slash_commands: ['compact', 'research'] }, false)
    expect(kinds()).toEqual(['compact:command', 'research:skill'])
    driver.line({ type: 'system', subtype: 'commands_changed', commands: [{ name: 'research', description: '' }, { name: 'review', description: '' }] }, false)
    expect(kinds()).toEqual(['research:skill', 'review:command'])
  })
})
