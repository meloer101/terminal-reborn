/* eslint-disable no-undef */
// Codex context + rate-limit spike (PRD §6.7, F11): what does Codex 0.142.5 write to its rollout JSONL about the
// context window and the plan's 5 h / weekly limits? The real provider answers 503, so the local mock model plays
// the server and sends the `x-codex-primary-*` / `x-codex-secondary-*` response headers the binary reads
// (strings in the binary: -primary-used-percent, -primary-window-minutes, -primary-reset-at, same for secondary).
//   node scripts/spikes/42-codex-usage-lab.mjs [noheaders]
// Runs `codex exec` once in a scratch git repo (nothing written to ~/.codex except Codex's own rollout file),
// then prints every `token_count` event of that rollout.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockProvider } from './codex-mock-provider.mjs'

const withHeaders = process.argv[2] !== 'noheaders'
const resetAt = Math.floor(Date.now() / 1000) + 2 * 3600
const headers = withHeaders
  ? {
      'x-codex-primary-used-percent': '40.5',
      'x-codex-primary-window-minutes': '300',
      'x-codex-primary-reset-at': String(resetAt),
      'x-codex-secondary-used-percent': '12',
      'x-codex-secondary-window-minutes': '10080',
      'x-codex-secondary-reset-at': String(resetAt + 4 * 86400)
    }
  : {}
const mock = await startMockProvider({ headers })
const repo = realpathSync(mkdtempSync(join(tmpdir(), 'tr-codex-usage-')))
execFileSync('git', ['init', '-q'], { cwd: repo })
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo })

const args = ['exec', '--json', '--skip-git-repo-check', '-c', 'check_for_update_on_startup=false', ...mock.config.flatMap((o) => ['-c', o]), 'REPLY: hi']
// Async: the mock server lives in this process, so a spawnSync would starve it.
const run = await new Promise((resolve) => {
  const child = spawn('codex', args, { cwd: repo, env: { ...process.env, NO_PROXY: '127.0.0.1,localhost' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => (stdout += d))
  child.stderr.on('data', (d) => (stderr += d))
  const timer = setTimeout(() => child.kill(), 60_000)
  child.on('close', (status) => (clearTimeout(timer), resolve({ status, stdout, stderr })))
})
await mock.close()
const events = run.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l))
const threadId = events.find((e) => e.type === 'thread.started')?.thread_id
console.log('exit', run.status, 'thread', threadId)
console.log('exec --json events:', events.map((e) => e.type).join(', '))
const turnDone = events.find((e) => e.type === 'turn.completed')
if (turnDone) console.log('turn.completed', JSON.stringify(turnDone))

// The rollout: ~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread>.jsonl
const found = execFileSync('find', [join(process.env.HOME, '.codex', 'sessions'), '-name', `*${threadId}.jsonl`], { encoding: 'utf8' }).trim()
console.log('rollout', found)
for (const line of readFileSync(found, 'utf8').split('\n').filter(Boolean)) {
  const entry = JSON.parse(line)
  if (entry.payload?.type === 'token_count') console.log(JSON.stringify(entry.payload, null, 1))
}
