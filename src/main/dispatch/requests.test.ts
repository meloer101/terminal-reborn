// A real folder: how `wavi` (cli.ts) and main meet. The CLI's side is played by writing the same files it writes.
import { existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { waviOk, type WaviResult } from '@shared/dispatch'
import { waviTokenFor, WaviRequests, type WaviCall } from './requests'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-wavi-requests-')))
afterAll(() => rmSync(base, { recursive: true, force: true }))

let running: WaviRequests | null = null
afterEach(() => running?.stop())

function start(handle: (call: WaviCall) => Promise<WaviResult>, name: string) {
  const root = join(base, name)
  running = new WaviRequests({ root, secret: 'f'.repeat(64), handle })
  return { root, requests: running }
}

function ask(dir: string, id: string, body: unknown): void {
  const file = join(dir, 'req', `${id}.json`)
  writeFileSync(`${file}.tmp`, JSON.stringify(body))
  renameSync(`${file}.tmp`, file)
}

async function answerOf(dir: string, id: string, timeout = 3_000): Promise<unknown> {
  const file = join(dir, 'res', `${id}.json`)
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
    await new Promise((r) => setTimeout(r, 25))
  }
  return null
}

describe('WaviRequests', () => {
  it('answers a request with the right token, after checking its command', async () => {
    const calls: WaviCall[] = []
    const { root, requests } = start(async (call) => {
      calls.push(call)
      return waviOk('listed')
    }, 'ok')
    await requests.start()
    const session = await requests.ensureSession('s-abc')
    expect(session?.dir).toBe(join(root, 's-abc'))
    expect(statSync(root).mode & 0o777).toBe(0o700)
    ask(session!.dir, 'aa11bb22', { v: 1, token: session!.token, command: { name: 'ls' }, inbox: { socket: '/tmp/cc-socks/1.sock', token: 'tok' } })
    expect(await answerOf(session!.dir, 'aa11bb22')).toEqual({ ok: true, text: 'listed' })
    expect(existsSync(join(session!.dir, 'req', 'aa11bb22.json'))).toBe(false)
    expect(calls).toEqual([{ sessionId: 's-abc', command: { name: 'ls' }, inbox: { socket: '/tmp/cc-socks/1.sock', token: 'tok' } }])
  })

  it('refuses a bad command without asking the window, and stays silent for a wrong token', async () => {
    let asked = 0
    const { requests } = start(async () => {
      asked++
      return waviOk('x')
    }, 'refuse')
    await requests.start()
    const session = (await requests.ensureSession('s-1'))!
    ask(session.dir, 'cc33dd44', { token: session.token, command: { name: 'run', agent: 'nope', task: 'x' } })
    expect(await answerOf(session.dir, 'cc33dd44')).toMatchObject({ ok: false, failure: 'invalid_request' })
    ask(session.dir, 'ee55ff66', { token: waviTokenFor('0'.repeat(64), 's-1'), command: { name: 'ls' } })
    expect(await answerOf(session.dir, 'ee55ff66', 600)).toBeNull()
    expect(asked).toBe(0)
  })

  it('derives the same token for a session after a restart, and none for an id that cannot name a folder', async () => {
    const { requests } = start(async () => waviOk('x'), 'tokens')
    expect((await requests.ensureSession('s-2'))?.token).toBe(waviTokenFor('f'.repeat(64), 's-2'))
    expect(await requests.ensureSession('..')).toBeNull()
    expect(await requests.ensureSession('a/b')).toBeNull()
  })
})
