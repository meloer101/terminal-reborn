/* eslint-disable no-undef */
// GUI sessions over ACP (PRD F23): the handshake an installed agent gives, without sending a prompt (no tokens):
// `initialize` (protocol version, agent capabilities, auth methods), then `session/new` (modes, models, config
// options) and the `session/update` notifications that follow (available commands). Prints keys and names only.
//   usage: node scripts/spikes/55-gui-acp-handshake-lab.mjs <scratch folder> <command> [args...]
//   e.g.:  … /tmp/acp grok agent stdio      … /tmp/acp cursor-agent acp
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const [cwd, cmd, ...args] = process.argv.slice(2)
if (!cwd || !cmd) throw new Error('usage: 55-gui-acp-handshake-lab.mjs <scratch folder> <command> [args...]')
mkdirSync(cwd, { recursive: true })
const keep = ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TERM']
const env = Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]))
const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
let stderr = ''
child.stderr.on('data', (d) => (stderr += d))
const pending = new Map()
const updates = []
const serverRequests = []
let buf = ''
child.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let m
    try {
      m = JSON.parse(line)
    } catch {
      continue
    }
    if (m.id !== undefined && !m.method && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    } else if (m.method === 'session/update') {
      const u = m.params?.update ?? {}
      updates.push({ kind: u.sessionUpdate, keys: Object.keys(u), commands: u.availableCommands?.map((c) => c.name) })
    } else if (m.method) serverRequests.push(m.method)
  }
})
let n = 0
const request = (method, params, timeoutMs = 20000) =>
  new Promise((resolve) => {
    const id = ++n
    const timer = setTimeout(() => resolve({ error: 'timeout' }), timeoutMs)
    pending.set(id, (m) => {
      clearTimeout(timer)
      resolve(m)
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })

const out = { command: [cmd, ...args].join(' ') }
const init = await request('initialize', {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: 'wavi', title: 'Wavi', version: '0.0.0-lab' }
})
const r = init.result ?? {}
out.initialize = {
  error: init.error ?? null,
  protocolVersion: r.protocolVersion,
  agentInfo: r.agentInfo,
  agentCapabilities: r.agentCapabilities,
  authMethods: r.authMethods?.map((a) => a.id)
}
const s = await request('session/new', { cwd, mcpServers: [] })
const sr = s.result ?? {}
out.sessionNew = {
  error: s.error ?? null,
  keys: Object.keys(sr),
  modes: sr.modes ? { current: sr.modes.currentModeId, available: sr.modes.availableModes?.map((m) => m.id) } : null,
  models: sr.models ? { current: sr.models.currentModelId, available: sr.models.availableModels?.map((m) => m.modelId).slice(0, 12) } : null,
  configOptions: sr.configOptions?.map((o) => ({ id: o.id, type: o.type, category: o.category, values: o.options?.map((v) => v.value ?? v.id).slice(0, 8) }))
}
await new Promise((res) => setTimeout(res, 2500))
out.updates = updates
out.serverRequests = serverRequests
child.kill()
out.stderrTail = stderr.slice(-300)
console.log(JSON.stringify(out, null, 2))
