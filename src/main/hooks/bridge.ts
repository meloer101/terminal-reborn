// Turns hook requests into renderer-facing signals (AgentEvent, PendingPrompt, PromptResolution) and
// holds PermissionRequests until they are answered. Electron-free: the glue in ./index.ts supplies
// the emitter, so this is unit-tested with a fake one.
import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentEventEnvelope, HookAgent, PendingPrompt, PermissionDecision, PromptResolution } from '@shared/agent-events'
import { describeAllowAlways, type AllowAlwaysScope } from '@shared/permission-scope'
import { sameContext, type ContextUsage, type MetaReading, type VendorUsage } from '@shared/session-meta'
import { applyTodoTool, sameTodos, type TodoItem } from '@shared/todo-progress'
import type { AgentTitleWatcher } from './agent-title'
import { normalizeHook } from './normalize'
import { PermissionRegistry, type Scheduler } from './permission-registry'
import { UnknownSessionError, type HookRequest } from './server'

export interface BridgeEmitter {
  event(envelope: AgentEventEnvelope): void
  prompt(prompt: PendingPrompt): void
  resolved(resolution: PromptResolution): void
  /** False when nobody could answer a prompt for this session (window closed): don't hold the agent. */
  canDeliver(sessionId: string): boolean
  /** Plan usage from any session: account-level, for every window (PRD F11). */
  usage?(usage: VendorUsage): void
}

/** What the session last reported about its context window and todo list; only changes are emitted. */
interface SessionMeta {
  context: ContextUsage | null
  todos: TodoItem[]
  /** False once the agent said it is off the vendor's plan (AgentEvent `billing`); its plan usage is then not ours. */
  plan: boolean
}

type QuestionPrompt = Extract<PendingPrompt, { kind: 'question' }>

/** resources/hooks/agent-shim.sh reports this through the hook relay when the agent it started has exited. */
export const AGENT_EXIT_EVENT = 'AgentExit'
/** resources/hooks/tr-hook.sh reports this right before Claude's SessionStart: `{"plan": boolean}`. */
export const AGENT_BILLING_EVENT = 'AgentBilling'

/** Something that follows a session's hook traffic until the session ends. */
interface HookObserver {
  observe(sessionId: string, agent: HookAgent, event: string, payload: unknown): void
  forget(sessionId: string): void
}

export class HookBridge {
  private readonly sessions = new Set<string>()
  private readonly questions = new Map<string, QuestionPrompt>()
  private readonly meta = new Map<string, SessionMeta>()
  /** Which agent last spoke for a session (metrics replayed on reattach carry it). */
  private readonly agents = new Map<string, HookAgent>()
  private readonly registry: PermissionRegistry

