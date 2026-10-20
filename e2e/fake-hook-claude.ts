// A fake `claude` that runs the hook commands of the per-launch `--settings` file Wavi gives it, on steps a test
// appends to a file — so status travels the real path (hook command → socket → pty daemon relay → main → renderer)
// with no model and no real CLI. Each launch works in its own folder: it writes its pid to `.fake-pid`, reads its
// steps from `.fake-steps` and logs every byte typed to `.fake-typed` (Enter as <ENTER>). A step is
// `{ hook, payload }` or `{ exit: code }`.
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { outerClaudeEnv } from './fake-claude'

const FAKE_CLAUDE = `#!/usr/bin/env node
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const at = process.argv.indexOf('--settings')
const settings = at > 0 ? JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8')) : {}
const dir = process.cwd()
fs.writeFileSync(dir + '/.fake-pid', String(process.pid))
const hook = (event, payload) => {
  const entry = settings.hooks && settings.hooks[event] && settings.hooks[event][0].hooks[0]
  if (!entry) return
  try {
    execSync(entry.command, {
      input: JSON.stringify({ hook_event_name: event, session_id: 'fake-' + process.pid, cwd: dir, ...payload }),
      timeout: 10000,
      shell: '/bin/sh',
      stdio: ['pipe', 'ignore', 'ignore']
    })
  } catch {}
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
    if (step.hook) hook(step.hook, step.payload || {})
  }
}, 150)
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.on('data', (d) => fs.appendFileSync(dir + '/.fake-typed', d.toString().replace(/\\r/g, '<ENTER>\\n')))
`

export interface FakeAgentFolder {
  path: string
  /** Appends a step for the fake running in this folder. */
  step(value: { hook: string; payload?: Record<string, unknown> } | { exit: number }): void
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
  return {
    root,
    env: { ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh' },
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
