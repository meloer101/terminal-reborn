// Wavi's dispatch tools as a stdio MCP server (PRD F21, §6.14). Each agent launches its own copy (Claude through
// `--mcp-config`, Codex through `-c mcp_servers.wavi.*`), run by Wavi's own binary with ELECTRON_RUN_AS_NODE. It holds
// no state: every call is relayed over the hook socket the agent already has (TR_HOOK_SOCK / TR_HOOK_TOKEN /
// TR_SESSION_ID), through the pty daemon when it serves that socket, to the window that owns the session. The process
// lives as long as the agent, so it outlives app restarts; while no window is attached a call says so instead of
// hanging. Requests are short (the daemon answers a relayed hook within 10 s): a call that waits for the user is
// polled, with progress notifications so the agent's MCP client keeps waiting.
//
// Plain JSON-RPC over newline-delimited stdio, no SDK: only initialize, tools/list, tools/call and ping are needed.
import { request } from 'node:http'
import { createInterface } from 'node:readline'
import {
  DISPATCH_INSTRUCTIONS,
  dispatchToolDefs,
  isDispatchAgent,
  isDispatchToolName,
  type DispatchAgent,
  type DispatchCallReply,
  type DispatchHello,
  type DispatchToolResult
} from '@shared/dispatch'

const VERSION = '1'
/** A call that waits for the user (start_sessions) gives up after this; Wavi's own timeout answers first. */
const CALL_DEADLINE_MS = 15 * 60_000
const POLL_PAUSE_MS = 250

const env = process.env
const agentArg = process.argv[process.argv.indexOf('--agent') + 1]
const agent: DispatchAgent = isDispatchAgent(agentArg) ? agentArg : 'claude'

type Json = Record<string, unknown>

function send(message: Json): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

/** POSTs one hook-socket request; null when Wavi is not there to answer (no socket, no window, empty reply). */
function relay(event: string, body: Json, timeoutMs = 12_000): Promise<unknown> {
  const socketPath = env.TR_HOOK_SOCK
  const token = env.TR_HOOK_TOKEN
  const session = env.TR_SESSION_ID
  if (!socketPath || !token || !session) return Promise.resolve(null)
  const data = JSON.stringify(body)
  return new Promise((resolve) => {
    const req = request(
      {
        socketPath,
        method: 'POST',
        path: `/hook/${event}?session=${encodeURIComponent(session)}&agent=${agent}`,
        headers: { 'X-TR-Token': token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200 || text === '') return resolve(null)
          try {
            resolve(JSON.parse(text) as unknown)
          } catch {
            resolve(null)
          }
        })
        res.on('error', () => resolve(null))
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end(data)
  })
}

const UNAVAILABLE: DispatchToolResult = {
  ok: false,
  failure: 'wavi_unavailable',
  text: 'Wavi is not answering for this session right now (the app may be closed). Try again later, or ask the user.'
}

let hello: Promise<DispatchHello | null> | null = null

/** Asks Wavi once whether this session gets the tools, and tells it how to reach this agent (Claude's inbox). */
function sayHello(): Promise<DispatchHello | null> {
  const inbox =
    env.CLAUDE_CODE_MESSAGING_SOCKET && env.CLAUDE_CODE_MESSAGING_TOKEN
      ? { socket: env.CLAUDE_CODE_MESSAGING_SOCKET, token: env.CLAUDE_CODE_MESSAGING_TOKEN }
      : undefined
  hello ??= relay('WaviHello', inbox ? { inbox } : {}).then((reply) => {
    const v = reply as Partial<DispatchHello> | null
    if (!v || typeof v.tools !== 'boolean' || !Array.isArray(v.agents)) {
      hello = null // ask again next time
      return null
    }
    return { tools: v.tools, agents: v.agents.filter(isDispatchAgent) }
  })
  return hello
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function asReply(value: unknown): DispatchCallReply | null {
  const v = value as Partial<DispatchCallReply> | null
  if (!v || typeof v.done !== 'boolean') return null
  if (v.done) return v.result ? (v as DispatchCallReply) : null
  return typeof (v as { callId?: unknown }).callId === 'string' ? (v as DispatchCallReply) : null
}

async function callTool(name: string, args: unknown, progressToken: unknown): Promise<DispatchToolResult> {
  let reply = asReply(await relay('WaviCall', { tool: name, args: args ?? {} }))
  const started = Date.now()
  let progress = 0
  while (reply && !reply.done) {
    if (Date.now() - started > CALL_DEADLINE_MS) return { ok: false, failure: 'timeout', text: 'Gave up waiting for Wavi.' }
    if (progressToken !== undefined) {
      send({ method: 'notifications/progress', params: { progressToken, progress: ++progress, message: 'Waiting for the user in Wavi…' } })
    }
    await sleep(POLL_PAUSE_MS)
    reply = asReply(await relay('WaviPoll', { callId: reply.callId }))
  }
  return reply?.done ? reply.result : UNAVAILABLE
}

function toolContent(result: DispatchToolResult): Json {
  const text = result.ok ? result.text : `[${result.failure}] ${result.text}`
  return { content: [{ type: 'text', text }], isError: !result.ok }
}

async function handle(message: Json): Promise<void> {
  const { id, method } = message
  const params = (message.params ?? {}) as Json
  const respond = (result: Json) => id !== undefined && send({ id, result })
  switch (method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.protocolVersion) ? params.protocolVersion : '2025-06-18'
      respond({ protocolVersion: asked, capabilities: { tools: {} }, serverInfo: { name: 'wavi', version: VERSION }, instructions: DISPATCH_INSTRUCTIONS })
      void sayHello()
      return
    }
    case 'ping':
      return void respond({})
    case 'tools/list': {
      const info = await sayHello()
      // A dispatched session (or dispatch turned off) gets no tools at all: nothing to tempt it.
      respond({ tools: info && !info.tools ? [] : dispatchToolDefs(info?.agents ?? []) })
      return
    }
    case 'tools/call': {
      const name = params.name
      const meta = (params._meta ?? {}) as Json
      if (!isDispatchToolName(name)) return void (id !== undefined && send({ id, error: { code: -32602, message: `Unknown tool: ${String(name)}` } }))
      respond(toolContent(await callTool(name, params.arguments, meta.progressToken)))
      return
    }
    default:
      if (id !== undefined && typeof method === 'string' && !method.startsWith('notifications/')) {
        send({ id, error: { code: -32601, message: `Method not found: ${method}` } })
      }
  }
}

let inFlight = 0
let closed = false
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  if (line.trim() === '') return
  let message: Json
  try {
    message = JSON.parse(line) as Json
  } catch {
    return send({ id: null, error: { code: -32700, message: 'Parse error' } })
  }
  inFlight++
  void handle(message)
    .catch((error: unknown) => {
      if (message.id !== undefined) send({ id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })
    })
    .finally(() => {
      inFlight--
      if (closed && inFlight === 0) process.exit(0)
    })
})
// The client went away: answer what is in flight, then leave.
lines.on('close', () => {
  closed = true
  if (inFlight === 0) process.exit(0)
})
