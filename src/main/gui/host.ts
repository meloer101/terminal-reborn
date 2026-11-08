// GUI sessions in main (PRD F23): one `GuiSession` per session id holds the agent's process (through a `PipeLink`),
// its protocol driver, the `GuiState` the renderer draws (folded with `applyGuiEvent`), the queue of messages sent
// while a turn runs, and the window that owns it. Events go to that window batched per session. `open` starts the
// agent, reattaches to one the pty daemon kept running (replaying its kept lines), or resumes an earlier conversation;
// history the process no longer has is rebuilt from the agent's transcript. Electron-free: index.ts wires it.

import type { AgentEvent } from '@shared/agent-events'
import { agentName, type CliAgent } from '@shared/agents'
import { AGENT_GUI, launchPermissionOf } from '@shared/gui-agents'
import { applyGuiEvent, emptyGuiState, GUI_IPC, guiCanEdit, type GuiAnswer, type GuiEvent, type GuiLaunch, type GuiOpenResult, type GuiPermission, type GuiProtocol, type GuiSendResult, type GuiState } from '@shared/gui-chat'
import type { ChatItem } from '@shared/transcript-chat'
import type { PipeAttach, PipeHandlers, PipeLink } from '../pty/pipes'
import type { PipeExit } from '../../pty-host/pipe-host'
import { createAcpDriver } from './acp-driver'
import { createClaudeDriver } from './claude-driver'
import { createCodexDriver } from './codex-driver'
import { isRec, type DriverIO, type GuiDriver, type ImageBlock } from './driver'
import { cleanTitle } from '../hooks/agent-title'
import { exitReason } from './launch'
import { createGuiStatusTracker, toolInputOf, type GuiStatusTracker } from './status'

export interface GuiOwner {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export interface PreparedLaunch {
  command: string
  args: string[]
  env: Record<string, string>
  baseEnv?: Record<string, string>
  /** The binary, named in failure reasons. */
  binary: string
  /**
   * Claude's hooks will not reach this app (none could be prepared, or they go to a pty daemon that does not host
   * this process): its status is derived from the stream, as for the agents without hooks.
   */
  synthStatus?: boolean
}

export interface GuiHostDeps<O extends GuiOwner> {
  link(): PipeLink
  /** The process for a launch (hooks, dispatch, argv). Throws an Error whose message is shown to the user. */
  prepare(launch: GuiLaunch, owner: O, resume: string | undefined): Promise<PreparedLaunch>
  /** The earlier conversation `agentSessionId` names, from the agent's transcript; null when there is none. */
  history(agent: CliAgent, cwd: string, agentSessionId: string): Promise<ChatItem[] | null>
  /**
   * An edit of the prompt `messageId` (Claude): the message to resume up to (`--resume-session-at`), null when it is the
   * conversation's first message, undefined when the transcript has no such prompt.
   */
  resumePoint(agent: CliAgent, cwd: string, agentSessionId: string, messageId: string): Promise<string | null | undefined>
  /**
   * Status for the session's owner: everything for the agents without hooks (and a Claude whose hooks do not reach the
   * app, PreparedLaunch.synthStatus), start and exit for Claude (PRD §3.1); the agent's own title (`agent-title`) for
   * the agents that report one over their protocol (Codex, ACP; Claude's is read from its transcript after hooks).
   */
  status(sessionId: string, agent: CliAgent, events: AgentEvent[], owner: O | null): void
  /**
   * Reattached to a process that kept running: its hooks reach this owner again. `hooks`: what the pty daemon
   * answered while no app was attached (its `HookJournalEntry`s), for Claude's status to catch up.
   */
  adopted(sessionId: string, agent: CliAgent, owner: O, hooks: readonly unknown[]): void
  /** The process ended or was stopped. */
  ended(sessionId: string, agent: CliAgent): void
  image(path: string): Promise<ImageBlock | null>
  clientVersion: string
  /** Events of a session are sent together at most this often (default 16 ms). */
  batchMs?: number
}

class GuiSession<O extends GuiOwner> {
  state: GuiState = emptyGuiState()
  owner: O | null
  agentSessionId: string | undefined
  exited = false
  private stopped = false
  private ready = false
  private driver!: GuiDriver
  private readonly protocol: GuiProtocol
  private tracker: GuiStatusTracker = createGuiStatusTracker()
  private pending: GuiEvent[] = []
  private timer: NodeJS.Timeout | null = null
  /** The driver's item indexes → indexes in `state.items` (history from a transcript sits before them). */
  private readonly indexes = new Map<number, number>()
  /** While a reattached session's kept lines are read back: items wait here, status is not sent. */
  private replay: { items: { index: number; item: ChatItem }[] } | null = null
  /** Live lines that arrive before the kept ones are read; and the last line number handled. */
  private early: { line: string; seq: number }[] | null = null
  private seq = 0
  private attachments = new Map<string, string[]>()
  private queuedSeq = 0
  private initialSent = false
  /** Reattached to a running process: its first message went long ago. */
  private reattached = false
  /** Status is not sent while a replay is folded in (resumeStatus sends where things stand afterwards). */
  private muted = false
  private statusSessionId: string | undefined
  private binary: string
  /** A Claude process whose hooks do not reach the app (PreparedLaunch.synthStatus). */
  private hookless = false
  /** The agent's latest name for the conversation; sent again after a replay, which mutes status. */
  private title: string | undefined

