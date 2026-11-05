/* eslint-disable no-undef */
// GUI sessions (PRD F23): what a long-lived headless Claude gives a GUI over its stream-json control protocol.
// One `claude -p` process, labelled CLAUDE_CODE_ENTRYPOINT=wavi, driven through: initialize, a plain turn with
// partial messages, a Write permission allowed and one denied, AskUserQuestion answered through can_use_tool, plan
// mode + ExitPlanMode, set_model, a message sent mid-turn, an interrupt; then which hooks fired and the transcript's
// entrypoint. Prints a summary only (types, timings, keys), no conversation text beyond the short answers.
//   usage: node scripts/spikes/53-gui-claude-stream-lab.mjs <empty scratch folder> [model]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.argv[2]
const model = process.argv[3] ?? 'haiku'
if (!cwd) throw new Error('usage: 53-gui-claude-stream-lab.mjs <scratch folder> [model]')
mkdirSync(cwd, { recursive: true })
const hookLog = join(cwd, 'hooks.log')
writeFileSync(hookLog, '')
const hook = (name) => ({ hooks: [{ type: 'command', command: `echo ${name} >> '${hookLog}'` }] })
const settings = {
  hooks: Object.fromEntries(
    ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop'].map((e) => [e, [hook(e)]])
  )
}

const args = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--replay-user-messages',
  '--permission-prompt-tool', 'stdio',
  '--permission-mode', 'default',
  '--model', model,
  '--settings', JSON.stringify(settings)
]
// A clean environment, as Wavi's login shell gives: a shell started inside another Claude (Desktop, an SDK app)
// carries that host's CLAUDE_CODE_* / ANTHROPIC_BASE_URL, and a child claude then tries the host's auth.
const keep = ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TERM']
const env = { ...Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]])), CLAUDE_CODE_ENTRYPOINT: 'wavi' }
const child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
const t0 = Date.now()
const ms = () => Date.now() - t0
let stderr = ''
child.stderr.on('data', (d) => (stderr += d))

