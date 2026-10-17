/* eslint-disable no-undef */
// Hooks spike (PRD §6.6): run the real Claude CLI in /tmp/tr-hooks-lab with hooks injected
// per launch via `--settings`, a capture server on a Unix socket, and the production hook script.
//   node scripts/spikes/30-hooks-lab.mjs <scenario>
// Scenarios: ok | bash-empty | bash-allow | bash-hold | ask | tool-fail | ...  (see SCENARIOS)
// Output: JSONL of every hook call in $LAB_LOG (default /tmp/tr-hooks-lab-out/<scenario>.jsonl) and the final screen.
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch, show, sleep } from './harness.mjs'

const LAB = '/tmp/tr-hooks-lab'
const OUT = process.env.LAB_OUT ?? '/tmp/tr-hooks-lab-out'
const SCRIPT = resolve(import.meta.dirname, '../../resources/hooks/tr-hook.sh')
const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd'
]

const scenario = process.argv[2] ?? 'ok'
mkdirSync(OUT, { recursive: true })
const logFile = process.env.LAB_LOG ?? join(OUT, `${scenario}.jsonl`)
rmSync(logFile, { force: true })
const dir = mkdtempSync(join(tmpdir(), 'trh-'))
const sock = join(dir, 'h.sock')
const token = 'spike-token'
const t0 = Date.now()

// How the capture server answers PermissionRequest: 'empty' | 'allow' | 'deny' | 'hold' (never) | 'allow-after:<ms>'
let permMode = process.env.PERM_MODE ?? 'empty'
const held = []
const log = (rec) => appendFileSync(logFile, JSON.stringify({ t: Date.now() - t0, ...rec }) + '\n')

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const url = new URL(req.url, 'http://tr')
    if (req.headers['x-tr-token'] !== token) {
      res.statusCode = 403
      return res.end()
    }
    const event = url.pathname.split('/').pop()
    let body = {}
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      /* keep {} */
    }
    log({ dir: 'in', event, session: url.searchParams.get('session'), body })
    if (event !== 'PermissionRequest') return res.end()
    const decide = (behavior, extra = {}) => {
      const out = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior, ...extra } } }
      log({ dir: 'out', event, out })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(out))
    }
    if (permMode === 'empty') return res.end()
    if (permMode === 'allow') return decide('allow')
    if (permMode === 'deny') return decide('deny', { message: 'Denied from the spike' })
    if (permMode.startsWith('allow-after:')) return void setTimeout(() => decide('allow'), Number(permMode.split(':')[1]))
    if (permMode === 'allow-always') {
      const s = body.permission_suggestions
      return decide('allow', s ? { updatedPermissions: s } : {})
    }
    res.on('close', () => log({ dir: 'conn-closed', event, writableEnded: res.writableEnded }))
    held.push({ res, decide, body })
  })
})
await new Promise((r) => server.listen(sock, r))

const hookCmd = (e) => `/bin/sh '${SCRIPT}' ${e}`
const settings = {
  hooks: Object.fromEntries(
    EVENTS.map((e) => [e, [{ hooks: [{ type: 'command', command: hookCmd(e), ...(e === 'PermissionRequest' ? { timeout: 130 } : { timeout: 10 }) }] }]])
  )
}
const settingsFile = join(dir, 'settings.json')
writeFileSync(settingsFile, JSON.stringify(settings, null, 2))

const extraArgs = (process.env.CLAUDE_ARGS ?? '').split(' ').filter(Boolean)
const debugFile = join(OUT, `${scenario}.debug.log`)
const c = launch('claude', ['--settings', settingsFile, '--debug-file', debugFile, ...extraArgs], {
  cwd: LAB,
  env: { TR_SESSION_ID: 'lab-1', TR_HOOK_SOCK: sock, TR_HOOK_TOKEN: token }
})

async function ready() {
  const trust = await c.waitFor(/trust this folder/, 8000)
  if (trust >= 0) {
    console.log('trust dialog shown; accepting (adds the lab dir to ~/.claude.json)')
    await sleep(2500) // keys sent shortly after the dialog first renders are ignored
    c.write('\x1b[B')
    await sleep(400)
    c.write('\r')
  }
  const ms = await c.waitFor(/\? for shortcuts|Try "|bypass/, 30000)
  console.log('ready after ms:', ms)
  await sleep(1500)
}

let stopBase = 0
const countStops = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter((l) => l.includes('"event":"Stop"')).length : 0)
const prompt = async (text) => {
  stopBase = countStops()
  c.write('\x1b[200~' + text + '\x1b[201~')
  await sleep(150)
  c.write('\r')
  log({ dir: 'sent', text })
}
const waitStop = async (ms = 90000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (countStops() > stopBase) return true
    await sleep(200)
  }
  return false
}

