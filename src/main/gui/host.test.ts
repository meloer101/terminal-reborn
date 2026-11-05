// The GUI host end to end against fake agents (./fixtures) run through the real pipe host in a login shell: no real
// agent CLI, no tokens.
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '@shared/agent-events'
import type { CliAgent } from '@shared/agents'
import { applyGuiEvent, GUI_IPC, type GuiEvent, type GuiLaunch, type GuiState } from '@shared/gui-chat'
import type { ChatItem } from '@shared/transcript-chat'
import { LocalPipeLink, type PipeAttach, type PipeLink } from '../pty/pipes'
import { GuiHost, type GuiOwner } from './host'

const FIXTURES = join(__dirname, 'fixtures')
const FAKES: Partial<Record<CliAgent, string>> = { claude: 'fake-claude.mjs', codex: 'fake-codex.mjs', grok: 'fake-acp.mjs' }

class FakeOwner implements GuiOwner {
  destroyed = false
  batches: { sessionId: string; events: GuiEvent[] }[] = []
  isDestroyed(): boolean {
    return this.destroyed
  }
  send(channel: string, payload: unknown): void {
    if (channel === GUI_IPC.events) this.batches.push(payload as { sessionId: string; events: GuiEvent[] })
  }
}

interface Harness {
  host: GuiHost<FakeOwner>
  owner: FakeOwner
  status: AgentEvent[]
  adopted: string[]
  ended: string[]
  /** The renderer's view: open's state with every batch since folded in. */
  view(sessionId: string): GuiState
  opened: Map<string, GuiState>
}

const links: LocalPipeLink[] = []
afterEach(() => {
  for (const link of links.splice(0)) link.killAll()
})

function harness(link = new LocalPipeLink(), history: ChatItem[] | null = null): Harness {
  links.push(link)
  const owner = new FakeOwner()
  const status: AgentEvent[] = []
  const adopted: string[] = []
  const ended: string[] = []
  const opened = new Map<string, GuiState>()
  const host = new GuiHost<FakeOwner>({
    link: () => link,
    prepare: (launch) =>
      Promise.resolve({
        command: process.execPath,
        args: [join(FIXTURES, FAKES[launch.agent]!)],
        env: {},
        baseEnv: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        binary: FAKES[launch.agent]!
      }),
    history: () => Promise.resolve(history),
    status: (_id, _agent, events) => status.push(...events),
    adopted: (id) => adopted.push(id),
    ended: (id) => ended.push(id),
    image: () => Promise.resolve({ mediaType: 'image/png', data: 'iVBORw0KGgo=' }),
    clientVersion: '0.0.0-test',
    batchMs: 5
  })
  const open = host.open.bind(host)
  host.open = async (launch, who) => {
    const result = await open(launch, who)
    if (result.ok) {
      opened.set(launch.sessionId, result.state)
      owner.batches = owner.batches.filter((b) => b.sessionId !== launch.sessionId)
    }
    return result
  }
  const view = (sessionId: string) =>
    owner.batches.filter((b) => b.sessionId === sessionId).reduce((state, b) => b.events.reduce(applyGuiEvent, state), opened.get(sessionId)!)
  return { host, owner, status, adopted, ended, view, opened }
}

