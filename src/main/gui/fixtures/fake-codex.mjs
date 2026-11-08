// A stand-in for `codex app-server` (PRD §6.17, the sequences of scripts/spikes/54-gui-codex-app-server-lab.mjs) for
// the GUI host's tests: no model, no tokens. Every turn runs `ls` after a command approval; "slow" streams until
// `turn/interrupt`; "fail" ends the turn failed.
const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`)
let threadId = null
let turnN = 0
let current = null
let serverId = 100
const waiting = new Map()

function startTurn(id, params) {
  const turnId = `turn-${++turnN}`
  const text = params.input.find((i) => i.type === 'text')?.text ?? ''
  out({ id, result: { turn: { id: turnId, status: 'inProgress' } } })
  out({ method: 'turn/started', params: { threadId, turn: { id: turnId } } })
  out({ method: 'item/completed', params: { item: { type: 'userMessage', id: `u${turnN}`, content: params.input } } })
  current = { turnId, model: params.model ?? null, effort: params.effort ?? null, approvalPolicy: params.approvalPolicy ?? null, approvalsReviewer: params.approvalsReviewer ?? null }
  // Codex's app-server names no thread itself; a client's `thread/name/set` (or another thread's) does.
  if (text.includes('name me')) out({ method: 'thread/name/updated', params: { threadId: 'thr-other', threadName: 'Not this one' } })
  if (text.includes('name me')) out({ method: 'thread/name/updated', params: { threadId, threadName: 'Fake\nthread   name' } })
  out({ method: 'item/agentMessage/delta', params: { itemId: `m${turnN}`, delta: 'Work' } })
  out({ method: 'item/agentMessage/delta', params: { itemId: `m${turnN}`, delta: 'ing' } })
  if (text.includes('slow')) return
  if (text.includes('fail')) {
    out({ method: 'turn/completed', params: { turn: { id: turnId, status: 'failed', error: { message: 'quota exceeded' } } } })
    current = null
    return
  }
  out({ method: 'item/started', params: { item: { type: 'commandExecution', id: `c${turnN}`, command: 'ls', status: 'inProgress' } } })
  const rid = serverId++
  waiting.set(rid, (result) => {
    out({ method: 'serverRequest/resolved', params: { requestId: rid } })
    const ok = result.decision === 'accept' || result.decision === 'acceptForSession'
    out({ method: 'item/completed', params: { item: { type: 'commandExecution', id: `c${turnN}`, command: 'ls', status: ok ? 'completed' : 'declined', exitCode: ok ? 0 : null, aggregatedOutput: ok ? 'a.txt\n' : '' } } })
    out({ method: 'item/completed', params: { item: { type: 'agentMessage', id: `m${turnN}`, text: `Done (${JSON.stringify(current)})` } } })
    out({ method: 'turn/completed', params: { turn: { id: turnId, status: 'completed' } } })
    current = null
  })
  out({ id: rid, method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: `c${turnN}`, command: 'ls', cwd: '/', availableDecisions: ['accept', 'acceptForSession', 'decline'] } })
}

function request(m) {
  switch (m.method) {
    case 'initialize':
      return out({ id: m.id, result: { userAgent: 'fake-codex/0.0', clientName: m.params.clientInfo.name } })
    case 'model/list':
      return out({
        id: m.id,
        result: {
          data: [
            { id: 'gpt-a', displayName: 'GPT A', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'low' },
            { id: 'gpt-b', displayName: 'GPT B', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium' }
          ]
        }
      })
    case 'thread/start':
      threadId = 'thr-new'
      return out({ id: m.id, result: { thread: { id: threadId, cwd: m.params.cwd }, approvalPolicy: m.params.approvalPolicy, sandbox: m.params.sandbox } })
    case 'thread/resume':
      threadId = m.params.threadId
      return out({ id: m.id, result: { thread: { id: threadId, name: threadId === 'thr-named' ? 'Named earlier' : null } } })
    case 'turn/start':
      return startTurn(m.id, m.params)
    case 'turn/interrupt':
      out({ id: m.id, result: {} })
      if (current && current.turnId === m.params.turnId) {
        out({ method: 'turn/completed', params: { turn: { id: current.turnId, status: 'interrupted' } } })
        current = null
      }
      return
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
    if (m.method && m.id !== undefined) request(m)
    else if (m.id !== undefined && waiting.has(m.id)) {
      const done = waiting.get(m.id)
      waiting.delete(m.id)
      done(m.result)
    }
  }
})
process.stdin.on('end', () => process.exit(0))
