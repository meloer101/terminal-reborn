/* eslint-disable no-undef */
// Throwaway spike harness: run a real CLI in a PTY, mirror it in @xterm/headless,
// and expose the rendered screen. Not shipped; see docs/spikes/send-protocol.md.
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const pty = require('node-pty')
const { Terminal } = require('@xterm/headless')

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const PASTE_START = '\x1b[200~'
export const PASTE_END = '\x1b[201~'

/** Env for a child CLI: strip markers of the outer Claude Code session. */
export function cleanEnv(extra = {}) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (
      k === 'CLAUDECODE' ||
      k.startsWith('CLAUDE_CODE_') ||
      k.startsWith('CLAUDE_AGENT_') ||
      k.startsWith('ORCA_') ||
      k === 'CLAUDE_PID' ||
      k === 'CLAUDE_EFFORT' ||
      k === 'CLAUDE_PREVIEW_CLASSIFIER_FLOOR'
    ) {
      delete env[k]
    }
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.LANG = 'en_US.UTF-8'
  return { ...env, ...extra }
}

/** Fresh temp git repo. */
export function makeRepo(name = 'repo') {
  const dir = mkdtempSync(join(tmpdir(), `trspike-${name}-`))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# spike\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: dir })
  return dir
}

/** An already-trusted repo for the experiments: $EXP_REPO, or the path stored in the file named by $EXP_REPO_FILE. */
export function expRepo() {
  if (process.env.EXP_REPO) return process.env.EXP_REPO
  if (process.env.EXP_REPO_FILE) return readFileSync(process.env.EXP_REPO_FILE, 'utf8').trim()
  throw new Error('set EXP_REPO (a trusted repo) first')
}

export function launch(cmd, args, { cwd, cols = 120, rows = 40, env = {} } = {}) {
  const term = new Terminal({ cols, rows, scrollback: 50000, allowProposedApi: true })
  const raw = []
  const p = pty.spawn(cmd, args, { name: 'xterm-256color', cols, rows, cwd, env: cleanEnv(env) })
  const t0 = Date.now()
  p.onData((d) => {
    raw.push([Date.now() - t0, d])
    term.write(d)
  })
  let exited = null
  p.onExit((e) => {
    exited = e
  })
  const api = {
    p,
    term,
    raw,
    get exited() {
      return exited
    },
    write: (d) => p.write(d),
    /** Rendered rows (scrollback included when all=true) as text. */
    screen(all = true) {
      const buf = term.buffer.active
      const lines = []
      const start = all ? 0 : buf.baseY
      for (let i = start; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
      return lines.join('\n').replace(/\n+$/, '')
    },
    visible() {
      return api.screen(false)
    },
    async waitFor(re, timeoutMs = 20000, all = false) {
      const t = Date.now()
      while (Date.now() - t < timeoutMs) {
        const s = api.screen(all)
        if (typeof re === 'string' ? s.includes(re) : re.test(s)) return Date.now() - t
        await sleep(50)
      }
      return -1
    },
    async settle(quietMs = 800, maxMs = 15000) {
      const t = Date.now()
      let last = raw.length
      let lastChange = Date.now()
      while (Date.now() - t < maxMs) {
        await sleep(100)
        if (raw.length !== last) {
          last = raw.length
          lastChange = Date.now()
        }
        if (Date.now() - lastChange >= quietMs) return
      }
    },
    kill() {
      try {
        p.kill()
      } catch {
        /* already gone */
      }
    }
  }
  return api
}

export function show(label, text) {
  console.log(`\n=== ${label} ===\n${text}\n=== end ===`)
}

/** Spinner / busy markers of the Claude Code TUI. */
export const CLAUDE_SPINNER = /esc to interrupt|[✢✳✶✻✽·*] \S+…/

/** Wait until the Claude TUI is idle again (no spinner, empty prompt). */
export async function claudeWaitIdle(c, { startTimeout = 4000, maxMs = 60000 } = {}) {
  const started = (await c.waitFor(CLAUDE_SPINNER, startTimeout)) >= 0
  if (!started) return false
  const t = Date.now()
  while (Date.now() - t < maxMs) {
    await sleep(300)
    if (!CLAUDE_SPINNER.test(c.visible())) {
      await sleep(700)
      if (!CLAUDE_SPINNER.test(c.visible())) return true
    }
  }
  return false
}

/** Ground truth for what Claude received: user messages from the newest session JSONL for `cwd`. */
export function claudeUserMessages(cwd, sessionIndex = 0) {
  const dir = join(process.env.HOME, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  const file = files[sessionIndex]
  if (!file) return []
  const out = []
  for (const line of readFileSync(join(dir, file.f), 'utf8').split('\n')) {
    if (!line) continue
    const o = JSON.parse(line)
    if (o.type !== 'user' || o.isMeta) continue
    const m = o.message?.content
    const text = typeof m === 'string' ? m : (m ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
    if (text) out.push(text)
  }
  return out
}
