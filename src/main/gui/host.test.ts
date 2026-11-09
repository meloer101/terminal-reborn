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
const FAKES: Partial<Record<CliAgent, string>> = { claude: 'fake-claude.mjs', codex: 'fake-codex.mjs', grok: 'fake-acp.mjs', gemini: 'fake-acp.mjs', pi: 'fake-pi.mjs' }
/** Pi's launch arguments, as fake-pi.mjs reads them in these tests. */
const fakeEnv = (launch: GuiLaunch): Record<string, string> =>
  launch.agent === 'pi' ? { FAKE_PI_MODEL: launch.model ?? '', FAKE_PI_THINKING: launch.effort ?? '', FAKE_PI_SESSION: launch.resumeAgentSessionId ?? '' } : {}

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

interface EditDeps {
  resumePoint?: () => Promise<string | null | undefined>
  /** Every launch `prepare` was asked for. */
  prepared?: GuiLaunch[]
}

function harness(link = new LocalPipeLink(), history: ChatItem[] | null = null, batchMs = 5, synthStatus = false, edits: EditDeps = {}): Harness {
  links.push(link)
  const owner = new FakeOwner()
  const status: AgentEvent[] = []
  const adopted: string[] = []
  const ended: string[] = []
  const opened = new Map<string, GuiState>()
  const host = new GuiHost<FakeOwner>({
    link: () => link,
    prepare: (launch) => {
      edits.prepared?.push(launch)
      return Promise.resolve({
        command: process.execPath,
        args: [join(FIXTURES, FAKES[launch.agent]!)],
        env: fakeEnv(launch),
        baseEnv: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        binary: FAKES[launch.agent]!,
        ...(synthStatus ? { synthStatus } : {})
      })
    },
    history: () => Promise.resolve(history),
    resumePoint: edits.resumePoint ?? (() => Promise.resolve(undefined)),
    status: (_id, _agent, events) => status.push(...events),
    adopted: (id) => adopted.push(id),
    ended: (id) => ended.push(id),
    image: () => Promise.resolve({ mediaType: 'image/png', data: 'iVBORw0KGgo=' }),
    clientVersion: '0.0.0-test',
    batchMs
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
    expect(state.commands[0]).toEqual({ name: 'review', description: 'Review the diff', argumentHint: '[path]', kind: 'command' })
    expect(state.commands.map((c) => c.name)).toEqual(['review', 'research'])
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
    expect(stateOf(h, 'c3').config.map((c) => `${c.id}=${c.current}`)).toEqual(['model=haiku', 'permission=ask', 'plan=off'])

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

  it('derives Claude’s status itself when its hooks cannot reach the app (an older daemon, no hook server)', async () => {
    const h = harness(new LocalPipeLink(), null, 5, true)
    await h.host.open(launchOf('claude', 'c6'), h.owner)
    await ready(h, 'c6')
    await h.host.send('c6', { text: 'please write', attachments: [] })
    await until(() => stateOf(h, 'c6').prompts.length === 1)
    expect(h.status.map((e) => e.type).filter((t) => t !== 'session-start')).toEqual(['prompt-submit', 'tool-start', 'permission-request'])
    h.host.answer('c6', { kind: 'permission', id: stateOf(h, 'c6').prompts[0]!.id, optionId: 'allow_once' })
    await until(() => h.status.at(-1)?.type === 'stop')
  }, 30_000)

  it('sends a batch only the newest of its streamed texts (each one is the whole text so far)', async () => {
    const h = harness(new LocalPipeLink(), null, 300)
    await h.host.open(launchOf('claude', 'c5'), h.owner)
    await ready(h, 'c5')
    await h.host.send('c5', { text: 'slow', attachments: [] })
    await until(() => (stateOf(h, 'c5').live?.text.length ?? 0) > 20)
    h.host.interrupt('c5')
    await until(() => !stateOf(h, 'c5').busy)
    await new Promise((r) => setTimeout(r, 350))
    const batches = h.owner.batches.filter((b) => b.sessionId === 'c5')
    expect(batches.some((b) => b.events.some((e) => e.type === 'live' && e.live !== null))).toBe(true)
    for (const b of batches) expect(b.events.filter((e) => e.type === 'live').length).toBeLessThanOrEqual(1)
    expect(h.view('c5')).toEqual(stateOf(h, 'c5'))
  }, 30_000)

  it('edits an earlier message: restarts at the message before it, keeps what came before, sends the new text', async () => {
    const prepared: GuiLaunch[] = []
    const h = harness(new LocalPipeLink(), null, 5, false, { resumePoint: () => Promise.resolve('reply-1'), prepared })
    await h.host.open(launchOf('claude', 'c9'), h.owner)
    await ready(h, 'c9')
    for (const text of ['first', 'second']) {
      await h.host.send('c9', { text, attachments: [] })
      await until(() => !stateOf(h, 'c9').busy && texts(stateOf(h, 'c9')).includes(`text:Hello: ${text}`))
    }
    const second = stateOf(h, 'c9').items.find((i) => i.kind === 'user' && i.text === 'second')!
    const edited = await h.host.edit('c9', second.id, 'second, edited')
    expect(edited.ok).toBe(true)
    // The shorter conversation's context is not the longer one's: unknown until its next reply.
    expect(h.status).toContainEqual({ type: 'context', context: null })
    await until(() => !stateOf(h, 'c9').busy && texts(stateOf(h, 'c9')).includes('text:Hello: second, edited'))
    expect(texts(stateOf(h, 'c9'))).toEqual(['user:first', 'text:Hello: first', 'user:second, edited', 'text:Hello: second, edited'])
    expect(prepared.at(-1)).toMatchObject({ resumeAgentSessionId: 'fake-claude-session', resumeAt: 'reply-1', initialPrompt: 'second, edited' })
    // The first message of the conversation: a new conversation, nothing kept.
    const h2 = harness(new LocalPipeLink(), null, 5, false, { resumePoint: () => Promise.resolve(null), prepared })
    await h2.host.open(launchOf('claude', 'c10', { resumeAgentSessionId: 'old' }), h2.owner)
    await ready(h2, 'c10')
    await h2.host.send('c10', { text: 'only', attachments: [] })
    await until(() => !stateOf(h2, 'c10').busy && texts(stateOf(h2, 'c10')).includes('text:Hello: only'))
    const only = stateOf(h2, 'c10').items.find((i) => i.kind === 'user')!
    expect((await h2.host.edit('c10', only.id, 'again')).ok).toBe(true)
    await until(() => texts(stateOf(h2, 'c10')).includes('text:Hello: again'))
    expect(texts(stateOf(h2, 'c10'))).toEqual(['user:again', 'text:Hello: again'])
    expect(prepared.at(-1)?.resumeAgentSessionId).toBeUndefined()
  }, 30_000)

  it('refuses an edit while a turn runs, of a message it does not have, or one the transcript lacks', async () => {
    const h = harness(new LocalPipeLink(), null, 5, false, { resumePoint: () => Promise.resolve(undefined) })
    await h.host.open(launchOf('claude', 'c11'), h.owner)
    await ready(h, 'c11')
    await h.host.send('c11', { text: 'slow answer', attachments: [] })
    await until(() => stateOf(h, 'c11').busy && stateOf(h, 'c11').items.some((i) => i.kind === 'user'))
    const sent = stateOf(h, 'c11').items.find((i) => i.kind === 'user')!
    expect(await h.host.edit('c11', sent.id, 'x')).toEqual({ ok: false, reason: '先停止这一轮再改' })
    h.host.interrupt('c11')
    await until(() => !stateOf(h, 'c11').busy)
    expect(await h.host.edit('c11', 'nope', 'x')).toEqual({ ok: false, reason: '找不到这条消息' })
    expect(await h.host.edit('c11', sent.id, 'x')).toEqual({ ok: false, reason: '对话记录里找不到这条消息' })
    expect(await h.host.edit('missing', sent.id, 'x')).toMatchObject({ ok: false })
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
    expect(opened.ok && opened.state.commands.length).toBe(2)
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
    // gpt-a has the priority tier: 快速 (Figma 65).
    expect(stateOf(h, 'x1').config.map((c) => `${c.id}=${c.current}`)).toEqual(['model=gpt-a', 'effort=low', 'permission=accept-edits', 'fast=off'])
    expect(h.status[0]).toEqual({ type: 'session-start', agentSessionId: 'thr-new' })

    await h.host.send('x1', { text: 'go', attachments: [] })
    await until(() => stateOf(h, 'x1').prompts.length === 1)
    const prompt = stateOf(h, 'x1').prompts[0]!
    expect(prompt).toMatchObject({ kind: 'permission', tool: 'Bash', detail: 'ls' })
    expect(h.status.map((e) => e.type)).toEqual(['session-start', 'prompt-submit', 'tool-start', 'permission-request'])
    h.host.answer('x1', { kind: 'permission', id: prompt.id, optionId: 'accept' })
    await until(() => !stateOf(h, 'x1').busy)
    const done = texts(stateOf(h, 'x1')).find((t) => t.startsWith('text:Done'))
    expect(done).toBe('text:Done ({"turnId":"turn-1","model":"gpt-a","effort":"low","approvalPolicy":"on-request","approvalsReviewer":null})')
    expect(h.status.at(-1)).toMatchObject({ type: 'stop', message: done!.slice(5) })
    expect(h.status.filter((e) => e.type === 'tool-end').length).toBeGreaterThan(0)

    expect(await h.host.setConfig('x1', 'model', 'gpt-b')).toBe(true)
    // 自动 (Figma 56): Codex's own reviewer takes what it would ask.
    expect(await h.host.setConfig('x1', 'permission', 'auto')).toBe(true)
    expect(stateOf(h, 'x1').config.map((c) => `${c.id}=${c.current}`)).toEqual(['model=gpt-b', 'effort=medium', 'permission=auto'])
    await h.host.send('x1', { text: 'go again', attachments: [] })
    await until(() => stateOf(h, 'x1').prompts.length === 1)
    h.host.answer('x1', { kind: 'permission', id: stateOf(h, 'x1').prompts[0]!.id, optionId: 'decline' })
    await until(() => !stateOf(h, 'x1').busy)
    expect(texts(stateOf(h, 'x1')).at(-1)).toBe('text:Done ({"turnId":"turn-2","model":"gpt-b","effort":"medium","approvalPolicy":"on-request","approvalsReviewer":"auto_review"})')

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

  it('reports the thread’s name as the session title: a resumed thread’s, and each thread/name/updated for it (PRD F2)', async () => {
    const h = harness()
    await h.host.open(launchOf('codex', 'x5', { resumeAgentSessionId: 'thr-named' }), h.owner)
    await ready(h, 'x5')
    expect(h.status).toContainEqual({ type: 'agent-title', title: 'Named earlier' })
    await h.host.send('x5', { text: 'name me', attachments: [] })
    await until(() => h.status.filter((e) => e.type === 'agent-title').length === 2)
    // Another thread's name is not this session's; one line, spaces folded (cleanTitle).
    expect(h.status.filter((e) => e.type === 'agent-title')).toEqual([
      { type: 'agent-title', title: 'Named earlier' },
      { type: 'agent-title', title: 'Fake thread name' }
    ])
  }, 30_000)

  it('starts with the saved 权限 level (Figma 56)', async () => {
    const h = harness()
    await h.host.open(launchOf('codex', 'x9', { permission: 'ask' }), h.owner)
    await ready(h, 'x9')
    expect(stateOf(h, 'x9').config.find((c) => c.id === 'permission')?.current).toBe('ask')
    await h.host.send('x9', { text: 'go', attachments: [] })
    await until(() => stateOf(h, 'x9').prompts.length === 1)
    h.host.answer('x9', { kind: 'permission', id: stateOf(h, 'x9').prompts[0]!.id, optionId: 'accept' })
    await until(() => !stateOf(h, 'x9').busy)
    expect(texts(stateOf(h, 'x9')).at(-1)).toContain('"approvalPolicy":"untrusted"')
  }, 30_000)

  it('applies the effort and 快速 last used with the agent once it is ready (Figma 65)', async () => {
    const h = harness()
    await h.host.open(launchOf('codex', 'x8', { effort: 'high', fast: true }), h.owner)
    await ready(h, 'x8')
    await until(() => stateOf(h, 'x8').config.find((c) => c.id === 'fast')?.current === 'on')
    expect(stateOf(h, 'x8').config.find((c) => c.id === 'effort')?.current).toBe('high')
    // One the model does not offer is left alone.
    const h2 = harness()
    await h2.host.open(launchOf('codex', 'x7', { effort: 'max' }), h2.owner)
    await ready(h2, 'x7')
    await settle()
    expect(stateOf(h2, 'x7').config.find((c) => c.id === 'effort')?.current).toBe('low')
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
    expect(opened.ok && opened.state.config.length).toBe(4)
    await until(() => b.status.some((e) => e.type === 'permission-request'))
    expect(b.status.map((e) => e.type)).toEqual(['prompt-submit', 'tool-start', 'permission-request', 'session-start'])
    expect(b.host.answer('x3', { kind: 'permission', id: stateOf(b, 'x3').prompts[0]!.id, optionId: 'accept' })).toBe(true)
    await until(() => !stateOf(b, 'x3').busy)
    expect(texts(stateOf(b, 'x3')).at(-1)).toMatch(/^text:Done/)
  }, 30_000)
})

describe('GuiHost · ACP', () => {
  it('names the agent by its label in what it reports (Grok, not grok)', async () => {
    const h = harness()
    await h.host.open(launchOf('grok', 'n1'), h.owner)
    await ready(h, 'n1')
    await h.host.send('n1', { text: 'refuse this', attachments: [] })
    await until(() => h.status.at(-1)?.type === 'stop-failure')
    expect(h.status.at(-1)).toEqual({ type: 'stop-failure', message: 'Grok 拒绝了这个请求' })
  })

  it('reports the agent’s session_info_update title as the session title, ignoring a cleared one (PRD F2)', async () => {
    const h = harness()
    await h.host.open(launchOf('gemini', 't1'), h.owner)
    await ready(h, 't1')
    await h.host.send('t1', { text: 'name me', attachments: [] })
    await until(() => stateOf(h, 't1').prompts.length === 1)
    expect(h.status.filter((e) => e.type === 'agent-title')).toEqual([{ type: 'agent-title', title: 'Fake ACP title' }])
  }, 30_000)

  it('handshakes, refuses fs requests, answers a permission, sets a picker and cancels', async () => {
    const h = harness()
    await h.host.open(launchOf('grok', 'a1'), h.owner)
    await ready(h, 'a1')
    expect(stateOf(h, 'a1').commands).toEqual([{ name: 'plan', description: 'Make a plan', argumentHint: 'what', kind: 'command' }])
    expect(h.status[0]).toEqual({ type: 'session-start', agentSessionId: 'acp-session-1' })

    await h.host.send('a1', { text: 'fs please', attachments: ['/tmp/a.png'] })
    await until(() => stateOf(h, 'a1').prompts.length === 1)
    const prompt = stateOf(h, 'a1').prompts[0]!
    expect(prompt).toMatchObject({ kind: 'permission', tool: 'Bash', detail: 'ls' })
    expect(prompt.kind === 'permission' && prompt.options.map((o) => o.id)).toEqual(['no', 'yes'])
    h.host.answer('a1', { kind: 'permission', id: prompt.id, optionId: 'yes' })
    await until(() => !stateOf(h, 'a1').busy)
    // The agent's image capability is off: the image went as a path in the text.
    expect(texts(stateOf(h, 'a1'))).toEqual(['user:fs please\n\n/tmp/a.png', 'text:fs refused -32601. Hi there (m1, agent)'])
    expect(stateOf(h, 'a1').items.find((i) => i.kind === 'tool')).toMatchObject({ name: 'Bash', state: 'ok', output: 'a.txt' })
    expect(h.status.map((e) => e.type)).toEqual(['session-start', 'prompt-submit', 'tool-start', 'permission-request', 'tool-end', 'tool-end', 'stop'])

    expect(await h.host.setConfig('a1', 'model', 'm2')).toBe(true)
    expect(stateOf(h, 'a1').config[0]!.current).toBe('m2')
    await h.host.send('a1', { text: 'slow', attachments: [] })
    await until(() => stateOf(h, 'a1').live !== null)
    expect(h.host.interrupt('a1')).toBe(true)
    await until(() => !stateOf(h, 'a1').busy)
    expect(stateOf(h, 'a1').items.at(-1)).toMatchObject({ kind: 'system', text: '已中断' })
    expect(texts(stateOf(h, 'a1')).at(-1)).toBe('text:Hi there (m2, agent)')
    await settle()
    expect(h.view('a1')).toEqual(stateOf(h, 'a1'))
  }, 30_000)

  it('shows one set of pickers (Figma 56): effort by its id, 权限, and the agent’s plan mode as 计划', async () => {
    const h = harness()
    await h.host.open(launchOf('gemini', 'g1'), h.owner)
    await ready(h, 'g1')
    const shown = () => stateOf(h, 'g1').config.map((c) => `${c.category}:${c.id}=${c.current}[${c.values.map((v) => v.label).join('/')}]`)
    // The model list comes flat out of its group; plan leaves the mode list for 计划; no 自动 (Gemini has none).
    expect(shown()).toEqual(['model:model=m1[M1/M2]', 'thought_level:reasoning_effort=high[高/低]', 'mode:mode=agent[Agent/Ask]', 'permission:permission=ask[询问/接受编辑]', 'plan:plan=off[关/开]'])
    expect(await h.host.setConfig('g1', 'plan', 'on')).toBe(true)
    expect(shown().slice(2)).toEqual(['mode:mode=agent[Agent/Ask]', 'permission:permission=ask[询问/接受编辑]', 'plan:plan=on[关/开]'])
    await h.host.send('g1', { text: 'slow', attachments: [] })
    await until(() => stateOf(h, 'g1').live?.kind === 'text' && stateOf(h, 'g1').live!.text.includes('plan'))
    h.host.interrupt('g1')
    await until(() => !stateOf(h, 'g1').busy)
    expect(await h.host.setConfig('g1', 'plan', 'off')).toBe(true)
    expect(shown()[4]).toBe('plan:plan=off[关/开]')

    // 接受编辑: Wavi lets a change to files through itself; anything else is still asked.
    expect(await h.host.setConfig('g1', 'permission', 'accept-edits')).toBe(true)
    expect(await h.host.setConfig('g1', 'permission', 'auto')).toBe(false)
    await h.host.send('g1', { text: 'edit please', attachments: [] })
    await until(() => !stateOf(h, 'g1').busy)
    expect(stateOf(h, 'g1').prompts).toEqual([])
    expect(stateOf(h, 'g1').items.filter((i) => i.kind === 'tool').at(-1)).toMatchObject({ state: 'ok' })
    await h.host.send('g1', { text: 'run ls', attachments: [] })
    await until(() => stateOf(h, 'g1').prompts.length === 1)
    h.host.answer('g1', { kind: 'permission', id: stateOf(h, 'g1').prompts[0]!.id, optionId: 'no' })
    await until(() => !stateOf(h, 'g1').busy)
  }, 30_000)

  it('restarts Grok on its conversation when 自动 or 计划 is a launch argument (Figma 56)', async () => {
    const prepared: GuiLaunch[] = []
    const h = harness(new LocalPipeLink(), null, 5, false, { prepared })
    await h.host.open(launchOf('grok', 'k1'), h.owner)
    await ready(h, 'k1')
    const pick = () => stateOf(h, 'k1').config.flatMap((c) => (c.category === 'permission' || c.category === 'plan' ? [`${c.id}=${c.current}[${c.values.map((v) => v.label).join('/')}]`] : []))
    expect(pick()).toEqual(['permission=ask[询问/接受编辑/自动]', 'plan=off[关/开]'])
    // 询问 ↔ 接受编辑 is Wavi's: no restart.
    expect(await h.host.setConfig('k1', 'permission', 'accept-edits')).toBe(true)
    expect(prepared.length).toBe(1)
    expect(await h.host.setConfig('k1', 'permission', 'auto')).toBe(true)
    expect(prepared.at(-1)).toMatchObject({ permission: 'auto', plan: false, resumeAgentSessionId: 'acp-session-1' })
    await until(() => stateOf(h, 'k1').config.length > 0 && texts(stateOf(h, 'k1')).includes('user:earlier question'))
    expect(pick()).toEqual(['permission=auto[询问/接受编辑/自动]', 'plan=off[关/开]'])
    expect(await h.host.setConfig('k1', 'plan', 'on')).toBe(true)
    expect(prepared.at(-1)).toMatchObject({ permission: 'auto', plan: true })
    await until(() => stateOf(h, 'k1').config.some((c) => c.id === 'plan' && c.current === 'on'))
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

  it('end kills a process this host never opened (kept from an earlier app run), and only a listed pipe session', async () => {
    const link = new LocalPipeLink()
    const h = harness(link)
    // An earlier app run started it: the pipe host has it, this host has no session for it.
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }
    const started = await link.spawn({ id: 'o1', cwd: process.cwd(), command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], baseEnv: env }, { line: () => undefined, exit: () => undefined })
    expect(started.ok).toBe(true)
    expect(h.host.has('o1')).toBe(false)
    await h.host.end('o1')
    expect(link.has('o1')).toBe(false)

    // Not a pipe session (a terminal's id): not killed.
    const kills: string[] = []
    const terminalsOnly: PipeLink = {
      durable: true,
      spawn: () => Promise.resolve({ ok: false, message: 'not in this test' }),
      attach: () => Promise.resolve(null),
      write: () => false,
      kill: (id) => void kills.push(id),
      list: () => Promise.resolve([])
    }
    const other = new GuiHost<FakeOwner>({
      link: () => terminalsOnly,
      prepare: () => Promise.reject(new Error('not in this test')),
      history: () => Promise.resolve(null),
      resumePoint: () => Promise.resolve(undefined),
      status: () => undefined,
      adopted: () => undefined,
      ended: () => undefined,
      image: () => Promise.resolve(null),
      clientVersion: '0'
    })
    await other.end('t1')
    expect(kills).toEqual([])
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

describe('GuiHost · Pi rpc (PRD F23 v1.160)', () => {
  const tools = (state: GuiState) => state.items.filter((i) => i.kind === 'tool')

  it('streams a turn, asks before bash, lets 接受编辑’s edits and 总是允许’s repeats through, and stops', async () => {
    const prepared: GuiLaunch[] = []
    const h = harness(new LocalPipeLink(), null, 5, false, { prepared })
    await h.host.open(launchOf('pi', 'p1'), h.owner)
    await ready(h, 'p1')
    expect(h.status[0]).toEqual({ type: 'session-start', agentSessionId: 'fake-pi-session' })
    const shown = () => stateOf(h, 'p1').config.map((c) => `${c.id}=${c.current}[${c.values.map((v) => v.label).join('/')}]`)
    expect(shown()).toEqual(['model=deepseek/deepseek-v4-flash[DeepSeek V4 Flash/DeepSeek V4 Pro]', 'effort=high[关/高/最高]', 'permission=ask[询问/接受编辑]'])
    expect(stateOf(h, 'p1').commands.map((c) => `${c.name}:${c.kind}`)).toEqual(['review:command', 'skill:lark:skill'])

    await h.host.send('p1', { text: 'hello', attachments: ['/tmp/a.png'] })
    await until(() => !stateOf(h, 'p1').busy && texts(stateOf(h, 'p1')).length === 2)
    // DeepSeek V4 Flash takes no images: the image went as a path.
    expect(texts(stateOf(h, 'p1'))).toEqual(['user:hello\n\n/tmp/a.png', 'text:Hello: hello\n\n/tmp/a.png (deepseek-v4-flash, high)'])

    await h.host.send('p1', { text: 'bash please', attachments: [] })
    await until(() => stateOf(h, 'p1').prompts.length === 1)
    const prompt = stateOf(h, 'p1').prompts[0]!
    expect(prompt).toMatchObject({ kind: 'permission', tool: 'Bash', detail: 'ls' })
    expect(tools(stateOf(h, 'p1')).at(-1)).toMatchObject({ name: 'Bash', state: 'running' })
    h.host.answer('p1', { kind: 'permission', id: prompt.id, optionId: 'always' })
    await until(() => !stateOf(h, 'p1').busy)
    expect(tools(stateOf(h, 'p1')).at(-1)).toMatchObject({ name: 'Bash', state: 'ok', output: 'a.txt' })
    expect(h.status.map((e) => e.type)).toEqual(['session-start', 'prompt-submit', 'stop', 'prompt-submit', 'tool-start', 'permission-request', 'tool-end', 'tool-end', 'stop'])
    // The same call again: through without asking.
    await h.host.send('p1', { text: 'bash again', attachments: [] })
    await until(() => !stateOf(h, 'p1').busy && tools(stateOf(h, 'p1')).length === 2)
    expect(tools(stateOf(h, 'p1')).at(-1)).toMatchObject({ state: 'ok' })

    // 接受编辑 is Wavi's: no restart, the edit goes through with Pi's own patch.
    expect(await h.host.setConfig('p1', 'permission', 'accept-edits')).toBe(true)
    expect(await h.host.setConfig('p1', 'permission', 'auto')).toBe(false)
    expect(prepared.length).toBe(1)
    await h.host.send('p1', { text: 'edit it', attachments: [] })
    await until(() => !stateOf(h, 'p1').busy && tools(stateOf(h, 'p1')).length === 3)
    const edit = tools(stateOf(h, 'p1')).at(-1)
    expect(edit).toMatchObject({ name: 'Edit', arg: 'a.txt', state: 'ok', diff: { added: 1, removed: 1 } })
    expect(edit?.kind === 'tool' && edit.diff?.hunks[0]?.oldStart).toBe(3)
    expect(stateOf(h, 'p1').prompts).toEqual([])

    await h.host.send('p1', { text: 'slow', attachments: [] })
    await until(() => stateOf(h, 'p1').live !== null)
    expect(h.host.interrupt('p1')).toBe(true)
    await until(() => !stateOf(h, 'p1').busy)
    expect(stateOf(h, 'p1').items.at(-1)).toMatchObject({ kind: 'system', text: '已中断' })
    await settle()
    expect(h.view('p1')).toEqual(stateOf(h, 'p1'))
  }, 30_000)

  it('a model or thinking change restarts Pi on its conversation with them, the chat kept; not while a turn runs', async () => {
    const prepared: GuiLaunch[] = []
    const h = harness(new LocalPipeLink(), null, 5, false, { prepared })
    await h.host.open(launchOf('pi', 'p2'), h.owner)
    await ready(h, 'p2')
    await h.host.send('p2', { text: 'hello', attachments: [] })
    await until(() => !stateOf(h, 'p2').busy && texts(stateOf(h, 'p2')).length === 2)

    expect(await h.host.setConfig('p2', 'effort', 'max')).toBe(true)
    expect(prepared.at(-1)).toMatchObject({ model: 'deepseek/deepseek-v4-flash', effort: 'max', resumeAgentSessionId: 'fake-pi-session' })
    await until(() => stateOf(h, 'p2').config.length > 0)
    expect(stateOf(h, 'p2').config.find((c) => c.id === 'effort')?.current).toBe('max')
    expect(texts(stateOf(h, 'p2'))).toEqual(['user:hello', 'text:Hello: hello (deepseek-v4-flash, high)'])
    await h.host.send('p2', { text: 'again', attachments: [] })
    await until(() => !stateOf(h, 'p2').busy && texts(stateOf(h, 'p2')).length === 4)
    expect(texts(stateOf(h, 'p2')).at(-1)).toBe('text:Hello: again (deepseek-v4-flash, max)')

    expect(await h.host.setConfig('p2', 'model', 'deepseek/deepseek-v4-pro')).toBe(true)
    expect(prepared.at(-1)).toMatchObject({ model: 'deepseek/deepseek-v4-pro', effort: 'max' })
    await until(() => stateOf(h, 'p2').config.length > 0)
    await h.host.send('p2', { text: 'slow', attachments: [] })
    await until(() => stateOf(h, 'p2').live !== null)
    expect(await h.host.setConfig('p2', 'effort', 'high')).toBe(false)
    expect(stateOf(h, 'p2').config.find((c) => c.id === 'effort')?.current).toBe('max')
    expect(prepared.length).toBe(3)
    h.host.interrupt('p2')
    await until(() => !stateOf(h, 'p2').busy)
  }, 30_000)

  it('choosing 接受编辑 while an edit waits lets it through', async () => {
    const h = harness()
    await h.host.open(launchOf('pi', 'p4'), h.owner)
    await ready(h, 'p4')
    await h.host.send('p4', { text: 'edit it', attachments: [] })
    await until(() => stateOf(h, 'p4').prompts.length === 1)
    expect(stateOf(h, 'p4').prompts[0]).toMatchObject({ kind: 'permission', tool: 'Edit', detail: 'a.txt', diff: { added: 1, removed: 1 } })
    expect(await h.host.setConfig('p4', 'permission', 'accept-edits')).toBe(true)
    await until(() => !stateOf(h, 'p4').busy)
    expect(stateOf(h, 'p4').prompts).toEqual([])
    expect(stateOf(h, 'p4').items.filter((i) => i.kind === 'tool').at(-1)).toMatchObject({ name: 'Edit', state: 'ok' })
  }, 30_000)

  it('a refused prompt ends the turn as failed; a resumed conversation comes from its session file', async () => {
    const history: ChatItem[] = [{ kind: 'user', id: 'h0', at: 1, text: 'earlier question', images: 0 }, { kind: 'text', id: 'h1', at: 2, text: 'earlier answer' }]
    const h = harness(new LocalPipeLink(), history)
    await h.host.open(launchOf('pi', 'p3', { resumeAgentSessionId: 'pi-old' }), h.owner)
    await ready(h, 'p3')
    expect(h.status[0]).toEqual({ type: 'session-start', agentSessionId: 'pi-old' })
    expect(texts(stateOf(h, 'p3'))).toEqual(['user:earlier question', 'text:earlier answer'])
    await h.host.send('p3', { text: 'refuse this', attachments: [] })
    await until(() => h.status.at(-1)?.type === 'stop-failure')
    expect(h.status.at(-1)).toEqual({ type: 'stop-failure', message: 'No API key for deepseek' })
    expect(stateOf(h, 'p3').busy).toBe(false)
  }, 30_000)
})

describe('GuiHost · context (Figma 52G)', () => {
  const contexts = (h: Harness) => h.status.flatMap((e) => (e.type === 'context' ? [e.context] : []))

  it('Codex: its own thread’s thread/tokenUsage/updated', async () => {
    const h = harness()
    await h.host.open(launchOf('codex', 'k1'), h.owner)
    await ready(h, 'k1')
    await h.host.send('k1', { text: 'measure slow', attachments: [] })
    await until(() => contexts(h).length > 0)
    expect(contexts(h)).toEqual([expect.objectContaining({ percent: 50, usedTokens: 135200, windowTokens: 258400 })])
  })

  it('ACP: usage_update', async () => {
    const h = harness()
    await h.host.open(launchOf('grok', 'k2'), h.owner)
    await ready(h, 'k2')
    await h.host.send('k2', { text: 'measure slow', attachments: [] })
    await until(() => contexts(h).length > 0)
    expect(contexts(h)).toEqual([{ percent: 27, usedTokens: 53000, windowTokens: 200000 }])
  })

  it('Pi: get_session_stats after a turn', async () => {
    const h = harness()
    await h.host.open(launchOf('pi', 'k3'), h.owner)
    await ready(h, 'k3')
    await h.host.send('k3', { text: 'measure', attachments: [] })
    await until(() => contexts(h).length > 0)
    expect(contexts(h)).toEqual([{ percent: 30, usedTokens: 60000, windowTokens: 200000 }])
  })
})

describe('GuiHost · reattach edge cases (a stub link)', () => {
  const user = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' }, session_id: 's-1' })
  const reply = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello: hello' }] }, session_id: 's-1', parent_tool_use_id: null })
  const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's-1' })

  function stubHost(attach: PipeAttach, history: ChatItem[] | null) {
    const writes: string[] = []
    const adopted: string[] = []
    const status: AgentEvent[] = []
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
      resumePoint: () => Promise.resolve(undefined),
      status: (_id, _agent, events) => void status.push(...events),
      adopted: (id) => adopted.push(id),
      ended: () => undefined,
      image: () => Promise.resolve(null),
      clientVersion: '0',
      batchMs: 5
    })
    return { host, writes, adopted, status }
  }

  it('a title among the kept lines is sent once, after the replay, and again to a window that claims the session (Codex)', async () => {
    const started = JSON.stringify({ id: 7, result: { thread: { id: 'thr-1', name: null } } })
    const named = (threadId: string, threadName: string) => JSON.stringify({ method: 'thread/name/updated', params: { threadId, threadName } })
    const { host, status } = stubHost({ pid: 1, seq: 3, lines: [started, named('thr-other', 'Not ours'), named('thr-1', 'Ours')], truncated: false }, null)
    const opened = await host.open(launchOf('codex', 'r1'), new FakeOwner())
    expect(opened.ok).toBe(true)
    expect(status.filter((e) => e.type === 'agent-title')).toEqual([{ type: 'agent-title', title: 'Ours' }])
    // A reloaded window opens the running session again.
    expect((await host.open(launchOf('codex', 'r1'), new FakeOwner())).ok).toBe(true)
    expect(status.filter((e) => e.type === 'agent-title')).toEqual([
      { type: 'agent-title', title: 'Ours' },
      { type: 'agent-title', title: 'Ours' }
    ])
    host.stop('r1')
  })

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
    expect(opened.ok && opened.exited).toBeUndefined()
    expect(adopted).toEqual(['r1'])
    // No `initialize` answer among the kept lines: the handshake runs again.
    expect(writes.map((w) => (JSON.parse(w) as { request?: { subtype?: string } }).request?.subtype)).toEqual(['initialize'])
    host.stop('r1')
  })

  it('a replayed prompt the earlier app run already answered is not asked again (Claude, Codex, ACP, Pi)', async () => {
    const tool = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'sleep 60' } }] }, session_id: 's-1', parent_tool_use_id: null })
    const ask = (id: string) => JSON.stringify({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'sleep 60' }, tool_use_id: 'tu1' } })
    const claude = (answered?: string[]) => stubHost({ pid: 1, seq: 4, lines: [user, tool, ask('req-1')], truncated: false, ...(answered ? { answered } : {}) }, null).host
    const asked = await claude().open(launchOf('claude', 'r1'), new FakeOwner())
    expect(asked.ok && asked.state.prompts.length).toBe(1)
    const answered = await claude(['req-1']).open(launchOf('claude', 'r1'), new FakeOwner())
    expect(answered.ok && answered.state.prompts).toEqual([])
    expect(answered.ok && answered.state.busy).toBe(true)

    const approval = JSON.stringify({ id: 0, method: 'item/commandExecution/requestApproval', params: { threadId: 't', turnId: 'u', itemId: 'i', command: 'ls', cwd: '/w' } })
    const codex = (answered?: string[]) => stubHost({ pid: 1, seq: 1, lines: [approval], truncated: false, ...(answered ? { answered } : {}) }, null).host
    const codexAsked = await codex().open(launchOf('codex', 'r1'), new FakeOwner())
    expect(codexAsked.ok && codexAsked.state.prompts.length).toBe(1)
    const codexAnswered = await codex(['0']).open(launchOf('codex', 'r1'), new FakeOwner())
    expect(codexAnswered.ok && codexAnswered.state.prompts).toEqual([])

    const permission = JSON.stringify({
      jsonrpc: '2.0',
      id: 1001,
      method: 'session/request_permission',
      params: { sessionId: 'a', toolCall: { toolCallId: 'c1', title: 'ls', kind: 'execute' }, options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }] }
    })
    const acp = (answered?: string[]) => stubHost({ pid: 1, seq: 1, lines: [permission], truncated: false, ...(answered ? { answered } : {}) }, null).host
    const acpAsked = await acp().open(launchOf('grok', 'r1'), new FakeOwner())
    expect(acpAsked.ok && acpAsked.state.prompts.length).toBe(1)
    const acpAnswered = await acp(['1001']).open(launchOf('grok', 'r1'), new FakeOwner())
    expect(acpAnswered.ok && acpAnswered.state.prompts).toEqual([])

    const confirm = JSON.stringify({ type: 'extension_ui_request', id: 'ui-1', method: 'confirm', title: 'Allow bash?', message: JSON.stringify({ wavi: 1, tool: 'bash', input: { command: 'ls' } }) })
    const pi = (answered?: string[]) => stubHost({ pid: 1, seq: 1, lines: [confirm], truncated: false, ...(answered ? { answered } : {}) }, null).host
    const piAsked = await pi().open(launchOf('pi', 'r1'), new FakeOwner())
    expect(piAsked.ok && piAsked.state.prompts.length).toBe(1)
    const piAnswered = await pi(['ui-1']).open(launchOf('pi', 'r1'), new FakeOwner())
    expect(piAnswered.ok && piAnswered.state.prompts).toEqual([])
  })

  it('Pi: an edit asked while no app was attached goes through on reattach under 接受编辑; a command is still asked', async () => {
    const confirm = (id: string, tool: string, input: unknown) => JSON.stringify({ type: 'extension_ui_request', id, method: 'confirm', title: `Allow ${tool}?`, message: JSON.stringify({ wavi: 1, tool, input }) })
    const state = JSON.stringify({ id: 'w1-0', type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi-1', model: { provider: 'deepseek', id: 'deepseek-v4-flash' }, thinkingLevel: 'high' } })
    const { host, writes } = stubHost({ pid: 1, seq: 3, lines: [state, confirm('ui-1', 'edit', { path: 'a.txt', edits: [] }), confirm('ui-2', 'bash', { command: 'ls' })], truncated: false }, null)
    const opened = await host.open(launchOf('pi', 'r1', { permission: 'accept-edits' }), new FakeOwner())
    expect(opened.ok && opened.state.prompts.map((p) => p.id)).toEqual(['ui-2'])
    expect(writes.map((w) => JSON.parse(w) as unknown)).toContainEqual({ type: 'extension_ui_response', id: 'ui-1', confirmed: true })
    host.stop('r1')
  })

  it('a process that ended while no app was attached shows why, with the stderr attach brought', async () => {
    const { host, adopted } = stubHost({ pid: 1, seq: 2, lines: [user, reply], truncated: false, exit: { exitCode: 1, stderr: 'Error: not logged in' } }, null)
    const opened = await host.open(launchOf('claude', 'r1'), new FakeOwner())
    expect(opened.ok && texts(opened.state)).toEqual(['user:hello', 'text:Hello: hello'])
    expect(opened.ok && opened.state.failure).toBe('claude 退出了（退出码 1）：Error: not logged in')
    expect(opened.ok && opened.state.busy).toBe(false)
    expect(opened.ok && opened.exited).toBe(true)
    expect(adopted).toEqual([])
  })
})