async function until(check: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const launchOf = (agent: CliAgent, sessionId: string, extra: Partial<GuiLaunch> = {}): GuiLaunch => ({ sessionId, cwd: process.cwd(), agent, ...extra })
const stateOf = (h: Harness, id: string) => h.host.state(id)!
const texts = (state: GuiState) => state.items.flatMap((i) => (i.kind === 'text' || i.kind === 'user' ? [`${i.kind}:${i.text}`] : []))
const ready = (h: Harness, id: string) => until(() => stateOf(h, id).config.length > 0 && h.status.some((e) => e.type === 'session-start'))
const settle = () => new Promise((r) => setTimeout(r, 60))

describe('GuiHost · Claude stream-json', () => {
  it('initializes, streams a turn, answers a permission, and the renderer view matches', async () => {
    const h = harness()
    const opened = await h.host.open(launchOf('claude', 'c1'), h.owner)
    expect(opened.ok).toBe(true)
    await ready(h, 'c1')
    const state = stateOf(h, 'c1')
    expect(state.commands).toEqual([{ name: 'review', description: 'Review the diff', argumentHint: '[path]' }])
    expect(state.config.find((c) => c.id === 'effort')?.current).toBe('max')

    expect(await h.host.send('c1', { text: 'hello', attachments: [] })).toEqual({ ok: true, queued: false })
    await until(() => !stateOf(h, 'c1').busy && texts(stateOf(h, 'c1')).includes('text:Hello: hello'))
    expect(texts(stateOf(h, 'c1'))).toEqual(['user:hello', 'text:Hello: hello'])
    // Claude's own hooks carry its status; the host only says it started (with the conversation id).
    expect(h.status).toContainEqual({ type: 'session-start', agentSessionId: 'fake-claude-session' })
    expect(h.status.some((e) => e.type === 'prompt-submit')).toBe(false)

    await h.host.send('c1', { text: 'please write', attachments: [] })
    await until(() => stateOf(h, 'c1').prompts.length === 1)
    const prompt = stateOf(h, 'c1').prompts[0]!
    expect(prompt).toMatchObject({ kind: 'permission', tool: 'Write', detail: 'a.txt' })
    expect(prompt.kind === 'permission' && prompt.options.map((o) => o.id)).toEqual(['reject_once', 'allow_always', 'allow_once'])
    expect(h.host.answer('c1', { kind: 'permission', id: prompt.id, optionId: 'allow_once' })).toBe(true)
    expect(h.host.answer('c1', { kind: 'permission', id: prompt.id, optionId: 'allow_once' })).toBe(false)
    await until(() => !stateOf(h, 'c1').busy && texts(stateOf(h, 'c1')).includes('text:Wrote it'))
    expect(stateOf(h, 'c1').items.find((i) => i.kind === 'tool')).toMatchObject({ name: 'Write', state: 'ok' })
    await settle()
    expect(h.view('c1')).toEqual(stateOf(h, 'c1'))
  }, 30_000)

  it('queues messages while a turn runs, edits and removes them, and sends them in order', async () => {
    const h = harness()
    await h.host.open(launchOf('claude', 'c2'), h.owner)
    await ready(h, 'c2')
    await h.host.send('c2', { text: 'please write', attachments: [] })
    await until(() => stateOf(h, 'c2').prompts.length === 1)
    expect(await h.host.send('c2', { text: 'second', attachments: [] })).toEqual({ ok: true, queued: true })
    expect(await h.host.send('c2', { text: 'third', attachments: ['/tmp/a.png'] })).toEqual({ ok: true, queued: true })
    const [second, third] = stateOf(h, 'c2').queued
    expect(h.host.editQueued('c2', second!.id, 'second edited')).toBe(true)
    expect(h.host.editQueued('c2', 'nope', 'x')).toBe(false)
    expect(h.host.editQueued('c2', third!.id, '')).toBe(true)
    expect(stateOf(h, 'c2').queued).toEqual([{ id: second!.id, text: 'second edited' }])
    h.host.answer('c2', { kind: 'permission', id: stateOf(h, 'c2').prompts[0]!.id, optionId: 'reject_once' })
    await until(() => texts(stateOf(h, 'c2')).includes('text:Hello: second edited') && !stateOf(h, 'c2').busy)
    expect(stateOf(h, 'c2').queued).toEqual([])
    expect(texts(stateOf(h, 'c2'))).toEqual(['user:please write', 'text:Hello: please write', 'text:Refused', 'user:second edited', 'text:Hello: second edited'])
  }, 30_000)

  it('changes the model, interrupts, sends images as blocks, sends the first message, and reports a crash', async () => {
    const h = harness()
    await h.host.open(launchOf('claude', 'c3', { initialPrompt: 'first' }), h.owner)
    await until(() => texts(stateOf(h, 'c3')).includes('text:Hello: first') && !stateOf(h, 'c3').busy)
    expect(await h.host.setConfig('c3', 'model', 'haiku')).toBe(true)
    expect(await h.host.setConfig('c3', 'model', 'gpt')).toBe(false)
    expect(stateOf(h, 'c3').config.map((c) => `${c.id}=${c.current}`)).toEqual(['model=haiku', 'mode=default'])

    await h.host.send('c3', { text: 'look', attachments: ['/tmp/shot.png', '/tmp/notes.md'] })
    await until(() => texts(stateOf(h, 'c3')).some((t) => t.startsWith('text:Hello: look')) && !stateOf(h, 'c3').busy)
    expect(texts(stateOf(h, 'c3')).find((t) => t.startsWith('text:Hello: look'))).toBe('text:Hello: look\n\n/tmp/notes.md [1 image]')

    await h.host.send('c3', { text: 'slow', attachments: [] })
    await until(() => (stateOf(h, 'c3').live?.text.length ?? 0) > 6)
    expect(h.host.interrupt('c3')).toBe(true)
    await until(() => !stateOf(h, 'c3').busy)

    await h.host.send('c3', { text: 'die', attachments: [] })
    await until(() => stateOf(h, 'c3').failure !== null)
    expect(stateOf(h, 'c3').failure).toBe('fake-claude.mjs 退出了（退出码 2）：Error: fake crash')
    expect(h.status.at(-1)).toEqual({ type: 'session-end', reason: 'exit' })
    expect(h.ended).toEqual(['c3'])
    expect(await h.host.send('c3', { text: 'more', attachments: [] })).toMatchObject({ ok: false })
  }, 30_000)

  it('reattaches to a process the pipe host kept running and replays its lines', async () => {
    const link = new LocalPipeLink()
    const a = harness(link)
    await a.host.open(launchOf('claude', 'c4'), a.owner)
    await ready(a, 'c4')
    await a.host.send('c4', { text: 'hello', attachments: [] })
    await until(() => !stateOf(a, 'c4').busy && stateOf(a, 'c4').items.length === 2)

    // The next app run (the daemon kept the process): a fresh host over the same link.
    const b = harness(link)
    const opened = await b.host.open(launchOf('claude', 'c4'), b.owner)
    expect(opened.ok && texts(opened.state)).toEqual(['user:hello', 'text:Hello: hello'])
    expect(b.adopted).toEqual(['c4'])
    expect(opened.ok && opened.state.commands.length).toBe(1)
    await until(() => b.status.some((e) => e.type === 'session-start'))
    await b.host.send('c4', { text: 'again', attachments: [] })
    await until(() => texts(stateOf(b, 'c4')).includes('text:Hello: again') && !stateOf(b, 'c4').busy)
    expect(texts(stateOf(b, 'c4'))).toEqual(['user:hello', 'text:Hello: hello', 'user:again', 'text:Hello: again'])
  }, 30_000)
})

describe('GuiHost · Codex app-server', () => {
  it('starts a thread, maps approvals, carries the pickers into turn/start, and reports status', async () => {
    const h = harness()
    await h.host.open(launchOf('codex', 'x1'), h.owner)
    await ready(h, 'x1')
    expect(stateOf(h, 'x1').config.map((c) => `${c.id}=${c.current}`)).toEqual(['model=gpt-a', 'effort=low', 'mode=on-request'])
    expect(h.status[0]).toEqual({ type: 'session-start', agentSessionId: 'thr-new' })

    await h.host.send('x1', { text: 'go', attachments: [] })
    await until(() => stateOf(h, 'x1').prompts.length === 1)
    const prompt = stateOf(h, 'x1').prompts[0]!
    expect(prompt).toMatchObject({ kind: 'permission', tool: 'Bash', detail: 'ls' })
    expect(h.status.map((e) => e.type)).toEqual(['session-start', 'prompt-submit', 'tool-start', 'permission-request'])
    h.host.answer('x1', { kind: 'permission', id: prompt.id, optionId: 'accept' })
    await until(() => !stateOf(h, 'x1').busy)
    const done = texts(stateOf(h, 'x1')).find((t) => t.startsWith('text:Done'))
    expect(done).toBe('text:Done ({"turnId":"turn-1","model":"gpt-a","effort":"low","approvalPolicy":"on-request"})')
    expect(h.status.at(-1)).toMatchObject({ type: 'stop', message: done!.slice(5) })
    expect(h.status.filter((e) => e.type === 'tool-end').length).toBeGreaterThan(0)

    expect(await h.host.setConfig('x1', 'model', 'gpt-b')).toBe(true)
    expect(await h.host.setConfig('x1', 'mode', 'untrusted')).toBe(true)
    expect(stateOf(h, 'x1').config.map((c) => `${c.id}=${c.current}`)).toEqual(['model=gpt-b', 'effort=medium', 'mode=untrusted'])
    await h.host.send('x1', { text: 'go again', attachments: [] })
    await until(() => stateOf(h, 'x1').prompts.length === 1)
    h.host.answer('x1', { kind: 'permission', id: stateOf(h, 'x1').prompts[0]!.id, optionId: 'decline' })
    await until(() => !stateOf(h, 'x1').busy)
    expect(texts(stateOf(h, 'x1')).at(-1)).toBe('text:Done ({"turnId":"turn-2","model":"gpt-b","effort":"medium","approvalPolicy":"untrusted"})')

    await h.host.send('x1', { text: 'fail', attachments: [] })
    await until(() => h.status.at(-1)?.type === 'stop-failure')
    expect(h.status.at(-1)).toEqual({ type: 'stop-failure', message: 'quota exceeded' })

    await h.host.send('x1', { text: 'slow', attachments: [] })
    expect(h.host.interrupt('x1')).toBe(true)
    await until(() => !stateOf(h, 'x1').busy)
    expect(stateOf(h, 'x1').items.at(-1)).toMatchObject({ kind: 'system', text: '已中断' })
    await settle()
    expect(h.view('x1')).toEqual(stateOf(h, 'x1'))
  }, 30_000)

  it('resumes a thread with its history from the transcript', async () => {
    const history: ChatItem[] = [
      { kind: 'user', id: 'h0', at: 1, text: 'old question', images: 0 },
      { kind: 'text', id: 'h1', at: 2, text: 'old answer' }
    ]
    const h = harness(new LocalPipeLink(), history)
    const opened = await h.host.open(launchOf('codex', 'x2', { resumeAgentSessionId: 'thr-old' }), h.owner)
    expect(opened.ok && texts(opened.state)).toEqual(['user:old question', 'text:old answer'])
    await ready(h, 'x2')
    expect(h.status[0]).toEqual({ type: 'session-start', agentSessionId: 'thr-old' })
    await h.host.send('x2', { text: 'go', attachments: [] })
    await until(() => stateOf(h, 'x2').prompts.length === 1)
    expect(texts(stateOf(h, 'x2')).slice(0, 3)).toEqual(['user:old question', 'text:old answer', 'user:go'])
  }, 30_000)

  it('reattaches mid-turn: the pending approval is still there and can be answered', async () => {
    const link = new LocalPipeLink()
    const a = harness(link)
    await a.host.open(launchOf('codex', 'x3'), a.owner)
    await ready(a, 'x3')
    await a.host.send('x3', { text: 'go', attachments: [] })
    await until(() => stateOf(a, 'x3').prompts.length === 1)

    const b = harness(link)
    const opened = await b.host.open(launchOf('codex', 'x3'), b.owner)
    expect(opened.ok && opened.state.busy).toBe(true)
    expect(opened.ok && opened.state.prompts.map((p) => p.kind)).toEqual(['permission'])
    expect(opened.ok && opened.state.config.length).toBe(3)
    await until(() => b.status.some((e) => e.type === 'permission-request'))
    expect(b.status.map((e) => e.type)).toEqual(['prompt-submit', 'tool-start', 'permission-request', 'session-start'])
    expect(b.host.answer('x3', { kind: 'permission', id: stateOf(b, 'x3').prompts[0]!.id, optionId: 'accept' })).toBe(true)
    await until(() => !stateOf(b, 'x3').busy)
    expect(texts(stateOf(b, 'x3')).at(-1)).toMatch(/^text:Done/)
  }, 30_000)
})

describe('GuiHost · ACP', () => {
  it('handshakes, refuses fs requests, answers a permission, sets a picker and cancels', async () => {
    const h = harness()
    await h.host.open(launchOf('grok', 'a1'), h.owner)
    await ready(h, 'a1')
    expect(stateOf(h, 'a1').commands).toEqual([{ name: 'plan', description: 'Make a plan', argumentHint: 'what' }])
    expect(h.status[0]).toEqual({ type: 'session-start', agentSessionId: 'acp-session-1' })

    await h.host.send('a1', { text: 'fs please', attachments: ['/tmp/a.png'] })
    await until(() => stateOf(h, 'a1').prompts.length === 1)
    const prompt = stateOf(h, 'a1').prompts[0]!
    expect(prompt).toMatchObject({ kind: 'permission', tool: 'Bash', detail: 'ls' })
    expect(prompt.kind === 'permission' && prompt.options.map((o) => o.id)).toEqual(['no', 'yes'])
    h.host.answer('a1', { kind: 'permission', id: prompt.id, optionId: 'yes' })
    await until(() => !stateOf(h, 'a1').busy)
    // The agent's image capability is off: the image went as a path in the text.
    expect(texts(stateOf(h, 'a1'))).toEqual(['user:fs please\n\n/tmp/a.png', 'text:fs refused -32601. Hi there (m1)'])
    expect(stateOf(h, 'a1').items.find((i) => i.kind === 'tool')).toMatchObject({ name: 'Bash', state: 'ok', output: 'a.txt' })
    expect(h.status.map((e) => e.type)).toEqual(['session-start', 'prompt-submit', 'tool-start', 'permission-request', 'tool-end', 'tool-end', 'stop'])

    expect(await h.host.setConfig('a1', 'model', 'm2')).toBe(true)
    expect(stateOf(h, 'a1').config[0]!.current).toBe('m2')
    await h.host.send('a1', { text: 'slow', attachments: [] })
    await until(() => stateOf(h, 'a1').live !== null)
    expect(h.host.interrupt('a1')).toBe(true)
    await until(() => !stateOf(h, 'a1').busy)
    expect(stateOf(h, 'a1').items.at(-1)).toMatchObject({ kind: 'system', text: '已中断' })
    expect(texts(stateOf(h, 'a1')).at(-1)).toBe('text:Hi there (m2)')
    await settle()
    expect(h.view('a1')).toEqual(stateOf(h, 'a1'))
  }, 30_000)

  it('resumes with session/load, which replays the conversation', async () => {
    const h = harness()
    await h.host.open(launchOf('grok', 'a2', { resumeAgentSessionId: 'acp-old' }), h.owner)
    await ready(h, 'a2')
    expect(texts(stateOf(h, 'a2'))).toEqual(['user:earlier question', 'text:earlier answer'])
    expect(h.status[0]).toEqual({ type: 'session-start', agentSessionId: 'acp-old' })
  }, 30_000)

  it('reattaches mid-turn and the turn ends through the earlier prompt request', async () => {
    const link = new LocalPipeLink()
    const a = harness(link)
    await a.host.open(launchOf('grok', 'a3'), a.owner)
    await ready(a, 'a3')
    await a.host.send('a3', { text: 'go', attachments: [] })
    await until(() => stateOf(a, 'a3').prompts.length === 1)

    const b = harness(link)
    const opened = await b.host.open(launchOf('grok', 'a3'), b.owner)
    expect(opened.ok && opened.state.busy).toBe(true)
    await until(() => stateOf(b, 'a3').config.length > 0)
    expect(b.host.answer('a3', { kind: 'permission', id: stateOf(b, 'a3').prompts[0]!.id, optionId: 'yes' })).toBe(true)
    await until(() => !stateOf(b, 'a3').busy)
    expect(b.status.at(-1)).toMatchObject({ type: 'stop' })
  }, 30_000)

  it('stop ends the process and forgets the session', async () => {
    const h = harness()
    await h.host.open(launchOf('grok', 'a4'), h.owner)
    await ready(h, 'a4')
    h.host.stop('a4')
    expect(h.host.has('a4')).toBe(false)
    expect(h.ended).toEqual(['a4'])
    expect(await h.host.send('a4', { text: 'x', attachments: [] })).toEqual({ ok: false, reason: '会话不存在' })
  }, 30_000)
})

describe('GuiHost · reattach edge cases (a stub link)', () => {
  const user = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' }, session_id: 's-1' })
  const reply = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello: hello' }] }, session_id: 's-1', parent_tool_use_id: null })
  const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's-1' })

  function stubHost(attach: PipeAttach, history: ChatItem[] | null) {
    const writes: string[] = []
    const adopted: string[] = []
    const link: PipeLink = {
      durable: true,
      spawn: () => Promise.resolve({ ok: false, message: 'not in this test' }),
      attach: () => Promise.resolve(attach),
      write: (_id, line) => {
        writes.push(line)
        return true
      },
      kill: () => undefined,
      // The daemon's list carries no stderr; attach does.
      list: () => Promise.resolve([{ id: 'r1', pid: 1, ...(attach.exit ? { exit: { ...attach.exit, stderr: '' } } : {}) }])
    }
    const host = new GuiHost<FakeOwner>({
      link: () => link,
      prepare: () => Promise.reject(new Error('not in this test')),
      history: () => Promise.resolve(history),
      status: () => undefined,
      adopted: (id) => adopted.push(id),
      ended: () => undefined,
      image: () => Promise.resolve(null),
      clientVersion: '0',
      batchMs: 5
    })
    return { host, writes, adopted }
  }

  it('a truncated replay takes the history from the transcript and lines its newest items up with the kept ones', async () => {
    const history: ChatItem[] = [
      { kind: 'user', id: 'h0', at: 1, text: 'older', images: 0 },
      { kind: 'text', id: 'h1', at: 2, text: 'older reply' },
      { kind: 'user', id: 'h2', at: 3, text: 'hello', images: 0 },
      { kind: 'text', id: 'h3', at: 4, text: 'Hello: hello' }
    ]
    const { host, writes, adopted } = stubHost({ pid: 1, seq: 3, lines: [user, reply, result], truncated: true }, history)
    const opened = await host.open(launchOf('claude', 'r1'), new FakeOwner())
    expect(opened.ok && texts(opened.state)).toEqual(['user:older', 'text:older reply', 'user:hello', 'text:Hello: hello'])
    expect(adopted).toEqual(['r1'])
    // No `initialize` answer among the kept lines: the handshake runs again.
    expect(writes.map((w) => (JSON.parse(w) as { request?: { subtype?: string } }).request?.subtype)).toEqual(['initialize'])
    host.stop('r1')
  })

  it('a process that ended while no app was attached shows why, with the stderr attach brought', async () => {
    const { host, adopted } = stubHost({ pid: 1, seq: 2, lines: [user, reply], truncated: false, exit: { exitCode: 1, stderr: 'Error: not logged in' } }, null)
    const opened = await host.open(launchOf('claude', 'r1'), new FakeOwner())
    expect(opened.ok && texts(opened.state)).toEqual(['user:hello', 'text:Hello: hello'])
    expect(opened.ok && opened.state.failure).toBe('claude 退出了（退出码 1）：Error: not logged in')
    expect(opened.ok && opened.state.busy).toBe(false)
    expect(adopted).toEqual([])
  })
})