  constructor(
    readonly launch: GuiLaunch,
    owner: O,
    private readonly deps: GuiHostDeps<O>,
    /** Restarts this session with another launch-argument permission (GuiHost.relaunch). */
    private readonly onRelaunch: (change: { permission: GuiPermission; plan: boolean }) => Promise<boolean>,
    /**
     * An edit or a restart: the conversation to draw first instead of reading the transcript (what was kept before the
     * edited message; nothing for a restart, whose agent replays it).
     */
    private readonly kept?: readonly ChatItem[]
  ) {
    this.owner = owner
    this.protocol = AGENT_GUI[launch.agent]?.protocol ?? 'acp'
    this.binary = launch.agent
    this.agentSessionId = launch.resumeAgentSessionId
  }

  get id(): string {
    return this.launch.sessionId
  }

  private get synthStatus(): boolean {
    return this.protocol !== 'claude-stream' || this.hookless
  }

  private createDriver(resume: string | undefined, answered?: readonly string[]): GuiDriver {
    const io: DriverIO = {
      write: (message) => !this.exited && this.deps.link().write(this.id, JSON.stringify(message)),
      emit: (events) => this.emit(events),
      ready: () => this.becomeReady(),
      agentSession: (id) => {
        this.agentSessionId = id
        if (!this.replay && (this.ready || this.protocol === 'claude-stream')) this.started()
      },
      turnEnd: (outcome) => {
        if (!this.exited && this.synthStatus) this.status(this.tracker.turnEnd(outcome))
      },
      fail: (reason) => this.fail(reason),
      title: (raw) => this.named(raw),
      image: (path) => this.deps.image(path),
      relaunch: (change) => this.onRelaunch(change)
    }
    const launchPermission = launchPermissionOf(this.launch.agent)
    const options = {
      cwd: this.launch.cwd,
      clientVersion: this.deps.clientVersion,
      ...(this.launch.permission ? { permission: this.launch.permission } : {}),
      ...(this.launch.plan !== undefined ? { plan: this.launch.plan } : {}),
      ...(launchPermission ? { launchPermission } : {}),
      ...(resume ? { resume } : {}),
      ...(this.launch.model ? { model: this.launch.model } : {}),
      ...(answered && answered.length > 0 ? { answered: new Set(answered) } : {})
    }
    if (this.protocol === 'claude-stream') return createClaudeDriver(io, options)
    if (this.protocol === 'codex-app-server') return createCodexDriver(io, options)
    return createAcpDriver(io, { ...options, label: agentName(this.launch.agent) })
  }