const listeners = new Set()
let buf = ''
const seen = []
child.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    let m
    try {
      m = JSON.parse(line)
    } catch {
      seen.push({ at: ms(), type: 'non-json', text: line.slice(0, 120) })
      continue
    }
    for (const l of [...listeners]) l(m)
  }
})
const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`)
const user = (text) => send({ type: 'user', message: { role: 'user', content: text } })
let reqN = 0
const control = (request) =>
  new Promise((resolve) => {
    const id = `w${++reqN}`
    const l = (m) => {
      if (m.type === 'control_response' && m.response?.request_id === id) {
        listeners.delete(l)
        resolve(m.response)
      }
    }
    listeners.add(l)
    send({ type: 'control_request', request_id: id, request })
  })
const reply = (id, response) => send({ type: 'control_response', response: { subtype: 'success', request_id: id, response } })

/** Runs one turn: collects what arrives until `result`; `onRequest` answers can_use_tool. */
function turn(label, start, { onRequest, onFirstDelta, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const s = { label, startAt: ms(), types: {}, events: {}, firstDeltaMs: null, requests: [], results: [], texts: [] }
    let firstDelta = false
    const timer = setTimeout(() => done('timeout'), timeoutMs)
    const done = (why) => {
      clearTimeout(timer)
      listeners.delete(l)
      s.end = why
      s.durationMs = ms() - s.startAt
      resolve(s)
    }
    const l = (m) => {
      s.types[m.type] = (s.types[m.type] ?? 0) + 1
      if (m.type === 'stream_event') {
        const et = m.event?.type + (m.event?.delta?.type ? `:${m.event.delta.type}` : '')
        s.events[et] = (s.events[et] ?? 0) + 1
        if (!firstDelta && m.event?.delta?.type === 'text_delta') {
          firstDelta = true
          s.firstDeltaMs = ms() - s.startAt
          onFirstDelta?.()
        }
      }
      if (m.type === 'assistant') for (const b of m.message?.content ?? []) if (b.type === 'text') s.texts.push(b.text.slice(0, 160))
      if (m.type === 'control_request') {
        s.requests.push({ subtype: m.request?.subtype, tool: m.request?.tool_name, inputKeys: Object.keys(m.request?.input ?? {}), keys: Object.keys(m.request ?? {}) })
        onRequest?.(m)
      }
      if (m.type === 'system') s.system = { subtype: m.subtype, keys: Object.keys(m) }
      if (m.type === 'rate_limit_event') s.rateLimitKeys = Object.keys(m.rate_limit_info ?? m)
      if (m.type === 'result') {
        s.results.push({ subtype: m.subtype, is_error: m.is_error, num_turns: m.num_turns, keys: Object.keys(m).join(','), session_id: m.session_id })
        if (!s.waitForSecond || s.results.length >= 2) done('result')
      }
    }
    listeners.add(l)
    start(s)
  })
}

const out = {}
const init = await control({ subtype: 'initialize' })
const ir = init.response ?? {}
out.initialize = {
  subtype: init.subtype,
  keys: Object.keys(ir),
  commands: Array.isArray(ir.commands) ? { count: ir.commands.length, sample: ir.commands.slice(0, 6), keys: Object.keys(ir.commands[0] ?? {}) } : ir.commands,
  models: Array.isArray(ir.models) ? ir.models.map((x) => x.value ?? x.id ?? x) : ir.models,
  modelKeys: Array.isArray(ir.models) ? Object.keys(ir.models[0] ?? {}) : null,
  account: ir.account ? Object.keys(ir.account) : null
}

out.plain = await turn('plain', () => user('Reply with exactly the word: pong'))

out.writeAllowed = await turn('write allowed', () => user('Create a file named a.txt containing the word hi, using the Write tool. Do nothing else.'), {
  onRequest: (m) => reply(m.request_id, { behavior: 'allow', updatedInput: m.request.input })
})
out.aTxt = existsSync(join(cwd, 'a.txt'))

out.writeDenied = await turn('write denied', () => user('Create a file named b.txt containing the word hi, using the Write tool. If it is refused, stop and say refused.'), {
  onRequest: (m) => reply(m.request_id, { behavior: 'deny', message: 'Not now (denied from the GUI).' })
})
out.bTxt = existsSync(join(cwd, 'b.txt'))

let question = null
out.ask = await turn(
  'AskUserQuestion',
  () => user('Use the AskUserQuestion tool to ask me one question: which color I prefer, red or blue. Then reply with only the color I picked.'),
  {
    onRequest: (m) => {
      if (m.request.tool_name !== 'AskUserQuestion') return reply(m.request_id, { behavior: 'allow', updatedInput: m.request.input })
      question = m.request.input
      const q = m.request.input.questions?.[0]?.question
      reply(m.request_id, { behavior: 'allow', updatedInput: { ...m.request.input, answers: { [q]: 'Blue' } } })
    }
  }
)
out.askInputKeys = question ? Object.keys(question) : null

out.setPlan = await control({ subtype: 'set_permission_mode', mode: 'plan' })
let plan = null
out.plan = await turn('plan mode', () => user('Make a two-step plan to add a file c.txt with the content x, then present it with ExitPlanMode. Keep it short.'), {
  onRequest: (m) => {
    if (m.request.tool_name === 'ExitPlanMode') plan = { inputKeys: Object.keys(m.request.input ?? {}), suggestions: m.request.permission_suggestions ?? null }
    reply(m.request_id, { behavior: 'deny', message: 'Keep planning later; stop here.' })
  }
})
out.exitPlan = plan
out.setDefault = await control({ subtype: 'set_permission_mode', mode: 'default' })
out.setModel = await control({ subtype: 'set_model', model })

out.midTurn = await turn('message mid-turn', (s) => {
  s.waitForSecond = true
  user('Count from 1 to 30, one number per line, nothing else.')
}, {
  onFirstDelta: () => user('After that, also write the word done on its own line.'),
  timeoutMs: 90000
})

out.interrupt = await turn('interrupt', () => user('Write a 300-word story about a lighthouse.'), {
  onFirstDelta: () => setTimeout(() => void control({ subtype: 'interrupt' }).then((r) => (out.interruptAck = r.subtype)), 300),
  timeoutMs: 60000
})

child.stdin.end()
await new Promise((r) => child.once('close', r))

out.hooksFired = [...new Set(readFileSync(hookLog, 'utf8').split('\n').filter(Boolean))]
const sid = out.plain.results[0]?.session_id
const projDir = join(process.env.HOME, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
const file = sid && existsSync(projDir) ? readdirSync(projDir).find((f) => f.startsWith(sid)) : null
if (file) {
  const entry = readFileSync(join(projDir, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  out.transcript = { entrypoints: [...new Set(entry.map((e) => e.entrypoint).filter(Boolean))], lines: entry.length }
} else out.transcript = { missing: projDir }
out.stderrTail = stderr.slice(-400)
console.log(JSON.stringify(out, null, 2))
