import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PiInbox, writeInbox } from './deliver'

let server: Server | null = null
let dir = ''

afterEach(() => {
  server?.close()
  server = null
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function inboxServer(): Promise<{ socket: string; received: () => string }> {
  dir = mkdtempSync(join(tmpdir(), 'wavi-inbox-'))
  const socket = join(dir, 'i.sock')
  let data = ''
  server = createServer((conn) => conn.on('data', (chunk) => (data += chunk.toString())))
  return new Promise((resolve) => server!.listen(socket, () => resolve({ socket, received: () => data })))
}

describe('writeInbox', () => {
  it('writes the auth line and then the message, one JSON object per line', async () => {
    const inbox = await inboxServer()
    expect(await writeInbox({ socket: inbox.socket, token: 'tok' }, '报告\n第二行')).toBe(true)
    expect(inbox.received().split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown)).toEqual([
      { type: 'auth', token: 'tok' },
      { type: 'user', message: { role: 'user', content: '报告\n第二行' } }
    ])
  })

  it('fails when nothing listens', async () => {
    expect(await writeInbox({ socket: join(tmpdir(), 'wavi-no-such.sock'), token: 'x' }, 'hi')).toBe(false)
  })
})

describe('PiInbox (PRD F21: Pi’s messages over the hook socket)', () => {
  it('holds messages for an extension that asked lately and hands them over once', () => {
    let now = 0
    const inbox = new PiInbox(() => now)
    expect(inbox.put('s1', 'too early')).toBe(false)
    expect(inbox.take('s1')).toEqual([])
    now = 1_000
    expect(inbox.put('s1', 'report')).toBe(true)
    expect(inbox.take('s1')).toEqual(['report'])
    expect(inbox.take('s1')).toEqual([])
  })

  it('has no channel once the extension has not asked for 5 s (not loaded, or the Pi exited)', () => {
    let now = 0
    const inbox = new PiInbox(() => now)
    inbox.take('s1')
    now = 6_000
    expect(inbox.put('s1', 'report')).toBe(false)
  })
})
