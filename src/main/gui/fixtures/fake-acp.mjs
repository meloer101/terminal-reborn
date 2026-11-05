// A stand-in for an ACP agent (`grok agent stdio`, `cursor-agent acp`; PRD §6.17 and
// scripts/spikes/55-gui-acp-handshake-lab.mjs) for the GUI host's tests: no model, no tokens. Each prompt streams two
// chunks, runs a tool after a permission request and ends with `end_turn`; "fs" first asks to read a file (Wavi must
// refuse); "slow" runs until `session/cancel`.
const out = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
const update = (sessionId, u) => out({ method: 'session/update', params: { sessionId, update: u } })
let n = 0
let sessionId = null
let prompt = null
let model = 'm1'
const waiting = new Map()
const configOptions = () => [
  { id: 'model', type: 'select', category: 'model', name: 'Model', currentValue: model, options: [{ value: 'm1', name: 'M1' }, { value: 'm2', name: 'M2' }] }
]

function ask(method, params, then) {
  const id = 1000 + ++n
  waiting.set(id, then)
  out({ id, method, params })
}

function runPrompt(id, params) {
  const text = params.prompt.find((b) => b.type === 'text')?.text ?? ''
  prompt = { id }
  const go = () => {
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi ' } })
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `there (${model})` } })
    if (text.includes('slow')) return
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call1', title: 'ls', kind: 'execute', status: 'pending' })
    ask('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 'call1', title: 'ls', kind: 'execute' },
      options: [
        { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' }
      ]
    }, (m) => {
      const allowed = m.result?.outcome?.optionId === 'yes'
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call1', status: allowed ? 'completed' : 'failed', content: [{ type: 'content', content: { type: 'text', text: allowed ? 'a.txt' : 'denied' } }] })
      out({ id, result: { stopReason: 'end_turn' } })
      prompt = null
    })
  }
  if (text.includes('fs')) {
    ask('fs/read_text_file', { sessionId, path: '/etc/hosts' }, (m) => {
      update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: m.error ? `fs refused ${m.error.code}. ` : 'fs read. ' } })
      go()
    })
  } else go()
}

function request(m) {
  switch (m.method) {
    case 'initialize':
      return out({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: false } }, authMethods: [] } })
    case 'session/new':
      sessionId = 'acp-session-1'
      out({ id: m.id, result: { sessionId, configOptions: configOptions() } })
      return update(sessionId, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'plan', description: 'Make a plan', input: { hint: 'what' } }] })
    case 'session/load':
      sessionId = m.params.sessionId
      update(sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'earlier question' } })
      update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'earlier answer' } })
      return out({ id: m.id, result: { configOptions: configOptions() } })
    case 'session/set_config_option':
      model = m.params.value
      return out({ id: m.id, result: { configOptions: configOptions() } })
    case 'session/prompt':
      return runPrompt(m.id, m.params)
    default:
      return out({ id: m.id, error: { code: -32601, message: `unknown ${m.method}` } })
  }
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const m = JSON.parse(line)
    if (m.method === 'session/cancel') {
      if (prompt) out({ id: prompt.id, result: { stopReason: 'cancelled' } })
      prompt = null
    } else if (m.method && m.id !== undefined) request(m)
    else if (m.id !== undefined && waiting.has(m.id)) {
      const then = waiting.get(m.id)
      waiting.delete(m.id)
      then(m)
    }
  }
})
process.stdin.on('end', () => process.exit(0))
