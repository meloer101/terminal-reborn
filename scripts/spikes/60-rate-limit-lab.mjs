/* eslint-disable no-undef */
// Rate-limit spike (PRD §6.6 / §6.7, F11 "额度恢复后继续"): what do the REAL CLIs show and report when the plan's limit
// is exhausted? A local mock server plays the vendor's API and answers 429 the way the real one does, so no quota is
// spent and nothing is sent anywhere. Then the mock flips to 200 and the spike types "继续" + Enter, as Wavi would.
//   node scripts/spikes/60-rate-limit-lab.mjs claude          # Claude Code, gateway mode: composes the plan-limit line
//   node scripts/spikes/60-rate-limit-lab.mjs claude-endpoint # Claude Code on a plain custom endpoint (CC Switch case)
//   node scripts/spikes/60-rate-limit-lab.mjs codex           # Codex, usage_limit_reached + x-codex-primary-* at 100%
// Claude runs with a throwaway CLAUDE_CONFIG_DIR (never the user's ~/.claude) and only our --settings; Codex gets
// every setting through -c and writes nothing but its own rollout. Output: hook calls + screens in
// /tmp/tr-rate-limit-lab-out/<scenario>.jsonl.
// What the mock cannot show: Claude's subscriber-only UI (the /rate-limit-options menu it opens for Pro / Max
// accounts) needs a claude.ai login; that part comes from reading the 2.1.304 binary (PRD §6.6).
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch, show, sleep } from './harness.mjs'

const scenario = process.argv[2] ?? 'claude'
const OUT = process.env.LAB_OUT ?? '/tmp/tr-rate-limit-lab-out'
const HOOK = resolve(import.meta.dirname, '../../resources/hooks/tr-hook.sh')
mkdirSync(OUT, { recursive: true })
const logFile = join(OUT, `${scenario}.jsonl`)
rmSync(logFile, { force: true })
const t0 = Date.now()
const log = (rec) => appendFileSync(logFile, JSON.stringify({ t: Date.now() - t0, ...rec }) + '\n')
const work = realpathSync(mkdtempSync(join(tmpdir(), 'tr-rl-')))
const repo = join(work, 'repo')
mkdirSync(repo)
execFileSync('git', ['init', '-q'], { cwd: repo })
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo })

// ---- hook capture (same relay script as the app) ----
const sock = join(work, 'h.sock')
const token = 'spike-token'
const hooks = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    if (req.headers['x-tr-token'] !== token) return void ((res.statusCode = 403), res.end())
    const url = new URL(req.url, 'http://tr')
    let body = {}
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      /* keep {} */
    }
    log({ dir: 'hook', event: url.pathname.split('/').pop(), body })
    res.end()
  })
})
await new Promise((r) => hooks.listen(sock, r))
const count = (event) =>
  existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter((l) => l.includes('"dir":"hook"') && l.includes(`"event":"${event}"`)).length : 0
const waitHook = async (events, base, ms = 60000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    for (const e of events) if (count(e) > (base[e] ?? 0)) return e
    await sleep(200)
  }
  return null
}