  private handlers(): PipeHandlers {
    return {
      line: (line, seq) => {
        if (this.early) {
          this.early.push({ line, seq })
          return
        }
        this.take(line, seq)
      },
      exit: (exit) => this.onExit(exit)
    }
  }

  private take(line: string, seq: number): void {
    if (seq <= this.seq) return
    this.seq = seq
    const message = parseLine(line)
    if (message && !this.exited) this.driver.line(message, false)
  }

  /** Starts the agent, or reattaches to the one the pipe host still runs. */
  async begin(resume: string | undefined): Promise<GuiOpenResult> {
    // `pipeLink()` is asked at each use: after a pty host restart it routes to another host.
    const listed = (await this.deps.link().list().catch(() => [])).some((s) => s.id === this.id)
    // Also one that ended while no app was attached: its kept lines are the conversation, and only `attach` carries
    // its real stderr (the daemon hands such a session over once, then forgets it).
    if (listed) {
      this.early = []
      const snapshot = await this.deps.link().attach(this.id, this.handlers()).catch(() => null)
      if (snapshot) {
        this.driver = this.createDriver(this.agentSessionId, snapshot.answered)
        await this.reattach(snapshot)
        return { ok: true, state: this.snapshot(), ...(this.exited ? { exited: true } : {}) }
      }
      this.early = null
    }
    return this.spawn(resume)
  }

