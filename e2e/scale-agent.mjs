#!/usr/bin/env node
// A fake `claude` for the scale and soak runs (e2e/scale.spec.ts, ROADMAP D1). Wavi launches it with its per-launch
// `--settings` file, so its hooks and statusLine travel the real path (hook command → socket → pty daemon → main →
// renderer). It draws like an agent's TUI: a busy title and a spinner line while it works, tool calls, Chinese reply
// text in colors, a permission dialog now and then, the idle footer. It writes a transcript under
// $CLAUDE_CONFIG_DIR/projects, so Wavi's transcript meter and title reader run as they do for the real CLI.
//
// Mode at launch: $TR_SCALE_START (default `idle`). Commands on stdin, one byte each:
//   i  idle at the prompt (after finishing the turn in progress)
//   w  work: turns back to back, $TR_SCALE_LPS reply lines per second (default 20), 1 s between turns
//   c  cycle, like a person's agent: turns of 20–120 s at 5–30 lines per second, 30–300 s idle in between; some tool
//      calls ask for permission (answered by itself after 3–15 s), some run two subagents in parallel
//   k  print `@@key <n>@@ t=<ms>` at once (input latency; t is when the key arrived, Date.now())
//   b  burst: $TR_SCALE_BURST_MB (default 32) MB of colored Chinese reply lines as fast as the PTY takes them, like a
//      `cat` of a big log; then `@@burst-done@@`, and {start, end, bytes} in $TR_SCALE_BURST_DIR/<folder>.json
//   q / Ctrl+C  quit
// Every switch to idle prints `@@idle@@`. Deterministic per working folder.
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const at = process.argv.indexOf('--settings')
const settings = at > 0 ? JSON.parse(readFileSync(process.argv[at + 1], 'utf8')) : {}
const cwd = process.cwd()
const linesPerSecond = Number(process.env.TR_SCALE_LPS ?? 20) || 20
const burstBytes = (Number(process.env.TR_SCALE_BURST_MB ?? 32) || 32) * 1048576

function hash(text) {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619)
  return h >>> 0
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(hash(cwd))
const pick = (items) => items[Math.floor(random() * items.length)]
const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1))