// ---- the mock vendor API ----
let limited = true
const resetAt = Math.floor(Date.now() / 1000) + 2 * 3600 + 17 * 60
const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`)

function claudeReply(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const usage = { input_tokens: 12, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  sse(res, 'message_start', { message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], stop_reason: null, stop_sequence: null, usage } })
  sse(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  sse(res, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'RESUMED-OK' } })
  sse(res, 'content_block_stop', { index: 0 })
  sse(res, 'message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  sse(res, 'message_stop', {})
  res.end()
}

function claudeLimit(res) {
  // The shape the real API sends when the plan's limit is used up (headers the 2.1.304 binary reads: CAs()).
  res.writeHead(429, {
    'content-type': 'application/json',
    'retry-after': String(resetAt - Math.floor(Date.now() / 1000)),
    'x-should-retry': 'false',
    'anthropic-ratelimit-unified-status': 'rejected',
    'anthropic-ratelimit-unified-representative-claim': process.env.CLAIM ?? 'five_hour',
    'anthropic-ratelimit-unified-reset': String(resetAt),
    'anthropic-ratelimit-unified-5h-utilization': '1.0',
    'anthropic-ratelimit-unified-5h-reset': String(resetAt),
    'anthropic-ratelimit-unified-7d-utilization': '0.42',
    'anthropic-ratelimit-unified-7d-reset': String(resetAt + 4 * 86400)
  })
  res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } }))
}

function codexReply(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const id = `resp_${Date.now()}`
  sse(res, 'response.created', { response: { id } })
  const message = { type: 'message', role: 'assistant', id: 'msg_1', content: [{ type: 'output_text', text: 'RESUMED-OK' }] }
  sse(res, 'response.output_item.added', { output_index: 0, item: { ...message, content: [] } })
  sse(res, 'response.output_text.delta', { item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'RESUMED-OK' })
  sse(res, 'response.output_item.done', { output_index: 0, item: message })
  sse(res, 'response.completed', { response: { id, usage: { input_tokens: 10, input_tokens_details: null, output_tokens: 5, output_tokens_details: null, total_tokens: 15 } } })
  res.end()
}

function codexLimit(res) {
  // codex-rs: a 429 whose body has error.type "usage_limit_reached" becomes UsageLimitReached (no retry).
  res.writeHead(429, {
    'content-type': 'application/json',
    'x-codex-primary-used-percent': '100',
    'x-codex-primary-window-minutes': '300',
    'x-codex-primary-reset-at': String(resetAt),
    'x-codex-secondary-used-percent': '41',
    'x-codex-secondary-window-minutes': '10080',
    'x-codex-secondary-reset-at': String(resetAt + 4 * 86400)
  })
  res.end(JSON.stringify({ error: { type: 'usage_limit_reached', message: 'The usage limit has been reached', plan_type: 'plus', resets_at: resetAt } }))
}

const isCodex = scenario === 'codex'
const api = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const url = req.url ?? ''
    log({ dir: 'api', method: req.method, path: url.split('?')[0], limited }) // never log headers (auth)
    if (req.method === 'GET' && url.includes('/models')) {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ data: [], models: [] }))
    }
    if (isCodex && req.method === 'POST' && url.includes('/responses')) {
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        /* keep {} */
      }
      if (body.text?.format?.type === 'json_schema') return codexReply(res) // title helper
      return limited ? codexLimit(res) : codexReply(res)
    }
    if (!isCodex && req.method === 'POST' && url.startsWith('/v1/messages') && !url.includes('count_tokens')) {
      return limited ? claudeLimit(res) : claudeReply(res)
    }
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'mock' } }))
  })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const port = api.address().port

// ---- launch ----
let c
if (isCodex) {
  const tomlString = (v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop']
  const base = [
    '-c', 'check_for_update_on_startup=false',
    '-c', 'model_provider="mock"',
    '-c', `model_providers.mock={name="mock",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false}`,
    '-c', `projects={"${repo}"={trust_level="trusted"}}`
  ]
  const flags = [...base, ...EVENTS.flatMap((e) => ['-c', `hooks.${e}=[{hooks=[{type="command",command=${tomlString(`/bin/sh '${HOOK}' ${e} codex`)},timeout=10}]}]`])]
  const probe = spawnSync('node', [resolve(import.meta.dirname, '40-codex-hooks-list.mjs'), ...flags], { encoding: 'utf8', env: { ...process.env, LAB: repo } })
  const mine = JSON.parse(probe.stdout).data[0].hooks.filter((h) => h.source === 'sessionFlags')
  const state = `hooks.state={${mine.map((h) => `${tomlString(h.key)}={trusted_hash=${tomlString(h.currentHash)}}`).join(',')}}`
  c = launch('codex', [...flags, '-c', state], { cwd: repo, env: { TR_SESSION_ID: 'lab-1', TR_HOOK_SOCK: sock, TR_HOOK_TOKEN: token, NO_PROXY: '127.0.0.1,localhost' } })
} else {
  const config = join(work, 'claude-config')
  mkdirSync(config)
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [repo]: { hasTrustDialogAccepted: true } } }))
  const statusLine = join(work, 'statusline.sh')
  writeFileSync(statusLine, `#!/bin/sh\ncat > '${join(work, 'statusline.json')}'\necho lab\n`)
  const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'SessionEnd']
  const settings = {
    hooks: Object.fromEntries(EVENTS.map((e) => [e, [{ hooks: [{ type: 'command', command: `/bin/sh '${HOOK}' ${e}`, timeout: 10 }] }]])),
    statusLine: { type: 'command', command: `/bin/sh '${statusLine}'` }
  }
  const settingsFile = join(work, 'settings.json')
  writeFileSync(settingsFile, JSON.stringify(settings))
  const env = {
    CLAUDE_CONFIG_DIR: config,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_AUTH_TOKEN: 'lab-not-a-real-token',
    ...(scenario === 'claude' ? { CLAUDE_CODE_USE_GATEWAY: '1' } : {}),
    NO_PROXY: '127.0.0.1,localhost',
    TR_SESSION_ID: 'lab-1',
    TR_HOOK_SOCK: sock,
    TR_HOOK_TOKEN: token
  }
  c = launch('claude', ['--setting-sources', '', '--settings', settingsFile, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], { cwd: repo, env })
}

