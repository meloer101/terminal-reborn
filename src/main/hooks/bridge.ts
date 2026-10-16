// Turns hook requests into renderer-facing signals (AgentEvent, PendingPrompt, PromptResolution) and
// holds PermissionRequests until they are answered. Electron-free: the glue in ./index.ts supplies
// the emitter, so this is unit-tested with a fake one.
import { randomUUID } from 'node:crypto'
import type { AgentEventEnvelope, PendingPrompt, PermissionDecision, PromptResolution } from '@shared/agent-events'
import { describeAllowAlways, type AllowAlwaysScope } from '@shared/permission-scope'
import { normalizeHook } from './normalize'
import { PermissionRegistry, type Scheduler } from './permission-registry'
import { UnknownSessionError, type HookRequest } from './server'

export interface BridgeEmitter {
  event(envelope: AgentEventEnvelope): void
  prompt(prompt: PendingPrompt): void
  resolved(resolution: PromptResolution): void
  /** False when nobody could answer a prompt for this session (window closed): don't hold the agent. */
  canDeliver(sessionId: string): boolean
}

type QuestionPrompt = Extract<PendingPrompt, { kind: 'question' }>

export class HookBridge {
  private readonly sessions = new Set<string>()
  private readonly questions = new Map<string, QuestionPrompt>()
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
    } = {}
  ) {
    this.registry = new PermissionRegistry((resolution) => emitter.resolved(resolution), options.scheduler, options.permissionTimeoutMs)
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  /** Only sessions the app spawned may report; this is what makes a foreign hook caller a 404. */
  attach(sessionId: string): void {
    // A re-spawned id starts clean: whatever the previous process had pending is gone.
    this.detach(sessionId)
    this.sessions.add(sessionId)
  }

  /** The session's PTY ended: release every hold and withdraw its prompts. */
  detach(sessionId: string): void {
    this.registry.resolveSession(sessionId, 'session-ended')
    this.resolveQuestion(sessionId, 'session-ended')
    this.sessions.delete(sessionId)
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

    const normalized = normalizeHook(agent, event, request.payload)
    const at = this.now()
    for (const e of normalized.events) this.emitter.event({ sessionId, agent, at, event: e })

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