const sessionId = `00000000-0000-4000-8000-${hash(cwd).toString(16).padStart(12, '0')}`
const configDir = process.env.CLAUDE_CONFIG_DIR
const transcript = configDir ? join(configDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`) : join(cwd, `${sessionId}.jsonl`)
try {
  mkdirSync(join(transcript, '..'), { recursive: true })
} catch {
  // Unwritable: the transcript appends fail quietly too.
}

// ── Hooks: run in order, like Claude (it waits for each hook before going on) ───────────────────────────────────────
let hookChain = Promise.resolve()
function runCommand(command, input) {
  return new Promise((done) => {
    const child = spawn('/bin/sh', ['-c', command], { stdio: ['pipe', 'ignore', 'ignore'] })
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    child.on('error', () => done())
    child.on('exit', () => {
      clearTimeout(timer)
      done()
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(input))
  })
}
function hook(event, payload = {}) {
  const entry = settings.hooks?.[event]?.[0]?.hooks?.[0]
  if (!entry) return hookChain
  const input = { session_id: sessionId, transcript_path: transcript, cwd, permission_mode: 'default', hook_event_name: event, ...payload }
  hookChain = hookChain.then(() => runCommand(entry.command, input))
  return hookChain
}
let contextPercent = between(5, 20)
let usedFiveHour = between(1, 30)
function statusLine() {
  const command = settings.statusLine?.command
  if (!command) return
  contextPercent = Math.min(95, contextPercent + random() * 0.6)
  usedFiveHour = Math.min(99, usedFiveHour + random() * 0.05)
  const used = Math.round(2000 * contextPercent)
  void runCommand(command, {
    session_id: sessionId,
    transcript_path: transcript,
    cwd,
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    context_window: {
      used_percentage: Math.round(contextPercent),
      context_window_size: 200_000,
      current_usage: { input_tokens: 800, cache_creation_input_tokens: 1200, cache_read_input_tokens: used - 2000, output_tokens: 300 }
    },
    rate_limits: { five_hour: { used_percentage: Math.round(usedFiveHour), resets_at: Math.floor(Date.now() / 1000) + 3600 } }
  })
}

// ── Drawing ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const out = (text) => process.stdout.write(text)
const title = (text) => out(`\x1b]0;${text}\x07`)
const sgr = (params) => `\x1b[0;${params}m`
let columns = process.stdout.columns || 100
process.stdout.on('resize', () => (columns = process.stdout.columns || columns))

const HAN = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处理府研质'
const WORDS = ['src/auth/session.ts', 'npm test', 'useEffect', 'git diff', 'TerminalSurface', 'README.md', 'pnpm build', '200 OK']
const COLORS = ['', '1', '2', '3', '38;2;215;119;87', '38;2;177;185;249', '38;2;78;186;101', '38;2;153;153;153']
function han(n) {
  let text = ''
  for (let i = 0; i < n; i++) text += HAN[Math.floor(random() * HAN.length)]
  return text
}
function replyLine() {
  const kind = random()
  let line = kind < 0.4 ? `${sgr('38;2;215;119;87')}⏺ ` : kind < 0.7 ? `${sgr('2')}  ⎿  ` : `${sgr(kind < 0.85 ? '48;2;34;92;43' : '48;2;122;41;54')}  ${between(10, 999)} ${kind < 0.85 ? '+' : '-'} `
  let width = 6
  while (width < Math.min(columns, 120) - 16) {
    if (random() < 0.1) {
      const word = pick(WORDS)
      line += `${sgr('38;2;177;185;249')}${word}`
      width += word.length
    } else {
      const run = between(1, 6)
      line += `${sgr(pick(COLORS) || '0')}${han(run)}`
      width += run * 2
    }
  }
  return `${line}\x1b[0m`
}

/** The last screen line is a status line while working; content goes above it. */
let statusText = ''
function print(line) {
  out(`\r\x1b[2K${line}\r\n${statusText}`)
}
function setStatus(text) {
  statusText = text
  out(`\r\x1b[2K${text}`)
}
const BUSY = ['⠂', '⠐']
function drawIdle() {
  statusText = ''
  out(`\r\x1b[2K\r\n${sgr('2')}────────────────────────────────────────\x1b[0m\r\n❯ \r\n  ${sgr('2')}? for shortcuts\x1b[0m\x1b[1A\r\x1b[2C`)
  title('✳ Claude Code')
}

// ── Turns ────────────────────────────────────────────────────────────────────────────────────────────────────────────
let mode = 'idle'
let turnNo = 0
let keys = 0
let working = false
let wantIdle = false
let toolNo = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TOOLS = [
  () => ({ tool_name: 'Bash', tool_input: { command: pick(['pnpm test', 'git status', 'npm run build', 'ls -la src', 'rg useSession']), description: '运行' } }),
  () => ({ tool_name: 'Edit', tool_input: { file_path: join(cwd, pick(['src/a.ts', 'src/auth/session.ts', 'README.md'])), old_string: 'a', new_string: 'b' } }),
  () => ({ tool_name: 'Read', tool_input: { file_path: join(cwd, pick(['package.json', 'src/index.ts', 'docs/PRD.md'])) } }),
  () => ({ tool_name: 'Grep', tool_input: { pattern: pick(['useSession', 'TODO', 'export function']) } })
]

/** Streams reply lines for `ms` at `lps`, keeping the spinner line moving. */
async function stream(ms, lps) {
  const started = Date.now()
  let owed = 0
  let last = started
  let frame = 0
  while (Date.now() - started < ms && !(wantIdle && mode !== 'work')) {
    await sleep(100)
    const now = Date.now()
    owed += ((now - last) * lps) / 1000
    last = now
    for (; owed >= 1; owed--) print(replyLine())
    frame++
    setStatus(`${sgr('38;2;215;119;87')}✻\x1b[0m 处理中… (${Math.round((now - turnStarted) / 1000)}s · esc to interrupt)`)
    if (frame % 5 === 0) title(`${BUSY[(frame / 5) % 2]} Claude Code`)
    if (frame % 20 === 0) statusLine()
  }
}

let turnStarted = 0
async function toolCall(agentId, lps, ask) {
  const call = pick(TOOLS)()
  const id = `toolu_${hash(`${cwd}${++toolNo}`).toString(36)}`
  const extra = agentId ? { agent_id: agentId, agent_type: 'general-purpose' } : {}
  await hook('PreToolUse', { ...call, tool_use_id: id, ...extra })
  if (ask) {
    await hook('PermissionRequest', { ...call, permission_suggestions: [], ...extra })
    title('✳ Claude Code')
    print(`${sgr('1')}${call.tool_name}\x1b[0m(${JSON.stringify(call.tool_input).slice(0, 60)})`)
    setStatus(`Do you want to proceed?  ❯ 1. Yes  2. No   Esc to cancel`)
    await sleep(between(3_000, 15_000))
  }
  print(`${sgr('38;2;78;186;101')}⏺\x1b[0m ${call.tool_name}(${JSON.stringify(call.tool_input).slice(0, 50)})`)
  await stream(between(1_000, 4_000), lps)
  await hook('PostToolUse', { ...call, tool_use_id: id, tool_response: { stdout: 'ok', stderr: '', interrupted: false }, ...extra })
}

async function turn(lps, long) {
  turnNo++
  turnStarted = Date.now()
  const prompt = `${han(between(6, 20))} #${turnNo}`
  appendFileSync(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt }, timestamp: new Date().toISOString() })}\n`)
  if (turnNo === 1) appendFileSync(transcript, `${JSON.stringify({ type: 'ai-title', aiTitle: `压测 ${basename(cwd)}` })}\n`)
  print(`${sgr('2')}> ${prompt}\x1b[0m`)
  await hook('UserPromptSubmit', { prompt })
  title(`${BUSY[0]} Claude Code`)
  const deadline = Date.now() + (long ? between(20_000, 120_000) : between(6_000, 12_000))
  while (Date.now() < deadline && !wantIdle) {
    const roll = random()
    if (long && roll < 0.08) {
      // Two subagents at once (Task tool): their tool calls carry agent_id and interleave.
      const task = { tool_name: 'Task', tool_input: { description: '并行调查', prompt: '...', subagent_type: 'general-purpose' } }
      const taskId = `toolu_task_${turnNo}`
      await hook('PreToolUse', { ...task, tool_use_id: taskId })
      await Promise.all(['a', 'b'].map(async (name) => {
        const agentId = `agent-${turnNo}-${name}`
        for (let i = between(1, 3); i > 0; i--) await toolCall(agentId, lps / 2, false)
        await hook('SubagentStop', { agent_id: agentId, agent_type: 'general-purpose', stop_hook_active: false })
      }))
      await hook('PostToolUse', { ...task, tool_use_id: taskId, tool_response: { content: [{ type: 'text', text: '完成' }] } })
    } else {
      await toolCall(undefined, lps, long && roll < 0.2)
    }
    await stream(between(500, 3_000), lps)
  }
  const reply = `${han(between(10, 40))}。`
  const usage = { input_tokens: between(5, 50), cache_creation_input_tokens: between(500, 3000), cache_read_input_tokens: between(20_000, 120_000), output_tokens: between(200, 2000) }
  appendFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { id: `msg_${turnNo}`, role: 'assistant', content: [{ type: 'text', text: reply }], usage }, timestamp: new Date().toISOString() })}\n`)
  print(`${sgr('38;2;215;119;87')}⏺\x1b[0m ${reply}`)
  await hook('Stop', { stop_hook_active: false, last_assistant_message: reply, background_tasks: [], session_crons: [] })
  drawIdle()
}

async function loop() {
  if (working) return
  working = true
  try {
    while (mode !== 'idle') {
      wantIdle = false
      if (mode === 'work') {
        await turn(linesPerSecond, false)
        await sleep(1_000)
      } else {
        await turn(between(5, 30), true)
        const pause = between(30_000, 300_000)
        const until = Date.now() + pause
        while (Date.now() < until && mode === 'cycle') await sleep(500)
      }
    }
  } finally {
    working = false
    out('\r\n\x1b[0m@@idle@@\r\n')
    drawIdle()
  }
}

let bursting = false
async function burst() {
  if (bursting) return
  bursting = true
  // One block of reply lines, written again and again: drawing it fresh each time would make the agent the bottleneck.
  const lines = []
  for (let i = 0; i < 400; i++) lines.push(replyLine())
  const block = Buffer.from(`\r\x1b[2K${lines.join('\r\n')}\r\n`)
  const start = Date.now()
  let bytes = 0
  while (bytes < burstBytes) {
    bytes += block.length
    if (!process.stdout.write(block)) await new Promise((r) => process.stdout.once('drain', r))
  }
  out('\x1b[0m@@burst-done@@\r\n')
  const end = Date.now()
  const dir = process.env.TR_SCALE_BURST_DIR
  if (dir) writeFileSync(join(dir, `${basename(cwd)}.json`), JSON.stringify({ start, end, bytes }))
  bursting = false
  drawIdle()
}

function setMode(next) {
  if (next === mode) return
  mode = next
  if (next === 'idle') wantIdle = true
  else void loop()
}

process.stdin.setRawMode?.(true)
process.stdin.on('data', (data) => {
  for (const byte of data) {
    const command = String.fromCharCode(byte)
    if (command === 'k') print(`\x1b[0m@@key ${++keys}@@ t=${Date.now()}`)
    else if (command === 'b') void burst()
    else if (command === 'w') setMode('work')
    else if (command === 'c') setMode('cycle')
    else if (command === 'i') setMode('idle')
    else if (command === 'q' || byte === 3) process.exit(0)
  }
})
process.stdin.on('end', () => process.exit(0))

out(`${sgr('38;2;215;119;87')}✻\x1b[0m Claude Code v9.9.9\r\n\r\n  ${basename(cwd)}\r\n`)
void hook('SessionStart', { source: 'startup', model: 'claude-opus-5-5' })
drawIdle()
out('\r\n@@ready@@\r\n')
setMode(process.env.TR_SCALE_START === 'cycle' ? 'cycle' : process.env.TR_SCALE_START === 'work' ? 'work' : 'idle')