  private async spawn(resume: string | undefined): Promise<GuiOpenResult> {
    this.driver = this.createDriver(resume)
    // Claude and Codex do not replay a resumed conversation over the protocol: read it from the transcript. After an
    // edit the transcript still holds the cut turns until the new message is written: what was kept is drawn instead.
    if (this.kept) this.emit([{ type: 'reset', items: [...this.kept] }])
    else if (resume && this.protocol !== 'acp') {
      const items = await this.deps.history(this.launch.agent, this.launch.cwd, resume).catch(() => null)
      if (items && items.length > 0) this.emit([{ type: 'reset', items }])
    }
    let prepared: PreparedLaunch
    try {
      prepared = await this.deps.prepare(this.launch, this.owner!, resume)
    } catch (error) {
      this.exited = true
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    this.binary = prepared.binary
    this.hookless = prepared.synthStatus === true
    if (this.stopped) return { ok: false, reason: '会话已关闭' }
    const started = await this.deps
      .link()
      .spawn({ id: this.id, cwd: this.launch.cwd, agent: this.launch.agent, command: prepared.command, args: prepared.args, env: prepared.env, ...(prepared.baseEnv ? { baseEnv: prepared.baseEnv } : {}) }, this.handlers())
    if (!started.ok) {
      this.exited = true
      this.deps.ended(this.id, this.launch.agent)
      return { ok: false, reason: `没能启动 ${prepared.binary}：${started.message}` }
    }
    this.driver.start()
    return { ok: true, state: this.snapshot() }
  }

  private async reattach(snapshot: PipeAttach & { hooks?: readonly unknown[] }): Promise<void> {
    if (this.owner && !snapshot.exit) this.deps.adopted(this.id, this.launch.agent, this.owner, Array.isArray(snapshot.hooks) ? snapshot.hooks : [])
    this.reattached = true
    this.muted = true
    this.replay = { items: [] }
    for (const line of snapshot.lines) {
      const message = parseLine(line)
      if (message) this.driver.line(message, true)
    }
    const replayed = this.replay.items
    this.replay = null
    // What the kept lines no longer hold (truncated, or a conversation resumed before) comes from the transcript.
    const id = this.agentSessionId ?? this.launch.resumeAgentSessionId
    const wantsHistory = (snapshot.truncated || this.launch.resumeAgentSessionId !== undefined) && this.protocol !== 'acp' && id !== undefined
    const history = wantsHistory ? await this.deps.history(this.launch.agent, this.launch.cwd, id).catch(() => null) : null
    const top = replayed.reduce((max, c) => Math.max(max, c.index), -1)
    if (history && history.length > top) {
      // The newest transcript items are the ones the kept lines describe: later changes to them land there.
      const offset = history.length - (top + 1)
      this.emit([{ type: 'reset', items: history }])
      for (let i = 0; i <= top; i++) this.indexes.set(i, offset + i)
    } else {
      this.emit([{ type: 'items', changes: replayed }])
    }
    this.seq = snapshot.seq
    const early = this.early ?? []
    this.early = null
    for (const { line, seq } of early) this.take(line, seq)
    this.muted = false
    this.resumeStatus()
    if (snapshot.exit) this.onExit(snapshot.exit)
    else this.driver.replayed()
  }

  /** After a replay: what the session is doing now, as one fresh set of status events. */
  private resumeStatus(): void {
    const tracker = createGuiStatusTracker()
    tracker.events([{ type: 'items', changes: this.state.items.map((item, index) => ({ index, item })) }])
    this.tracker = tracker
    if (!this.synthStatus) return
    const out: AgentEvent[] = []
    if (this.state.busy) {
      const user = [...this.state.items].reverse().find((i) => i.kind === 'user')
      out.push(...tracker.sent(user?.kind === 'user' ? user.text : ''))
      for (const item of this.state.items) if (item.kind === 'tool' && item.state === 'running') out.push({ type: 'tool-start', tool: item.name, input: toolInputOf(item.name, item.arg) })
    }
    out.push(...tracker.events(this.state.prompts.map((prompt) => ({ type: 'prompt' as const, prompt }))))
    if (this.title) out.push({ type: 'agent-title', title: this.title })
    this.status(out)
  }

  /** The agent named the conversation: the session's title (PRD F2), as a hook-read title is for a TUI. */
  private named(raw: string): void {
    const title = cleanTitle(raw)
    if (!title || title === this.title) return
    this.title = title
    this.status([{ type: 'agent-title', title }])
  }

  private started(): void {
    if (this.statusSessionId !== undefined && this.statusSessionId === this.agentSessionId) return
    this.statusSessionId = this.agentSessionId
    this.status(this.tracker.started(this.agentSessionId))
  }

  private becomeReady(): void {
    if (this.ready || this.exited) return
    this.ready = true
    this.started()
    if (this.launch.initialPrompt && !this.initialSent && !this.reattached) {
      this.initialSent = true
      if (!this.state.busy && this.state.queued.length === 0) void this.sendNow(this.launch.initialPrompt, [])
      else this.enqueue(this.launch.initialPrompt, [])
    }
    this.pump()
  }

  private status(events: AgentEvent[]): void {
    if (events.length === 0 || this.replay || this.muted) return
    this.deps.status(this.id, this.launch.agent, events, this.liveOwner())
  }

  private liveOwner(): O | null {
    return this.owner && !this.owner.isDestroyed() ? this.owner : null
  }

  /** Driver events: indexes mapped, folded into the state, queued for the owner, status derived. */
  emit(events: GuiEvent[]): void {
    const out: GuiEvent[] = []
    for (const event of events) {
      if (event.type === 'items' && this.replay) {
        this.replay.items.push(...event.changes)
        continue
      }
      if (event.type === 'items') {
        // One change at a time: a new index is the next free one only after the one before it landed.
        const changes = event.changes.map((c) => {
          const change = { index: this.indexOf(c.index), item: c.item }
          this.state = applyGuiEvent(this.state, { type: 'items', changes: [change] })
          return change
        })
        out.push({ type: 'items', changes })
        continue
      }
      // Later driver items follow a history put in with `reset`.
      if (event.type === 'reset') this.indexes.clear()
      this.state = applyGuiEvent(this.state, event)
      out.push(event)
    }
    if (out.length === 0) return
    if (this.synthStatus) this.status(this.tracker.events(out))
    this.queue(out)
    if (out.some((e) => e.type === 'busy' && !e.busy)) this.pump()
  }

  private indexOf(driverIndex: number): number {
    let index = this.indexes.get(driverIndex)
    if (index === undefined) {
      index = this.state.items.length
      this.indexes.set(driverIndex, index)
    }
    return index
  }

  private queue(events: GuiEvent[]): void {
    this.pending.push(...events)
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.deps.batchMs ?? 16)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const events = newestLive(this.pending)
    this.pending = []
    const owner = this.liveOwner()
    if (events.length > 0 && owner) owner.send(GUI_IPC.events, { sessionId: this.id, events })
  }