const SCENARIOS = {
  // one trivial turn
  async ok() {
    await prompt('Reply with only the word OK.')
    console.log('stop seen:', await waitStop())
  },
  // a Bash call that needs permission; server answers per PERM_MODE
  async bash() {
    await prompt(process.env.PROMPT ?? 'Use the Bash tool to run exactly: echo hooks-lab-ran > /tmp/tr-hooks-lab/ran.txt   Then reply DONE.')
    const t = Date.now()
    while (!held.length && Date.now() - t < 60000) await sleep(100)
    console.log('permission request held after ms:', Date.now() - t, 'held:', held.length)
    await sleep(Number(process.env.OBSERVE_MS ?? 2500))
    show('screen while permission pending', c.visible())
    log({ dir: 'screen', screen: c.visible() })
    const act = process.env.ACT ?? 'hook-allow'
    log({ dir: 'act', act })
    if (act === 'tui-yes') c.write('1')
    else if (act === 'tui-no') c.write('4')
    else if (act === 'empty-then-tui') {
      held.splice(0).forEach((h) => h.res.end())
      await sleep(2500)
      show('screen after empty reply', c.visible())
      c.write('1')
    }
    else if (act === 'hook-deny') held.splice(0).forEach((h) => h.decide('deny', { message: 'Denied from the spike' }))
    else if (act === 'hook-allow-always') held.splice(0).forEach((h) => h.decide('allow', { updatedPermissions: h.body.permission_suggestions }))
    else held.splice(0).forEach((h) => h.decide('allow'))
    await sleep(2500)
    show('screen after act', c.visible())
    log({ dir: 'screen', screen: c.visible() })
    console.log('stop seen:', await waitStop(60000))
  },
  async ask() {
    await prompt('Use the AskUserQuestion tool to ask me which of two options I prefer: A or B (header "Pick"). Then reply with my choice.')
    await sleep(8000)
    show('screen', c.visible())
    log({ dir: 'screen', screen: c.visible() })
    log({ dir: 'held-at-ask', n: held.length })
    held.splice(0).forEach((h) => h.res.end())
    await sleep(500)
    c.write('1')
    console.log('stop seen:', await waitStop())
  },
  async fail() {
    await prompt('Use the Bash tool to run exactly: ls /tmp/tr-hooks-lab/does-not-exist   Then reply DONE.')
    await sleep(8000)
    show('screen', c.visible())
    if (held.length) held.splice(0).forEach((h) => h.decide('allow'))
    console.log('stop seen:', await waitStop())
  },
  // "allow always": answer the first request with its own suggestions, then see whether a similar command asks again
  async always() {
    await prompt('Use the Bash tool to run exactly: mkdir -p /tmp/tr-hooks-lab/always1   Then reply DONE.')
    const t = Date.now()
    while (!held.length && Date.now() - t < 60000) await sleep(100)
    log({ dir: 'suggestions', s: held[0]?.body.permission_suggestions })
    held.splice(0).forEach((h) => h.decide('allow', h.body.permission_suggestions ? { updatedPermissions: h.body.permission_suggestions } : {}))
    await waitStop()
    log({ dir: 'second-prompt' })
    await prompt('Use the Bash tool to run exactly: mkdir -p /tmp/tr-hooks-lab/always2   Then reply DONE.')
    await sleep(25000)
    log({ dir: 'held-after-second', n: held.length })
    show('screen', c.visible())
    held.splice(0).forEach((h) => h.decide('allow'))
    await waitStop(30000)
  },
  async startup() {
    await sleep(4000)
  },
  async idle() {
    await prompt('Reply with only the word OK.')
    await waitStop()
    console.log('waiting 70 s for an idle notification…')
    await sleep(70000)
  }
}

try {
  await ready()
  await (SCENARIOS[scenario] ?? SCENARIOS.ok)()
  await sleep(1500)
  show('final screen', c.visible())
  c.write('\x03')
  await sleep(300)
  c.write('\x03')
  await sleep(2500)
} finally {
  c.kill()
  await sleep(500)
  server.close()
  rmSync(dir, { recursive: true, force: true })
  console.log('log:', logFile, 'debug:', existsSync(debugFile) ? debugFile : '(none)')
}
process.exit(0)