const snap = (label) => {
  const s = c.visible()
  show(label, s)
  log({ dir: 'screen', label, screen: s })
}
const type = async (text) => {
  c.write('\x1b[200~' + text + '\x1b[201~')
  await sleep(250)
  c.write('\r')
  log({ dir: 'sent', text })
}

try {
  const ready = await c.waitFor(isCodex ? /›/ : /\? for shortcuts|Try "|bypass|>/, 30000)
  console.log('ready after ms:', ready)
  await sleep(2500)
  snap('ready')
  const base = { Stop: count('Stop'), StopFailure: count('StopFailure') }
  await type('Reply with only the word OK.')
  const first = await waitHook(['StopFailure', 'Stop'], base, isCodex ? 20000 : 60000)
  console.log('first turn ended with hook:', first)
  await sleep(3000)
  snap('after the limited turn')
  if (!isCodex && existsSync(join(work, 'statusline.json'))) log({ dir: 'statusline', json: JSON.parse(readFileSync(join(work, 'statusline.json'), 'utf8')) })
  if (isCodex) {
    const rollout = execFileSync('find', [join(process.env.HOME, '.codex', 'sessions'), '-name', 'rollout-*.jsonl', '-newer', sock], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    for (const file of rollout) {
      if (!readFileSync(file, 'utf8').includes(repo)) continue
      for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
        const entry = JSON.parse(line)
        if (entry.type === 'event_msg' && ['token_count', 'error', 'stream_error', 'task_complete', 'turn_aborted'].includes(entry.payload?.type)) log({ dir: 'rollout', payload: entry.payload })
      }
    }
  }
  // The limit "resets": the mock answers normally; type 继续 like Wavi's scheduled send.
  limited = false
  const base2 = { Stop: count('Stop'), StopFailure: count('StopFailure') }
  await type('继续')
  const second = await waitHook(['Stop', 'StopFailure'], base2, 30000)
  console.log('continue turn ended with hook:', second)
  await sleep(2000)
  snap('after 继续')
} finally {
  c.write('\x03')
  await sleep(300)
  c.write('\x03')
  await sleep(1500)
  c.kill()
  hooks.close()
  api.closeAllConnections()
  api.close()
  rmSync(work, { recursive: true, force: true })
  console.log('log:', logFile)
}
process.exit(0)