  /** The state to draw now; what was waiting to be sent is in it. */
  snapshot(): GuiState {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = []
    return this.state
  }

  claim(owner: O): GuiState {
    this.owner = owner
    // A title that came while no window owned the session (reload, window closed) went nowhere: the new owner gets it.
    if (this.title) this.status([{ type: 'agent-title', title: this.title }])
    return this.snapshot()
  }

  release(owner: O): void {
    if (this.owner === owner) this.owner = null
  }

  private async sendNow(text: string, attachments: readonly string[]): Promise<boolean> {
    this.emit([{ type: 'busy', busy: true }])
    if (this.synthStatus) this.status(this.tracker.sent(text))
    const ok = await this.driver.send(text, attachments).catch(() => false)
    if (!ok && !this.exited) this.emit([{ type: 'busy', busy: false }])
    return ok
  }

  private enqueue(text: string, attachments: readonly string[]): void {
    const id = `q${++this.queuedSeq}`
    if (attachments.length > 0) this.attachments.set(id, [...attachments])
    this.emit([{ type: 'queued', queued: [...this.state.queued, { id, text }] }])
  }

  /** The next queued message, once the turn is over. */
  private pump(): void {
    if (!this.ready || this.exited || this.state.busy || this.state.queued.length === 0) return
    const [next, ...rest] = this.state.queued
    const attachments = this.attachments.get(next!.id) ?? []
    this.attachments.delete(next!.id)
    this.emit([{ type: 'queued', queued: rest }])
    void this.sendNow(next!.text, attachments)
  }

  async send(text: string, attachments: readonly string[]): Promise<GuiSendResult> {
    if (this.exited) return { ok: false, reason: this.state.failure ?? '智能体已经退出了' }
    if (!this.ready || this.state.busy || this.state.queued.length > 0) {
      this.enqueue(text, attachments)
      return { ok: true, queued: true }
    }
    return (await this.sendNow(text, attachments)) ? { ok: true, queued: false } : { ok: false, reason: '没能发给智能体' }
  }

  editQueued(queuedId: string, text: string): boolean {
    if (!this.state.queued.some((q) => q.id === queuedId)) return false
    if (!text.trim()) {
      this.attachments.delete(queuedId)
      this.emit([{ type: 'queued', queued: this.state.queued.filter((q) => q.id !== queuedId) }])
    } else this.emit([{ type: 'queued', queued: this.state.queued.map((q) => (q.id === queuedId ? { ...q, text } : q)) }])
    return true
  }

  answer(answer: GuiAnswer): boolean {
    return !this.exited && this.driver.answer(answer)
  }

  interrupt(): boolean {
    return !this.exited && this.driver.interrupt()
  }

  setConfig(optionId: string, value: string): Promise<boolean> {
    return this.exited ? Promise.resolve(false) : this.driver.setConfig(optionId, value).catch(() => false)
  }

  private fail(reason: string): void {
    if (this.exited) return
    this.stopped = true
    this.deps.link().kill(this.id)
    this.end(reason)
  }

  private onExit(exit: PipeExit): void {
    if (this.stopped || this.exited) return
    this.end(exitReason(exit, this.binary))
  }

