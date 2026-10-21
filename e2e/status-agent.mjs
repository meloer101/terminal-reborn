#!/usr/bin/env node
// A fake `claude` / `codex` that replays one simulated session (src/shared/agent-sim.ts) inside Wavi for
// e2e/status-stress.spec.ts: hooks through the commands of its per-launch `--settings` (Claude; the fake Codex has no
// hooks, as when Wavi cannot pin Codex's hook trust), terminal titles, the screen's tail, the exit — each at its time.
// Its working folder holds `.sim-script.json` (the steps); it writes `.sim-start` (epoch ms its clock started at).
//
//   status-agent.mjs <claude|codex> [agent arguments…]
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

// Wavi also runs the CLIs without a terminal (Codex's hook-trust probe `codex app-server`, usage polling): not us.
if (!process.stdin.isTTY) process.exit(1)

const at = process.argv.indexOf('--settings')
const settings = at > 0 ? JSON.parse(readFileSync(process.argv[at + 1], 'utf8')) : {}
const { steps } = JSON.parse(readFileSync('.sim-script.json', 'utf8'))
const start = Date.now()
writeFileSync('.sim-start', String(start))

let chain = Promise.resolve()
/** Hooks run one after another, as the CLI waits for each. */
function hook(name, payload) {
  const command = settings.hooks?.[name]?.[0]?.hooks?.[0]?.command
  if (!command) return
  chain = chain.then(
    () =>
      new Promise((done) => {
        const child = spawn('/bin/sh', ['-c', command], { stdio: ['pipe', 'ignore', 'ignore'] })
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
        child.on('error', () => done())
        child.on('exit', () => {
          clearTimeout(timer)
          done()
        })
        child.stdin.on('error', () => {})
        child.stdin.end(JSON.stringify({ ...payload, transcript_path: '' }))
      })
  )
}

function draw(text) {
  process.stdout.write(`\x1b[2J\x1b[H${text.split('\n').join('\r\n')}`)
}

for (const step of steps) {
  setTimeout(() => {
    if (step.kind === 'hook') {
      if (!step.lost) hook(step.hook, step.payload)
    } else if (step.kind === 'title') process.stdout.write(`\x1b]0;${step.title}\x07`)
    else if (step.kind === 'screen') draw(step.text)
    else if (step.kind === 'exit') void chain.then(() => process.exit(step.code))
  }, Math.max(0, start + step.at - Date.now()))
}

process.stdin.setRawMode?.(true)
process.stdin.on('data', (data) => {
  if (data.includes(3)) process.exit(130)
})
