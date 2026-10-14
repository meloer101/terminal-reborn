/* eslint-disable no-undef, no-control-regex */
// Codex hooks spike (docs/spikes/codex.md): run the real Codex CLI in /tmp/tr-codex-lab with hooks injected
// per launch (`-c hooks.<Event>=[…]` + `-c hooks.state=…trusted_hash`), a capture server on a Unix socket and the
// production relay script. Nothing is written to ~/.codex.
//   node scripts/spikes/41-codex-hooks-lab.mjs <scenario>
// Env: PERM_MODE=empty|allow|deny|hold  ACT=hook-allow|hook-deny|tui-yes|tui-no|tui-esc|…  CODEX_ARGS="-a on-request -s read-only"
// Output: JSONL of every hook call in /tmp/tr-codex-lab-out/<scenario>.jsonl, OSC/title sequences, screens.
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startMockProvider } from './codex-mock-provider.mjs'
import { launch, show, sleep } from './harness.mjs'

const LAB_RAW = '/tmp/tr-codex-lab'
const OUT = process.env.LAB_OUT ?? '/tmp/tr-codex-lab-out'
const SCRIPT = resolve(import.meta.dirname, '../../resources/hooks/tr-hook.sh')
// Events 0.142.5 knows about (hooks/list enum); unknown names in `-c` are silently ignored.
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop']

const scenario = process.argv[2] ?? 'ok'
mkdirSync(OUT, { recursive: true })
mkdirSync(LAB_RAW, { recursive: true })
if (!existsSync(join(LAB_RAW, '.git'))) {
  execFileSync('git', ['init', '-q'], { cwd: LAB_RAW })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: LAB_RAW })
}
const LAB = realpathSync(LAB_RAW)
const logFile = join(OUT, `${scenario}.jsonl`)
rmSync(logFile, { force: true })
const dir = mkdtempSync(join(tmpdir(), 'trc-'))
const sock = join(dir, 'h.sock')
const token = 'spike-token'
const t0 = Date.now()
const permMode = process.env.PERM_MODE ?? 'empty'
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
    log({ dir: 'in', event, agent: url.searchParams.get('agent'), body })
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
    res.on('close', () => log({ dir: 'conn-closed', event, writableEnded: res.writableEnded }))
    held.push({ res, decide, body })
  })
})
await new Promise((r) => server.listen(sock, r))

const tomlString = (v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const hookOverrides = EVENTS.map((e) => {
  const command = `/bin/sh '${SCRIPT}' ${e} codex`
  return `hooks.${e}=[{hooks=[{type="command",command=${tomlString(command)},timeout=${e === 'PermissionRequest' ? 130 : 10}}]}]`
})
// MOCK=1: a scripted local model (the real provider answers 503); prompts "RUN: <cmd>" / "REPLY: <text>".
const mock = process.env.MOCK ? await startMockProvider({ onRequest: (r) => log({ dir: 'model-request', tools: r.tools, lastInput: r.input.slice(-2) }) }) : null
const base = ['-c', 'check_for_update_on_startup=false', ...(mock ? mock.config.flatMap((o) => ['-c', o]) : []), '-c', `projects={"${LAB}"={trust_level="trusted"}}`]
const flags = [...base, ...hookOverrides.flatMap((o) => ['-c', o])]

// Ask Codex itself for the hash of every hook definition, then pin exactly those hashes for this launch.
function probeHashes() {
  const r = spawnSync('node', [resolve(import.meta.dirname, '40-codex-hooks-list.mjs'), ...flags], { encoding: 'utf8', env: { ...process.env, LAB } })
  const json = JSON.parse(r.stdout)
  const mine = json.data[0].hooks.filter((h) => h.source === 'sessionFlags')
  return Object.fromEntries(mine.map((h) => [h.key, h.currentHash]))
}
const t1 = Date.now()
const hashes = process.env.NO_TRUST ? {} : probeHashes()
log({ dir: 'probe', ms: Date.now() - t1, keys: Object.keys(hashes) })
const state = `hooks.state={${Object.entries(hashes)
  .map(([k, h]) => `${tomlString(k)}={trusted_hash=${tomlString(h)}}`)
  .join(',')}}`
const args = [...flags, ...(Object.keys(hashes).length ? ['-c', state] : []), ...(process.env.CODEX_ARGS ?? '').split(' ').filter(Boolean)]
log({ dir: 'argv', args })

const c = launch('codex', args, { cwd: LAB, env: { TR_SESSION_ID: 'lab-1', TR_HOOK_SOCK: sock, TR_HOOK_TOKEN: token } })

const count = (event) => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter((l) => l.includes(`"event":"${event}"`) && l.includes('"dir":"in"')).length : 0)
let stopBase = 0
const prompt = async (text) => {
  stopBase = count('Stop')
  c.write('\x1b[200~' + text + '\x1b[201~')
  await sleep(250)
  c.write('\r')
  log({ dir: 'sent', text })
}
const waitStop = async (ms = 90000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (count('Stop') > stopBase) return true
    await sleep(200)
  }
  return false
}
const waitHeld = async (ms = 60000) => {
  const t = Date.now()
  while (!held.length && Date.now() - t < ms) await sleep(100)
  return held.length > 0
}
const snap = (label) => {
  const s = c.visible()
  show(label, s)
  log({ dir: 'screen', label, screen: s })
}

