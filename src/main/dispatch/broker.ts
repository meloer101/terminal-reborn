// Between an agent's dispatch tool call (arriving on the hook socket, PRD F21) and the window that owns its session:
// each call gets an id, goes to that window, and its answer is held until the MCP server collects it. A hook request
// must be answered within the daemon's relay timeout (10 s), so a call that waits for the user is answered "not yet"
// and polled. No Electron here (index.ts wires it), so the timing is testable.
import { randomBytes } from 'node:crypto'
import {
  isDispatchToolName,
  parseHello,
  parseToolResult,
  toolFail,
  type DispatchAgent,
  type DispatchCallReply,
  type DispatchHello,
  type DispatchRequest,
  type DispatchToolResult
} from '@shared/dispatch'

/** Events the MCP server posts to the hook socket (resources never send these). */
export const DISPATCH_EVENTS = ['WaviHello', 'WaviCall', 'WaviPoll'] as const
export const isDispatchEvent = (event: string): boolean => (DISPATCH_EVENTS as readonly string[]).includes(event)

/** How long one hook request may hold before answering "not yet" (under the daemon's 10 s relay timeout). */
export const HOLD_MS = 7_000
const HELLO_MS = 5_000
/** An answer nobody collected is dropped after this. */
const KEEP_MS = 20 * 60_000

export interface Inbox {
  socket: string
  token: string
}

interface Call<O> {
  owner: O
  sessionId: string
  result: DispatchToolResult | null
  waiters: Array<() => void>
  at: number
}

export interface BrokerOptions<O> {
  /** The window that owns the session; null when no window shows it (the call then reports Wavi unavailable). */
  ownerOf: (sessionId: string) => O | null
  send: (owner: O, request: DispatchRequest) => void
  now?: () => number
  holdMs?: number
}

const INBOX_TOKEN = /^[A-Za-z0-9._~+/=-]{1,512}$/

export class DispatchBroker<O> {
  private readonly calls = new Map<string, Call<O>>()
  private readonly hellos = new Map<string, { owner: O; resolve: (hello: DispatchHello | null) => void }>()
  private readonly inboxes = new Map<string, Inbox>()
  private readonly now: () => number
  private readonly holdMs: number

  constructor(private readonly options: BrokerOptions<O>) {
    this.now = options.now ?? Date.now
    this.holdMs = options.holdMs ?? HOLD_MS
  }

  /** Claude's cross-session inbox of this session, as its MCP server reported it. */
  inboxOf(sessionId: string): Inbox | undefined {
    return this.inboxes.get(sessionId)
  }

  /** One hook-socket request; resolves to the response body ('' = nobody to answer). */
  async handle(event: string, sessionId: string, agent: DispatchAgent, payload: unknown): Promise<string> {
    this.prune()
    const body = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    if (event === 'WaviHello') return this.hello(sessionId, agent, body)
    if (event === 'WaviCall') return this.call(sessionId, agent, body)
    if (event === 'WaviPoll') return this.poll(sessionId, body)
    return ''
  }

  /** The window's answer to a request it was sent; ignored unless it comes from the window that was asked. */
  answer(owner: O, callId: string, raw: unknown): void {
    const hello = this.hellos.get(callId)
    if (hello) {
      if (hello.owner !== owner) return
      this.hellos.delete(callId)
      hello.resolve(parseHello(raw))
      return
    }
    const call = this.calls.get(callId)
    if (!call || call.owner !== owner || call.result) return
    call.result = parseToolResult(raw) ?? toolFail('failed', 'Wavi gave an answer it could not read.')
    for (const wake of call.waiters.splice(0)) wake()
  }

  private async hello(sessionId: string, agent: DispatchAgent, body: Record<string, unknown>): Promise<string> {
    const inbox = body.inbox as Partial<Inbox> | undefined
    if (inbox && typeof inbox.socket === 'string' && inbox.socket.startsWith('/') && inbox.socket.length < 1024 && typeof inbox.token === 'string' && INBOX_TOKEN.test(inbox.token)) {
      this.inboxes.set(sessionId, { socket: inbox.socket, token: inbox.token })
    }
    const owner = this.options.ownerOf(sessionId)
    if (owner === null) return ''
    const callId = newId()
    const hello = await new Promise<DispatchHello | null>((resolve) => {
      const timer = setTimeout(() => {
        this.hellos.delete(callId)
        resolve(null)
      }, HELLO_MS)
      this.hellos.set(callId, {
        owner,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        }
      })
      this.options.send(owner, { callId, sessionId, agent, tool: 'hello', args: {} })
    })
    return hello ? JSON.stringify(hello) : ''
  }

  private async call(sessionId: string, agent: DispatchAgent, body: Record<string, unknown>): Promise<string> {
    const tool = body.tool
    if (!isDispatchToolName(tool)) return reply({ done: true, result: toolFail('invalid_request', `Unknown tool: ${String(tool)}`) })
    const owner = this.options.ownerOf(sessionId)
    if (owner === null) return ''
    const callId = newId()
    const call: Call<O> = { owner, sessionId, result: null, waiters: [], at: this.now() }
    this.calls.set(callId, call)
    this.options.send(owner, { callId, sessionId, agent, tool, args: body.args ?? {} })
    return this.settle(callId, call)
  }

  private async poll(sessionId: string, body: Record<string, unknown>): Promise<string> {
    const callId = typeof body.callId === 'string' ? body.callId : ''
    const call = this.calls.get(callId)
    // Only the session that made the call may collect it.
    if (!call || call.sessionId !== sessionId) return reply({ done: true, result: toolFail('failed', 'Wavi lost this call (it may have restarted). Try again.') })
    return this.settle(callId, call)
  }

  private async settle(callId: string, call: Call<O>): Promise<string> {
    if (!call.result) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.holdMs)
        call.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    if (!call.result) return reply({ done: false, callId })
    this.calls.delete(callId)
    return reply({ done: true, result: call.result })
  }

  private prune(): void {
    const now = this.now()
    for (const [id, call] of this.calls) if (now - call.at > KEEP_MS) this.calls.delete(id)
  }
}

const reply = (value: DispatchCallReply): string => JSON.stringify(value)
const newId = (): string => randomBytes(12).toString('hex')
