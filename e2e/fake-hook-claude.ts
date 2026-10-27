// A fake `claude` that runs the hook commands of the per-launch `--settings` file Wavi gives it, on steps a test
// appends to a file — so status travels the real path (hook command → socket → pty daemon relay → main → renderer)
// with no model and no real CLI. Each launch works in its own folder: it writes its pid to `.fake-pid` and its
// arguments to `.fake-argv`, reads its steps from `.fake-steps` and logs every byte typed to `.fake-typed` (Enter as
// <ENTER>). Typed text is echoed to the screen, as a TUI's input line would show it, a long paste as Claude's
// `[Pasted text …]` placeholder (the send protocol waits for that before pressing Enter). A step is
// `{ hook, payload }`, `{ statusLine: payload }` (runs the settings' statusLine command), `{ print: text }` or
// `{ exit: code }`. Run as `claude -p` (Wavi's background review, PRD F13) it saves the prompt from stdin and prints the
// reply that `reviewReply()` set, as e2e/fake-claude.ts does.
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { outerClaudeEnv } from './fake-claude'

const FAKE_CLAUDE = `#!/usr/bin/env node
const { execSync } = require('node:child_process')
const fs = require('node:fs')
// Wavi's version check runs it from its own folder: answer and leave no files behind.
if (process.argv[2] === '--version') {
  process.stdout.write('9.9.9 (Claude Code)\\n')
  process.exit(0)
}
// Wavi's background review (claude -p, PRD F13): the prompt comes in on stdin, the reply is the one the test set.
if (process.argv[2] === '-p') {
  const log = process.env.TR_FAKE_LOG || ''
  fs.writeFileSync(log + '.review-in', fs.readFileSync(0, 'utf8'))
  fs.writeFileSync(log + '.review-argv', process.argv.slice(2).join('\\n') + '\\n')
  try {
    process.stdout.write(fs.readFileSync(log + '.review-out', 'utf8'))
  } catch {}
  process.exit(0)
}
const at = process.argv.indexOf('--settings')
const settings = at > 0 ? JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8')) : {}
const dir = process.cwd()
fs.writeFileSync(dir + '/.fake-pid', String(process.pid))
fs.writeFileSync(dir + '/.fake-argv', JSON.stringify(process.argv.slice(2)))
const run = (command, payload) => {
  try {
    execSync(command, { input: JSON.stringify(payload), timeout: 10000, shell: '/bin/sh', stdio: ['pipe', 'ignore', 'ignore'] })
  } catch {}
}
const hook = (event, payload) => {
  const entry = settings.hooks && settings.hooks[event] && settings.hooks[event][0].hooks[0]
  if (entry) run(entry.command, { hook_event_name: event, session_id: 'fake-' + process.pid, cwd: dir, ...payload })
}
process.stdout.write('Claude Code v9.9.9\\r\\n\\r\\n❯ \\r\\n')
hook('SessionStart', { source: 'startup' })
let seen = 0
setInterval(() => {
  let steps
  try {
    steps = fs.readFileSync(dir + '/.fake-steps', 'utf8').split('\\n').filter(Boolean)
  } catch {
    return
  }
  for (; seen < steps.length; seen++) {
    const step = JSON.parse(steps[seen])
    if (step.exit !== undefined) process.exit(step.exit)
    if (step.statusLine && settings.statusLine) run(settings.statusLine.command, { session_id: 'fake-' + process.pid, cwd: dir, ...step.statusLine })
    if (step.print !== undefined) process.stdout.write(step.print)
    if (step.hook) hook(step.hook, step.payload || {})
  }
}, 150)
if (process.stdin.isTTY) process.stdin.setRawMode(true)
// Like Claude Code 2.1.296: a paste of more than 800 characters or 3+ newlines shows as a placeholder.
let paste = null
process.stdin.on('data', (d) => {
  const text = d.toString()
  fs.appendFileSync(dir + '/.fake-typed', text.replace(/\\r/g, '<ENTER>\\n'))
  let out = ''
  let rest = text
  while (rest) {
    if (paste === null) {
      const at = rest.indexOf('\\x1b[200~')
      if (at < 0) {
        out += rest
        break
      }
      out += rest.slice(0, at)
      rest = rest.slice(at + 6)
      paste = ''
    } else {
      const end = rest.indexOf('\\x1b[201~')
      if (end < 0) {
        paste += rest
        break
      }
      paste += rest.slice(0, end)
      rest = rest.slice(end + 6)
      const lines = paste.split(/\\r\\n|\\r|\\n/).length - 1
      out += paste.length > 800 || lines >= 3 ? '[Pasted text #1 +' + lines + ' lines]' : paste
      paste = null
    }
  }
  process.stdout.write(out.replace(/\\r/g, '\\r\\n❯ '))
})
`

export interface FakeAgentFolder {
  path: string
  /** Appends a step for the fake running in this folder. */
  step(value: { hook: string; payload?: Record<string, unknown> } | { statusLine: Record<string, unknown> } | { print: string } | { exit: number }): void
  /** The pid of the fake running here (null before it started). */
  pid(): number | null
  typed(): string
}

/** Installs the fake on a throwaway login-shell PATH; `env` goes to launchApp, `folder()` makes a working folder. */
export function fakeHookClaude(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  for (const dir of [bin, zdot]) mkdirSync(dir)
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)
  const log = join(root, 'claude.log')
  return {
    root,
    env: { ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', TR_FAKE_LOG: log },
    /** What the next `claude -p` prints (Claude's --output-format json result). */
    reviewReply: (structured: unknown) =>
      writeFileSync(`${log}.review-out`, JSON.stringify({ type: 'result', is_error: false, total_cost_usd: 0.012, duration_ms: 900, structured_output: structured })),
    /** The prompt the last `claude -p` read from stdin ('' before any). */
    reviewPrompt: () => (existsSync(`${log}.review-in`) ? readFileSync(`${log}.review-in`, 'utf8') : ''),
    folder(name: string): FakeAgentFolder {
      const path = join(root, name)
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, '.fake-steps'), '')
      return {
        path,
        step: (value) => appendFileSync(join(path, '.fake-steps'), `${JSON.stringify(value)}\n`),
        pid: () => (existsSync(join(path, '.fake-pid')) ? Number(readFileSync(join(path, '.fake-pid'), 'utf8')) : null),
        typed: () => (existsSync(join(path, '.fake-typed')) ? readFileSync(join(path, '.fake-typed'), 'utf8') : '')
      }
    }
  }
}

/** Whether a process is alive (signal 0). */
export function alive(pid: number | null): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