  constructor(
    private readonly emitter: BridgeEmitter,
    private readonly options: {
      now?: () => number
      scheduler?: Scheduler
      permissionTimeoutMs?: number
      /**
       * Hold PermissionRequests for an in-app answer (PRD F3). Off in the app since 2026-10-16: the terminal
       * is the whole UI, so the request is only announced (status "等你处理") and answered in the TUI.
       */
      holdPermissions?: boolean
      /** Follows hook traffic to report the agent's own session title (./agent-title.ts). */
      titles?: Pick<AgentTitleWatcher, 'observe' | 'forget'>
      /** Follows Codex hooks to read context and plan usage from its rollout (./codex-usage.ts). */
      rollouts?: HookObserver
      /** Follows every agent's transcript for context history and token spend (./transcript-meter.ts). */
      transcripts?: HookObserver
    } = {}
  ) {
    this.registry = new PermissionRegistry((resolution) => emitter.resolved(resolution), options.scheduler, options.permissionTimeoutMs)
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  /** Only sessions the app spawned may report; this is what makes a foreign hook caller a 404. */
  attach(sessionId: string, options: { adopt?: boolean } = {}): void {
    // A re-spawned id starts clean: whatever the previous process had pending is gone. A window that reattached to
    // the same process (reload, app restart with the daemon) keeps its metrics and gets them again.
    const meta = options.adopt ? this.meta.get(sessionId) : undefined
    this.detach(sessionId)
    this.sessions.add(sessionId)
    if (!meta) return
    this.meta.set(sessionId, meta)
    const agent: HookAgent = this.agents.get(sessionId) ?? 'claude'
    const at = this.now()
    if (meta.context) this.emitMeta(sessionId, agent, at, { type: 'context', context: meta.context })
    if (meta.todos.length > 0) this.emitMeta(sessionId, agent, at, { type: 'todos', items: meta.todos })
    if (!meta.plan) this.emitMeta(sessionId, agent, at, { type: 'billing', plan: false })
  }

  /** False while the session's agent is off its vendor's plan (a third-party endpoint): its spend is not the account's. */
  usesPlan(sessionId: string): boolean {
    return this.meta.get(sessionId)?.plan ?? true
  }

  /** The session's PTY ended: release every hold and withdraw its prompts. */
  detach(sessionId: string): void {
    this.registry.resolveSession(sessionId, 'session-ended')
    this.resolveQuestion(sessionId, 'session-ended')
    this.options.titles?.forget(sessionId)
    this.options.rollouts?.forget(sessionId)
    this.options.transcripts?.forget(sessionId)
    this.meta.delete(sessionId)
    this.agents.delete(sessionId)
    this.sessions.delete(sessionId)
  }

  /** A reading taken outside a hook call (Codex's rollout, read after its hooks). */
  applyReading(sessionId: string, agent: HookAgent, reading: MetaReading): void {
    if (!this.sessions.has(sessionId)) return
    const at = this.now()
    if (reading.plan !== undefined) this.setPlan(sessionId, agent, at, reading.plan)
    if (reading.context !== undefined) this.setContext(sessionId, agent, at, reading.context)
    if (reading.usage && this.usesPlan(sessionId)) this.emitter.usage?.(reading.usage)
  }

  private metaOf(sessionId: string): SessionMeta {
    let meta = this.meta.get(sessionId)
    if (!meta) {
      meta = { context: null, todos: [], plan: true }
      this.meta.set(sessionId, meta)
    }
    return meta
  }

  private emitMeta(sessionId: string, agent: HookAgent, at: number, event: AgentEvent): void {
    this.emitter.event({ sessionId, agent, at, event })
  }

  /** The statusLine runs every second or two while a turn runs: only a different reading crosses IPC. */
  private setContext(sessionId: string, agent: HookAgent, at: number, context: ContextUsage | null): void {
    const meta = this.metaOf(sessionId)
    if (context === null ? meta.context === null : meta.context !== null && sameContext(meta.context, context)) return
    meta.context = context
    this.emitMeta(sessionId, agent, at, { type: 'context', context })
  }

  private setPlan(sessionId: string, agent: HookAgent, at: number, plan: boolean): void {
    const meta = this.metaOf(sessionId)
    if (meta.plan === plan) return
    meta.plan = plan
    this.emitMeta(sessionId, agent, at, { type: 'billing', plan })
  }

  private setTodos(sessionId: string, agent: HookAgent, at: number, todos: TodoItem[]): void {
    const meta = this.metaOf(sessionId)
    if (sameTodos(meta.todos, todos)) return
    meta.todos = todos
    this.emitMeta(sessionId, agent, at, { type: 'todos', items: todos })
  }

  /** Answers a permission prompt in the UI. Returns false for unknown / already-resolved ids. */
  respondPermission(promptId: string, decision: PermissionDecision): boolean {
    return this.registry.respond(promptId, decision)
  }

  sessionOfPrompt(promptId: string): string | undefined {
    return this.registry.sessionOf(promptId)
  }

  get pendingPermissions(): number {
    return this.registry.size
  }

  private resolveQuestion(sessionId: string, by: PromptResolution['by']): void {
    const question = this.questions.get(sessionId)
    if (!question) return
    this.questions.delete(sessionId)
    this.emitter.resolved({ id: question.id, sessionId, by })
  }

  /** The handler behind the hook socket; its return value is the hook's stdout. */
  async handle(request: HookRequest): Promise<string> {
    const { sessionId, agent, event } = request
    if (!this.sessions.has(sessionId)) throw new UnknownSessionError(sessionId)

    this.options.titles?.observe(sessionId, agent, event, request.payload)
    this.options.rollouts?.observe(sessionId, agent, event, request.payload)
    this.options.transcripts?.observe(sessionId, agent, event, request.payload)
    this.agents.set(sessionId, agent)
    const at = request.receivedAt ?? this.now()
    // Sent by the shim after an agent started by hand in a plain terminal ended (Codex has no SessionEnd of its own).
    if (event === AGENT_EXIT_EVENT) {
      this.setTodos(sessionId, agent, at, [])
      this.setContext(sessionId, agent, at, null)
      this.metaOf(sessionId).plan = true
      this.emitter.event({ sessionId, agent, at, event: { type: 'agent-exit' } })
      return ''
    }
    if (event === AGENT_BILLING_EVENT) {
      const plan = (request.payload as { plan?: unknown } | undefined)?.plan
      if (typeof plan === 'boolean') this.setPlan(sessionId, agent, at, plan)
      return ''
    }
    const normalized = normalizeHook(agent, event, request.payload, at)
    for (const e of normalized.events) {
      if (e.type === 'context') this.setContext(sessionId, agent, at, e.context)
      else this.emitter.event({ sessionId, agent, at, event: e })
    }
    if (normalized.cleared) {
      this.setTodos(sessionId, agent, at, [])
      this.setContext(sessionId, agent, at, null)
    }
    if (normalized.todoCall) {
      const { tool, input, response } = normalized.todoCall
      const next = applyTodoTool(this.metaOf(sessionId).todos, tool, input, response)
      if (next) this.setTodos(sessionId, agent, at, next)
    }
    if (normalized.usage && this.usesPlan(sessionId)) this.emitter.usage?.(normalized.usage)

    // The user answered in the TUI (or the turn moved on): withdraw what we were still showing.
    if (normalized.clears === 'all') {
      this.registry.resolveSession(sessionId, 'terminal')
      this.resolveQuestion(sessionId, 'terminal')
    } else if (normalized.clears === 'tool') {
      const end = normalized.events.find((e) => e.type === 'tool-end')
      if (end?.type === 'tool-end') {
        this.registry.resolveSession(sessionId, 'terminal', { name: end.tool, input: end.input })
        if (end.tool === 'AskUserQuestion') this.resolveQuestion(sessionId, 'terminal')
      }
    }

    if (normalized.questions) {
      this.resolveQuestion(sessionId, 'terminal')
      const prompt: QuestionPrompt = { kind: 'question', id: randomUUID(), sessionId, questions: normalized.questions, createdAt: at }
      this.questions.set(sessionId, prompt)
      this.emitter.prompt(prompt)
    }

    if (normalized.permission && this.emitter.canDeliver(sessionId)) {
      const draft = normalized.permission
      const prompt: PendingPrompt = {
        kind: 'permission',
        id: randomUUID(),
        sessionId,
        tool: draft.tool,
        input: draft.input,
        summary: draft.summary,
        canAllowAlways: draft.suggestions.length > 0,
        ...allowAlwaysField(draft.suggestions),
        createdAt: at
      }
      if (this.options.holdPermissions === false) {
        // Announce only; an empty body leaves the decision to the TUI's own dialog right away.
        this.emitter.prompt(prompt)
        return ''
      }
      return new Promise<string>((resolve) => {
        this.registry.add({ prompt, suggestions: draft.suggestions, agent, release: resolve })
        // Claude gave up on the hook (it is exiting): nothing is waiting for an answer any more.
        request.signal.addEventListener('abort', () => this.registry.cancel(prompt.id, 'terminal'), { once: true })
        this.emitter.prompt(prompt)
      })
    }
    return ''
  }
}

function allowAlwaysField(suggestions: unknown[]): { allowAlways?: AllowAlwaysScope } {
  const scope = describeAllowAlways(suggestions)
  return scope ? { allowAlways: scope } : {}
}
