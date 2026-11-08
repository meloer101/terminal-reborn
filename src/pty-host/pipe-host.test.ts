import { afterEach, describe, expect, it } from 'vitest'
import { answeredRequestId, PipeHost, type PipeExit } from './pipe-host'

// A real child: a login shell runs `node -e` that echoes each stdin line back as JSON, then exits on "bye".
const ECHO = `process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',d=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);if(l==='bye'){process.stderr.write('done');process.exit(3)}process.stdout.write(JSON.stringify({echo:l})+'\\n')}})`

describe('answeredRequestId', () => {
  it('reads the request a response answers, as the drivers write them, and nothing else', () => {
    const line = (m: unknown) => JSON.stringify(m)
    expect(answeredRequestId(line({ type: 'control_response', response: { subtype: 'success', request_id: 'req-"1"', response: { behavior: 'allow' } } }))).toBe('req-"1"')
    expect(answeredRequestId(line({ type: 'control_response', response: { subtype: 'error', request_id: 'r2', error: 'no' } }))).toBe('r2')
    expect(answeredRequestId(line({ id: 0, result: { decision: 'accept' } }))).toBe('0')
    expect(answeredRequestId(line({ jsonrpc: '2.0', id: 'abc', error: { code: -32601, message: 'x' } }))).toBe('abc')
    expect(answeredRequestId(line({ jsonrpc: '2.0', id: 4, method: 'session/prompt', params: {} }))).toBeNull()
    expect(answeredRequestId(line({ type: 'control_request', request_id: 'w1', request: { subtype: 'interrupt' } }))).toBeNull()
    expect(answeredRequestId(line({ type: 'user', message: { role: 'user', content: '{"id":1,"result":2}' } }))).toBeNull()
    // Pi rpc (PRD F23 v1.160): an answer to an extension dialog.
    expect(answeredRequestId(line({ type: 'extension_ui_response', id: '4980-a', confirmed: true }))).toBe('4980-a')
    expect(answeredRequestId(line({ type: 'prompt', id: 'w1', message: 'hi' }))).toBeNull()
  })
})

describe('PipeHost', () => {
  const lines: [string, string, number][] = []
  const exits: [string, PipeExit][] = []
  let host: PipeHost
  afterEach(() => {
    host.killAll()
    lines.length = 0
    exits.length = 0
  })

  const until = async (check: () => boolean, ms = 15000) => {
    const end = Date.now() + ms
    while (!check()) {
      if (Date.now() > end) throw new Error('timed out')
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  it('runs a command in the login shell, streams its stdout lines and reports its exit with stderr', async () => {
    host = new PipeHost({ line: (id, line, seq) => lines.push([id, line, seq]), exit: (id, exit) => exits.push([id, exit]) })
    const started = host.spawn({ id: 's1', cwd: process.cwd(), command: process.execPath, args: ['-e', ECHO], baseEnv: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } })
    expect(started.ok).toBe(true)
    expect(host.write('s1', 'hello')).toBe(true)
    expect(host.write('s1', 'two\nlines')).toBe(false)
    await until(() => lines.some(([, l]) => l.includes('"echo":"hello"')))
    const snapshot = host.snapshot('s1')!
    expect(snapshot.lines.filter((l) => l.startsWith('{'))).toEqual(['{"echo":"hello"}'])
    expect(snapshot.seq).toBe(lines.length)
    host.write('s1', 'bye')
    await until(() => exits.length === 1)
    expect(exits[0]).toEqual(['s1', { exitCode: 3, stderr: expect.stringContaining('done') }])
    expect(host.liveCount).toBe(0)
    expect(host.write('s1', 'late')).toBe(false)
  }, 20000)

  it('drops a stdout line longer than its limit, also one that arrives in many chunks, and goes on with the next', async () => {
    const dropped: [string, number][] = []
    host = new PipeHost({ line: (id, line, seq) => lines.push([id, line, seq]), exit: (id, exit) => exits.push([id, exit]), dropped: (id, chars) => dropped.push([id, chars]) }, 1000)
    const script = `const w=(s)=>new Promise(r=>process.stdout.write(s,r));(async()=>{await w('{"a":1}\\n');for(let i=0;i<30;i++){await w('x'.repeat(100));await new Promise(r=>setTimeout(r,5))}await w('\\n{"b":2}\\n'+'y'.repeat(1500)+'\\n{"c":3}\\n')})()`
    host.spawn({ id: 's3', cwd: process.cwd(), command: process.execPath, args: ['-e', script], baseEnv: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } })
    await until(() => exits.length === 1)
    expect(lines.map(([, l]) => l).filter((l) => l.startsWith('{'))).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
    expect(dropped).toEqual([
      ['s3', 3000],
      ['s3', 1500]
    ])
    expect(host.snapshot('s3')!.lines.every((l) => l.length <= 1000)).toBe(true)
  }, 20000)

  it('kills a session and forgets it', async () => {
    host = new PipeHost({ line: () => undefined, exit: (id, exit) => exits.push([id, exit]) })
    host.spawn({ id: 's2', cwd: '/nonexistent', command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], baseEnv: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } })
    expect(host.list().map((s) => s.id)).toEqual(['s2'])
    host.kill('s2')
    expect(host.has('s2')).toBe(false)
    await until(() => exits.length === 1)
  }, 20000)
})
