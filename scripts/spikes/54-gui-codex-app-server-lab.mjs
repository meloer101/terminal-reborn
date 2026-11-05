/* eslint-disable no-undef */
// GUI sessions (PRD F23): what `codex app-server` gives a GUI. One app-server over stdio (newline-delimited JSON-RPC):
// initialize, model/list, thread/start, a plain turn with agentMessage deltas, a command approval accepted, a file
// change approval declined, turn/steer while a turn runs, turn/interrupt. Prints methods, timings and keys only.
//   usage: node scripts/spikes/54-gui-codex-app-server-lab.mjs <empty scratch folder> [model]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.argv[2]
const model = process.argv[3] ?? null
if (!cwd) throw new Error('usage: 54-gui-codex-app-server-lab.mjs <scratch folder>')
mkdirSync(cwd, { recursive: true })
const keep = ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TERM']
const env = Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]))
const child = spawn('codex', ['-c', 'check_for_update_on_startup=false', 'app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
const t0 = Date.now()
const ms = () => Date.now() - t0
let stderr = ''
child.stderr.on('data', (d) => (stderr += d))

const pending = new Map()
const listeners = new Set()
let buf = ''
child.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const m = JSON.parse(line)
    if (m.id !== undefined && !m.method && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
      continue
    }
    for (const l of [...listeners]) l(m)
  }
})
let n = 0
const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`)
const request = (method, params) =>
  new Promise((resolve) => {
    const id = ++n
    pending.set(id, resolve)
    send({ id, method, params })
  })
const respond = (id, result) => send({ id, result })
const text = (t) => [{ type: 'text', text: t, text_elements: [] }]

function turn(label, start, { onServerRequest, onFirstDelta, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const s = { label, startAt: ms(), methods: {}, serverRequests: [], firstDeltaMs: null, items: {}, completed: null, agentText: '' }
    let first = false
    const timer = setTimeout(() => done('timeout'), timeoutMs)
    const done = (why) => {
      clearTimeout(timer)
      listeners.delete(l)
      s.end = why
      s.durationMs = ms() - s.startAt
      s.agentText = s.agentText.slice(0, 200)
      resolve(s)
    }
    const l = (m) => {
      s.methods[m.method] = (s.methods[m.method] ?? 0) + 1
      if (m.method === 'turn/started') s.turnId = m.params?.turn?.id
      if (m.method === 'item/agentMessage/delta') {
        s.agentText += m.params?.delta ?? ''
        if (!first) {
          first = true
          s.firstDeltaMs = ms() - s.startAt
          onFirstDelta?.(s)
        }
      }
      if (m.method === 'item/started' || m.method === 'item/completed') {
        const t = m.params?.item?.type
        s.items[`${m.method.split('/')[1]}:${t}`] = (s.items[`${m.method.split('/')[1]}:${t}`] ?? 0) + 1
        if (m.method === 'item/completed' && (t === 'commandExecution' || t === 'fileChange')) s[`${t}Keys`] = Object.keys(m.params.item)
      }
      if (m.id !== undefined && m.method) {
        s.serverRequests.push({ method: m.method, keys: Object.keys(m.params ?? {}) })
        onServerRequest?.(m)
      }
      if (m.method === 'turn/completed') {
        s.completed = { status: m.params?.turn?.status, keys: Object.keys(m.params?.turn ?? {}) }
        done('completed')
      }
      if (m.method === 'error') s.error = JSON.stringify(m.params).slice(0, 300)
    }
    listeners.add(l)
    start(s)
  })
}

const out = {}
const init = await request('initialize', { clientInfo: { name: 'wavi', title: 'Wavi', version: '0.0.0-lab' }, capabilities: null })
out.initialize = { ok: !!init.result, keys: Object.keys(init.result ?? {}), error: init.error }
send({ method: 'initialized' })
const models = await request('model/list', {})
out.models = models.result?.data?.map((m) => m.id ?? m.model) ?? models.error
out.modelKeys = Object.keys(models.result?.data?.[0] ?? {})
const thread = await request('thread/start', { cwd, model, approvalPolicy: 'untrusted', sandbox: 'workspace-write' })
out.thread = { ok: !!thread.result, keys: Object.keys(thread.result ?? {}), error: thread.error }
const threadId = thread.result?.thread?.id
out.threadKeys = Object.keys(thread.result?.thread ?? {})

out.plain = await turn('plain', () => request('turn/start', { threadId, input: text('Reply with exactly the word: pong') }))

out.command = await turn('command approval accepted', () => request('turn/start', { threadId, input: text('Run the shell command `echo lab > a.txt` and then say done.') }), {
  onServerRequest: (m) => respond(m.id, { decision: 'accept' })
})
out.aTxt = existsSync(join(cwd, 'a.txt'))

out.declined = await turn('approval declined', () => request('turn/start', { threadId, input: text('Create a file b.txt containing hi. If you are not allowed, stop and say refused.') }), {
  onServerRequest: (m) => respond(m.id, { decision: 'decline' })
})
out.bTxt = existsSync(join(cwd, 'b.txt'))

out.steer = await turn('steer', () => request('turn/start', { threadId, input: text('Count from 1 to 30, one number per line, nothing else.') }), {
  onFirstDelta: (s) =>
    void request('turn/steer', { threadId, expectedTurnId: s.turnId, input: text('After that, also write the word done on its own line.') }).then((r) => (out.steerAck = r.error ?? 'ok')),
  timeoutMs: 90000
})

out.interrupt = await turn('interrupt', () => request('turn/start', { threadId, input: text('Write a 300-word story about a lighthouse.') }), {
  onFirstDelta: (s) => setTimeout(() => void request('turn/interrupt', { threadId, turnId: s.turnId }).then((r) => (out.interruptAck = r.error ?? 'ok')), 300),
  timeoutMs: 60000
})

child.stdin.end()
child.kill()
out.stderrTail = stderr.slice(-400)
console.log(JSON.stringify(out, null, 2))
