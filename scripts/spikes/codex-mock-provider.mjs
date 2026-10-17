/* eslint-disable no-undef */
// A tiny local "Responses API" for driving the REAL Codex CLI without a working model provider
// (PRD §6.7: the user's provider answered 503 for every model). Codex is pointed at it per
// launch with -c (nothing is written to ~/.codex); the model's behaviour is scripted from the prompt:
//   "RUN: <shell command>"  -> the model calls the shell tool once with that command, then says DONE
//   "REPLY: <text>"         -> the model answers <text>
//   "CALL: <tool> <json>"   -> the model calls <tool> (function or custom/freeform) with that input, then says DONE
//   "HANG: ..."             -> the response stream never finishes (a busy turn until the user interrupts)
//   anything else           -> "OK"
// Only the CLI side is real (TUI, sandbox/approval logic, hooks); the model is fake.
import { createServer } from 'node:http'

let counter = 0
const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)

function lastUserText(input) {
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i]
    if (item.type === 'message' && item.role === 'user') {
      const text = (item.content ?? []).map((c) => c.text ?? '').join('')
      // Skip injected context blocks (environment, AGENTS.md, …).
      if (/^(RUN|REPLY):|\S/.test(text) && !text.startsWith('<')) return text
    }
  }
  return ''
}

export async function startMockProvider({ onRequest } = {}) {
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = req.url ?? ''
      if (req.method === 'GET' && url.includes('/models')) {
        res.setHeader('content-type', 'application/json')
        return res.end(JSON.stringify({ data: [], models: [] }))
      }
      if (req.method !== 'POST' || !url.includes('/responses')) {
        res.statusCode = 404
        return res.end()
      }
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        /* keep {} */
      }
      const input = Array.isArray(body.input) ? body.input : []
      const tools = (body.tools ?? []).map((t) => t.name ?? t.type)
      onRequest?.({ tools, input, body })
      if (process.env.MOCK_DUMP_TOOLS) console.error(JSON.stringify((body.tools ?? []).map((t) => ({ name: t.name, type: t.type }))))
      const id = `resp_${++counter}`
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      sse(res, 'response.created', { response: { id } })

      const last = input[input.length - 1]
      const afterTool = last && (last.type === 'function_call_output' || last.type === 'custom_tool_call_output')
      const prompt = lastUserText(input)
      const shellTool = tools.find((n) => n === 'exec_command') ?? tools.find((n) => n === 'shell_command') ?? tools.find((n) => n === 'shell')
      const run = /^RUN:\s*([\s\S]+)$/.exec(prompt)

      if (/^HANG:/.test(prompt) && !afterTool) return // keep the SSE stream open
      const call = /^CALL:\s*(\S+)\s+([\s\S]+)$/.exec(prompt)

      if (call && !afterTool) {
        const def = (body.tools ?? []).find((t) => (t.name ?? t.type) === call[1])
        const custom = def?.type === 'custom'
        const item = custom
          ? { type: 'custom_tool_call', call_id: `call_${counter}`, name: call[1], input: call[2] }
          : { type: 'function_call', call_id: `call_${counter}`, name: call[1], arguments: call[2] }
        sse(res, 'response.output_item.added', { output_index: 0, item })
        sse(res, 'response.output_item.done', { output_index: 0, item })
      } else if (run && !afterTool && shellTool) {
        const command = run[1].trim()
        const args =
          shellTool === 'exec_command'
            ? { cmd: command, yield_time_ms: 1000 }
            : shellTool === 'shell_command'
              ? { command, workdir: process.env.MOCK_WORKDIR }
              : { command: ['bash', '-lc', command] }
        const item = { type: 'function_call', call_id: `call_${counter}`, name: shellTool, arguments: JSON.stringify(args) }
        sse(res, 'response.output_item.added', { output_index: 0, item })
        sse(res, 'response.output_item.done', { output_index: 0, item })
      } else {
        const text = afterTool ? 'DONE' : (/^REPLY:\s*([\s\S]+)$/.exec(prompt)?.[1] ?? 'OK')
        const itemId = `msg_${counter}`
        const message = { type: 'message', role: 'assistant', id: itemId, content: [{ type: 'output_text', text }] }
        sse(res, 'response.output_item.added', { output_index: 0, item: { ...message, content: [] } })
        sse(res, 'response.output_text.delta', { item_id: itemId, output_index: 0, content_index: 0, delta: text })
        sse(res, 'response.output_item.done', { output_index: 0, item: message })
      }
      sse(res, 'response.completed', {
        response: { id, usage: { input_tokens: 10, input_tokens_details: null, output_tokens: 5, output_tokens_details: null, total_tokens: 15 } }
      })
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    port,
    /** `-c` overrides that point Codex at this server for one launch. */
    config: [
      `model_provider="mock"`,
      `model_providers.mock={name="mock",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false}`
    ],
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve)))
  }
}