  private end(reason: string): void {
    this.exited = true
    this.driver?.closed()
    this.emit([{ type: 'live', live: null }, { type: 'busy', busy: false }, { type: 'failure', failure: reason }])
    this.status(this.tracker.exit())
    this.flush()
    this.deps.ended(this.id, this.launch.agent)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.driver?.closed()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.deps.link().kill(this.id)
    if (!this.exited) {
      this.exited = true
      this.deps.ended(this.id, this.launch.agent)
    }
  }
}

/**
 * A batch with only its last `live` event: each one is the whole streamed text so far and nothing else reads it, so the
 * folded state is the same, and a long answer no longer crosses IPC once per delta.
 */
function newestLive(events: GuiEvent[]): GuiEvent[] {
  let last = -1
  for (let i = events.length - 1; i >= 0 && last < 0; i--) if (events[i]!.type === 'live') last = i
  return last < 0 ? events : events.filter((event, i) => event.type !== 'live' || i === last)
}

function parseLine(line: string): Record<string, unknown> | null {
  // A login shell's rc files may print to stdout before the agent starts.
  if (!line.startsWith('{')) return null
  try {
    const value: unknown = JSON.parse(line)
    return isRec(value) ? value : null
  } catch {
    return null
  }
}

/** The model chosen in the session now (it may differ from the one it was launched with): a restart keeps it. */
function currentModel(state: GuiState): { model?: string } {
  const model = state.config.find((o) => o.category === 'model')?.current
  return model ? { model } : {}
}

export class GuiHost<O extends GuiOwner> {
  private readonly sessions = new Map<string, GuiSession<O>>()

  constructor(private readonly deps: GuiHostDeps<O>) {}

