// What a GUI session's protocol driver (claude-driver.ts, codex-driver.ts, acp-driver.ts) gets from the session host
// and offers it (PRD F23). A driver speaks one protocol over the agent's stdio lines; it owns no process. Electron-free.

import { randomInt } from 'node:crypto'
import type { GuiAnswer, GuiEvent, GuiPermission } from '@shared/gui-chat'

export type Rec = Record<string, unknown>
export const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export interface ImageBlock {
  mediaType: string
  /** Base64. */
  data: string
}

export interface DriverIO {
  /** One JSON message to the agent's stdin; false when the process is gone. */
  write(message: Rec): boolean
  emit(events: GuiEvent[]): void
  /** The handshake is done: messages can go to the agent. */
  ready(): void
  /** The agent's conversation id (Claude session id, Codex thread id, ACP session id): the session's agentSessionId. */
  agentSession(id: string): void
  /** A turn ended (status: Stop / StopFailure for the agents without hooks). */
  turnEnd(outcome: { failed: boolean; message?: string }): void
  /** The handshake failed; shown above the composer. */
  fail(reason: string): void
  /** An image attachment's bytes, or null when it is not an image Wavi sends as one (then its path goes in the text). */
  image(path: string): Promise<ImageBlock | null>
  /**
   * A permission level or 计划 that is a launch argument changed (Figma 56): the host restarts the agent on its
   * conversation with them. False when it could not (a turn runs, nothing to resume).
   */
  relaunch(change: { permission: GuiPermission; plan: boolean }): Promise<boolean>
}

export interface DriverOptions {
  cwd: string
  /** Continue this conversation over the protocol (Codex `thread/resume`, ACP `session/load`). */
  resume?: string
  model?: string
  /** Wavi's version, for `clientInfo`. */
  clientVersion: string
  /** A reattach: requests an earlier client already answered; their prompts among the replayed lines are skipped. */
  answered?: ReadonlySet<string>
  /** The permission level and 计划 the agent starts with (Figma 56). */
  permission?: GuiPermission
  plan?: boolean
  /** An ACP agent whose permission mode is a launch argument: which of 自动 / 计划 its arguments offer. */
  launchPermission?: { auto: boolean; plan: boolean }
}

export interface GuiDriver {
  /** A freshly spawned process: run the handshake. */
  start(): void
  /** One parsed stdout line; `replay` while a reattached session's kept lines are read back. */
  line(message: Rec, replay: boolean): void
  /** The kept lines are read: ready when the earlier handshake had finished, else run it now. */
  replayed(): void
  send(text: string, attachments: readonly string[]): Promise<boolean>
  answer(answer: GuiAnswer): boolean
  interrupt(): boolean
  setConfig(id: string, value: string): Promise<boolean>
  /** The process is gone: requests still waiting fail. */
  closed(): void
}

export type RpcOutcome = { ok: true; result: unknown } | { ok: false; code: number; message: string }

/**
 * JSON-RPC requests over stdio lines (Codex app-server omits `jsonrpc`; ACP is JSON-RPC 2.0). Responses to ids this
 * client did not send (a reattached session's earlier requests) are left to the driver.
 *
 * Ids start at a random number per client: a reattached session's new client must not reuse an id the earlier run's
 * client still waits on (its `session/prompt` result would be taken for another request's).
 */
export class RpcClient {
  private next: number
  private readonly pending = new Map<string, (outcome: RpcOutcome) => void>()

  constructor(
    private readonly write: (message: Rec) => boolean,
    private readonly jsonrpc: boolean,
    /** The first id (tests); a random one in [1, 2^47) otherwise, far below Number.MAX_SAFE_INTEGER. */
    firstId: number = randomInt(1, 2 ** 47)
  ) {
    this.next = firstId
  }

  private envelope(body: Rec): Rec {
    return this.jsonrpc ? { jsonrpc: '2.0', ...body } : body
  }

  request(method: string, params: unknown, timeoutMs?: number): Promise<RpcOutcome> {
    const id = this.next++
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined
      const done = (outcome: RpcOutcome) => {
        if (timer) clearTimeout(timer)
        this.pending.delete(String(id))
        resolve(outcome)
      }
      this.pending.set(String(id), done)
      if (timeoutMs) timer = setTimeout(() => done({ ok: false, code: -32000, message: `${method} timed out` }), timeoutMs)
      if (!this.write(this.envelope({ id, method, params }))) done({ ok: false, code: -32000, message: 'the agent is not running' })
    })
  }

  notify(method: string, params?: unknown): boolean {
    return this.write(this.envelope({ method, ...(params !== undefined ? { params } : {}) }))
  }

  respond(id: unknown, result: unknown): boolean {
    return this.write(this.envelope({ id, result }))
  }

  respondError(id: unknown, code: number, message: string): boolean {
    return this.write(this.envelope({ id, error: { code, message } }))
  }

  /** True when the message answered one of our requests (it is then consumed). */
  handle(message: Rec): boolean {
    if (!isResponse(message)) return false
    const resolve = this.pending.get(String(message.id))
    if (!resolve) return false
    if (isRec(message.error)) resolve({ ok: false, code: typeof message.error.code === 'number' ? message.error.code : -32000, message: str(message.error.message) ?? 'error' })
    else resolve({ ok: true, result: message.result })
    return true
  }

  failAll(message: string): void {
    for (const resolve of [...this.pending.values()]) resolve({ ok: false, code: -32000, message })
    this.pending.clear()
  }
}

/** A JSON-RPC response (to anyone's request). */
export const isResponse = (m: Rec): boolean => m.id !== undefined && m.id !== null && m.method === undefined && ('result' in m || 'error' in m)
/** A request from the agent (an approval, a question, fs / terminal). */
export const isServerRequest = (m: Rec): boolean => m.id !== undefined && m.id !== null && typeof m.method === 'string'
