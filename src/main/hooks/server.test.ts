// The real transport: the shipped resources/hooks/tr-hook.sh talking to the hook server over a Unix socket.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HookBridge } from './bridge'
import { claudeFixtures as fx } from './fixtures'
import { startHookServer, type HookRequest, type HookServer } from './server'

const SCRIPT = resolve(__dirname, '../../../resources/hooks/tr-hook.sh')

let server: HookServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

interface RelayResult {
  code: number | null
  stdout: string
}

function relay(event: string, payload: unknown, env: Record<string, string | undefined>): Promise<RelayResult> {
  return new Promise((done) => {
    const child = spawn('/bin/sh', [SCRIPT, event, 'claude'], { env: { PATH: process.env.PATH, ...env } })
    let stdout = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.on('close', (code) => done({ code, stdout }))
    child.stdin.end(JSON.stringify(payload))
  })
}

const hookEnv = (s: HookServer, sessionId = 's1') => ({ TR_SESSION_ID: sessionId, TR_HOOK_SOCK: s.socketPath, TR_HOOK_TOKEN: s.token })

function rawPost(s: HookServer, path: string, headers: Record<string, string>, body = '{}'): Promise<number> {
  return new Promise((done, fail) => {
    const req = httpRequest({ socketPath: s.socketPath, path, method: 'POST', headers }, (res) => {
      res.resume()
      done(res.statusCode ?? 0)
    })
    req.on('error', fail)
    req.end(body)
  })
}

describe('hook relay script + server', () => {
  it('ships the script', () => {
    expect(existsSync(SCRIPT)).toBe(true)
  })

  it('delivers the payload and prints the response body', async () => {
    const seen: HookRequest[] = []
    server = await startHookServer((req) => {
      seen.push(req)
      return '{"ok":true}'
    })
    const result = await relay('Notification', fx.Notification_idle, hookEnv(server))
    expect(result).toEqual({ code: 0, stdout: '{"ok":true}' })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ event: 'Notification', sessionId: 's1', agent: 'claude', payload: fx.Notification_idle })
  })

  it('end to end through the bridge: a held PermissionRequest prints the decision when answered', async () => {
    const prompts: string[] = []
    const bridge = new HookBridge({
      event: () => {},
      prompt: (p) => prompts.push(p.id),
      resolved: () => {},
      canDeliver: () => true
    })
    bridge.attach('s1')
    server = await startHookServer((req) => bridge.handle(req))
    const pending = relay('PermissionRequest', fx.PermissionRequest_Bash, hookEnv(server))
    await expect.poll(() => prompts.length, { timeout: 5000 }).toBe(1)
    bridge.respondPermission(prompts[0]!, 'allow-once')
    const result = await pending
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
  })

  it('exits 0 with no output when the socket is gone, the env is missing, or the token is wrong', async () => {
    server = await startHookServer(() => 'should-not-print')
    const good = hookEnv(server)
    const start = Date.now()
    expect(await relay('Stop', {}, { ...good, TR_HOOK_SOCK: '/nonexistent/hook.sock' })).toEqual({ code: 0, stdout: '' })
    expect(await relay('Stop', {}, { ...good, TR_SESSION_ID: undefined })).toEqual({ code: 0, stdout: '' })
    expect(await relay('Stop', {}, { ...good, TR_HOOK_TOKEN: 'wrong' })).toEqual({ code: 0, stdout: '' })
    expect(Date.now() - start).toBeLessThan(3000)
  })

  it('answers 404 for sessions the bridge does not know, and the script prints nothing', async () => {
    const bridge = new HookBridge({ event: () => {}, prompt: () => {}, resolved: () => {}, canDeliver: () => true })
    server = await startHookServer((req) => bridge.handle(req))
    expect(await relay('Stop', fx.Stop, hookEnv(server, 'stranger'))).toEqual({ code: 0, stdout: '' })
  })
})

describe('hook server', () => {
  it('rejects a missing token, wrong method and malformed paths', async () => {
    server = await startHookServer(() => 'x')
    const headers = { 'X-TR-Token': server.token }
    expect(await rawPost(server, '/hook/Stop?session=s1', {})).toBe(403)
    expect(await rawPost(server, '/hook/Stop?session=s1', { 'X-TR-Token': 'nope' })).toBe(403)
    expect(await rawPost(server, '/hook/Stop?session=bad%20id', headers)).toBe(400)
    expect(await rawPost(server, '/hook/Stop', headers)).toBe(400)
    expect(await rawPost(server, '/other/Stop?session=s1', headers)).toBe(400)
    expect(await rawPost(server, '/hook/Stop?session=s1&agent=gemini', headers)).toBe(400)
    expect(await rawPost(server, '/hook/Stop?session=s1', headers)).toBe(200)
  })

  it('tolerates a non-JSON body (payload undefined)', async () => {
    const seen: unknown[] = []
    server = await startHookServer((req) => {
      seen.push(req.payload)
      return ''
    })
    expect(await rawPost(server, '/hook/Stop?session=s1', { 'X-TR-Token': server.token }, 'not json')).toBe(200)
    expect(seen).toEqual([undefined])
  })

  it('aborts the request signal when the client goes away mid-hold', async () => {
    let signal: AbortSignal | undefined
    server = await startHookServer(
      (req) =>
        new Promise<string>(() => {
          signal = req.signal
        })
    )
    const req = httpRequest({ socketPath: server.socketPath, path: '/hook/PermissionRequest?session=s1', method: 'POST', headers: { 'X-TR-Token': server.token } })
    req.on('error', () => {})
    req.end('{}')
    await expect.poll(() => signal !== undefined, { timeout: 3000 }).toBe(true)
    req.destroy()
    await expect.poll(() => signal?.aborted, { timeout: 3000 }).toBe(true)
  })

  it('removes the socket directory on close', async () => {
    server = await startHookServer(() => '')
    const path = server.socketPath
    expect(existsSync(path)).toBe(true)
    await server.close()
    server = null
    expect(existsSync(path)).toBe(false)
  })
})