  /** Starts the agent if it is not running (or reattaches to it); the caller becomes the session's owner. */
  async open(launch: GuiLaunch, owner: O): Promise<GuiOpenResult> {
    const existing = this.sessions.get(launch.sessionId)
    if (existing && !existing.exited) return { ok: true, state: existing.claim(owner) }
    // Ended (exit, failure): a new process continues the same conversation.
    const resume = existing?.agentSessionId ?? launch.resumeAgentSessionId
    if (existing) existing.stop()
    const session = new GuiSession({ ...launch, ...(resume ? { resumeAgentSessionId: resume } : {}) }, owner, this.deps, this.relaunchOf(launch.sessionId))
    this.sessions.set(launch.sessionId, session)
    const result = await session.begin(resume)
    if (!result.ok && this.sessions.get(launch.sessionId) === session) this.sessions.delete(launch.sessionId)
    return result
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** The window a GUI session belongs to (dispatch, remote and IPC ownership checks). */
  ownerOf(sessionId: string): O | null {
    const owner = this.sessions.get(sessionId)?.owner
    return owner && !owner.isDestroyed() ? owner : null
  }

  send(sessionId: string, message: { text: string; attachments: readonly string[] }): Promise<GuiSendResult> {
    const session = this.sessions.get(sessionId)
    return session ? session.send(message.text, message.attachments) : Promise.resolve({ ok: false, reason: '会话不存在' })
  }

  answer(sessionId: string, answer: GuiAnswer): boolean {
    return this.sessions.get(sessionId)?.answer(answer) ?? false
  }

  interrupt(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.interrupt() ?? false
  }

  setConfig(sessionId: string, optionId: string, value: string): Promise<boolean> {
    return this.sessions.get(sessionId)?.setConfig(optionId, value) ?? Promise.resolve(false)
  }

  editQueued(sessionId: string, queuedId: string, text: string): boolean {
    return this.sessions.get(sessionId)?.editQueued(queuedId, text) ?? false
  }

  /**
   * Asks again from the earlier prompt `messageId` (PRD F23 编辑, Figma 54C): the agent is restarted on the
   * conversation before it (Claude `--resume-session-at`; a new conversation for the first message) and `text` goes as
   * its first message. Files the agent changed stay as they are.
   */
  async edit(sessionId: string, messageId: string, text: string): Promise<GuiOpenResult> {
    const session = this.sessions.get(sessionId)
    if (!session || session.exited || !guiCanEdit(session.launch.agent)) return { ok: false, reason: '这个会话不能改之前的消息' }
    const { state, launch } = session
    if (state.busy || state.prompts.length > 0 || state.queued.length > 0) return { ok: false, reason: '先停止这一轮再改' }
    const index = state.items.findIndex((item) => item.kind === 'user' && item.id === messageId)
    const owner = session.owner
    if (index < 0 || !owner) return { ok: false, reason: '找不到这条消息' }
    const agentSessionId = session.agentSessionId
    const at = agentSessionId ? await this.deps.resumePoint(launch.agent, launch.cwd, agentSessionId, messageId).catch(() => undefined) : null
    if (at === undefined) return { ok: false, reason: '对话记录里找不到这条消息' }
    if (this.sessions.get(sessionId) !== session || session.state.busy) return { ok: false, reason: '先停止这一轮再改' }
    const next: GuiLaunch = { ...launch, ...currentModel(state), initialPrompt: text }
    delete next.resumeAgentSessionId
    delete next.resumeAt
    if (at && agentSessionId) Object.assign(next, { resumeAgentSessionId: agentSessionId, resumeAt: at })
    // The pipe host drops a killed session at once (messages are handled in order): `begin` starts a new process.
    this.sessions.delete(sessionId)
    session.stop()
    const replacement = new GuiSession(next, owner, this.deps, this.relaunchOf(sessionId), state.items.slice(0, index))
    this.sessions.set(sessionId, replacement)
    const result = await replacement.begin(next.resumeAgentSessionId)
    if (!result.ok && this.sessions.get(sessionId) === replacement) this.sessions.delete(sessionId)
    return result
  }

  private relaunchOf(sessionId: string) {
    return (change: { permission: GuiPermission; plan: boolean }) => this.relaunch(sessionId, change)
  }

  /**
   * Restarts the agent on its conversation with another launch-argument permission or 计划 (Figma 56, Grok): not while
   * a turn runs or something waits. The new process replays the conversation (ACP `session/load`).
   */
  private async relaunch(sessionId: string, change: { permission: GuiPermission; plan: boolean }): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    const owner = session?.owner
    const agentSessionId = session?.agentSessionId
    if (!session || session.exited || !owner || !agentSessionId) return false
    const { state, launch } = session
    if (state.busy || state.prompts.length > 0 || state.queued.length > 0) return false
    const next: GuiLaunch = { ...launch, ...currentModel(state), permission: change.permission, plan: change.plan, resumeAgentSessionId: agentSessionId }
    delete next.initialPrompt
    delete next.resumeAt
    this.sessions.delete(sessionId)
    session.stop()
    const replacement = new GuiSession(next, owner, this.deps, this.relaunchOf(sessionId), [])
    this.sessions.set(sessionId, replacement)
    const result = await replacement.begin(agentSessionId)
    if (!result.ok) {
      if (this.sessions.get(sessionId) === replacement) this.sessions.delete(sessionId)
      // The chat was cleared for the replay: say why it stays empty.
      if (!owner.isDestroyed()) owner.send(GUI_IPC.events, { sessionId, events: [{ type: 'failure', failure: result.reason }] })
    }
    return result.ok
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    session.stop()
  }

  /**
   * Ends a session's process, also one this host never opened (an earlier app run started it and the pty daemon kept
   * it): that one is killed in the pipe host once the host lists it as a pipe session (a `kill` of a terminal's id would
   * end the terminal).
   */
  async end(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) return this.stop(sessionId)
    const listed = await this.deps
      .link()
      .list()
      .catch(() => [])
    if (listed.some((s) => s.id === sessionId) && !this.sessions.has(sessionId)) this.deps.link().kill(sessionId)
  }

  /** A window is gone: its sessions keep running for the next `open` (a reload, or the next app run with the daemon). */
  release(owner: O): void {
    for (const session of this.sessions.values()) session.release(owner)
  }

  /** Every session's id (to end the in-process ones when the app quits). */
  ids(): string[] {
    return [...this.sessions.keys()]
  }

  state(sessionId: string): GuiState | null {
    return this.sessions.get(sessionId)?.state ?? null
  }
}