const SCENARIOS = {
  async startup() {
    await sleep(3000)
  },
  // Slash command output, no model turn: SLASH="/model" (or /hooks, /status, …).
  async slash() {
    c.write('/')
    await sleep(200)
    c.write('\x1b[200~' + (process.env.SLASH ?? '/model').slice(1) + '\x1b[201~')
    await sleep(400)
    c.write('\r')
    await sleep(Number(process.env.OBSERVE_MS ?? 3000))
    snap('slash result')
    c.write('\x1b')
    await sleep(500)
  },
  async ok() {
    await prompt('Reply with only the word OK.')
    console.log('stop seen:', await waitStop())
  },
  // A write that read-only + on-request must ask about; the capture server answers per PERM_MODE / ACT.
  async approve() {
    if (process.env.PRE_SLASH) {
      for (let i = 0; i < 100 && /MCP servers|Working/.test(c.visible()); i++) await sleep(100)
      c.write('/')
      await sleep(200)
      c.write('\x1b[200~' + process.env.PRE_SLASH.slice(1) + '\x1b[201~')
      await sleep(400)
      c.write('\r')
      await sleep(2000)
    }
    await prompt((process.env.PROMPT_FILE ? readFileSync(process.env.PROMPT_FILE, 'utf8').trim() : null) ?? process.env.PROMPT ?? (mock ? 'RUN: echo codex-lab-ran > /tmp/tr-codex-lab/ran.txt' : 'Use the shell tool to run exactly: echo codex-lab-ran > /tmp/tr-codex-lab/ran.txt   Then reply DONE.'))
    const got = await waitHeld()
    console.log('permission request seen:', got || count('PermissionRequest') > 0)
    await sleep(Number(process.env.OBSERVE_MS ?? 3000))
    snap('screen while approval pending')
    const act = process.env.ACT ?? 'hook-allow'
    log({ dir: 'act', act })
    const keys = { 'tui-yes': '1', 'tui-always': '2', 'tui-no': '3', 'tui-esc': '\x1b', 'tui-enter': '\r', 'tui-y': 'y', 'tui-n': 'n' }
    if (act.startsWith('keys:')) c.write(JSON.parse(act.slice(5)))
    else if (keys[act]) c.write(keys[act])
    else if (act === 'hook-deny') held.splice(0).forEach((h) => h.decide('deny', { message: 'Denied from the spike' }))
    else if (act.startsWith('empty-then:')) {
      // Release our hold with an empty body so Codex shows its own dialog, then type the given key(s) (JSON string).
      held.splice(0).forEach((h) => h.res.end())
      await sleep(2500)
      snap('codex dialog')
      c.write(JSON.parse(act.slice('empty-then:'.length)))
    } else if (act === 'release-empty') held.splice(0).forEach((h) => h.res.end())
    else if (act === 'none') {
      /* leave everything pending */
    } else held.splice(0).forEach((h) => h.decide('allow'))
    await sleep(3000)
    snap('screen after act')
    console.log('stop seen:', await waitStop(Number(process.env.STOP_WAIT ?? 60000)))
  },
  // Ctrl+C on an empty prompt (docs/spikes/codex.md Q6): does one press quit Codex?
  async ctrlc() {
    for (let i = 0; i < 100 && /MCP servers/.test(c.visible()); i++) await sleep(100)
    c.write('\x03')
    await sleep(1200)
    snap('after 1st Ctrl+C (exited=' + JSON.stringify(c.exited) + ')')
    if (!c.exited) {
      await sleep(3500)
      snap('3.5 s later (exited=' + JSON.stringify(c.exited) + ')')
      c.write('\x03')
      await sleep(1200)
      snap('after 2nd Ctrl+C (exited=' + JSON.stringify(c.exited) + ')')
    }
  },
  // Ctrl+C or Esc while a turn is running: STOP_KEY="\u0003" (default Esc).
  async busykey() {
    await prompt('HANG: busy')
    await sleep(5000)
    snap('busy')
    c.write(JSON.parse(process.env.STOP_KEY ?? '"\\u001b"'))
    await sleep(2500)
    snap('after key (exited=' + JSON.stringify(c.exited) + ')')
  },
  async interrupt() {
    await prompt(mock ? 'RUN: sleep 40' : 'Use the shell tool to run exactly: sleep 40   Then reply DONE.')
    await sleep(Number(process.env.OBSERVE_MS ?? 7000))
    snap('busy screen')
    held.splice(0).forEach((h) => h.decide('allow'))
    await sleep(4000)
    log({ dir: 'act', act: 'esc' })
    c.write('\x1b')
    await sleep(3000)
    snap('after esc')
  }
}

try {
  const up = await c.waitFor(/›/, 25000)
  console.log('prompt visible after ms:', up)
  await sleep(2500)
  snap('startup screen')
  await (SCENARIOS[scenario] ?? SCENARIOS.ok)()
  await sleep(1500)
  snap('final screen')
  // OSC 0/2 titles and anything private (7501) the TUI emitted.
  const osc = []
  const rawText = c.raw.map(([, d]) => d).join('')
  for (const m of rawText.matchAll(/\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)/g)) osc.push(`${m[1]};${JSON.stringify(m[2])}`)
  // Title timeline: [ms since launch, title] for every OSC 0/2, spinner frames collapsed to "⠿".
  const timeline = []
  for (const [t, d] of c.raw) {
    for (const m of d.matchAll(/\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g)) {
      const title = m[1].replace(/^[⠀-⣿]/, '⠿')
      if (timeline.at(-1)?.[1] !== title) timeline.push([t, title])
    }
  }
  log({ dir: 'title-timeline', timeline })
  const uniq = [...new Set(osc)]
  console.log('OSC sequences (unique, in order of first appearance):', uniq.length)
  for (const o of uniq.slice(0, 60)) console.log('  ', o)
  log({ dir: 'osc', uniq })
  c.write('\x03')
  await sleep(500)
  c.write('\x03')
  await sleep(2000)
} finally {
  c.kill()
  await sleep(300)
  server.close()
  await mock?.close()
  rmSync(dir, { recursive: true, force: true })
  console.log('log:', logFile)
}
process.exit(0)
