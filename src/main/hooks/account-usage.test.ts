import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { VendorUsage } from '@shared/session-meta'
import { CodexAccountClient, readClaudeAccountUsage } from './account-usage'

let dir: string
/**
 * A stand-in for the user's login shell running the CLI (`<shell> -l -i -c "exec claude …"`): it logs its arguments
 * and each start, then answers stdin line by line with `body`.
 */
function fakeShell(name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$4" >> "${path}.args"\necho start >> "${path}.starts"\necho 'rc noise'\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}
const starts = (shell: string) => (existsSync(`${shell}.starts`) ? readFileSync(`${shell}.starts`, 'utf8').trim().split('\n').length : 0)

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tr-account-test-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const AT = 1_792_413_000_000

describe('readClaudeAccountUsage (get_usage control request)', () => {
  const answer = (response: object) =>
    `'${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'usage', response } })}'`
  const claude = (usageLine: string) => `while IFS= read -r line; do
  case "$line" in
    *'"initialize"'*) echo '{"type":"system","subtype":"init"}'; echo '{"type":"control_response","response":{"subtype":"success","request_id":"init","response":{}}}' ;;
    *'"get_usage"'*) echo ${usageLine} ;;
  esac
done`

  it('asks a headless Claude with the user’s hooks, settings and MCP servers off, and reads the plan windows', async () => {
    const shell = fakeShell(
      'claude-ok',
      claude(
        answer({
          subscription_type: 'max',
          rate_limits_available: true,
          rate_limits: { limits: [{ kind: 'session', group: 'session', percent: 20, resets_at: '2026-10-20T07:40:00Z' }] }
        })
      )
    )
    const outcome = await readClaudeAccountUsage(shell, { now: () => AT })
    expect(outcome).toEqual({
      kind: 'ok',
      usage: { vendor: 'claude', at: AT, complete: true, windows: [{ minutes: 300, percent: 20, resetsAt: Date.parse('2026-10-20T07:40:00Z') }] },
      plan: 'max'
    })
    const command = readFileSync(`${shell}.args`, 'utf8')
    expect(command).toMatch(/^exec 'claude' '-p' '--input-format' 'stream-json'/)
    expect(command).toContain("'--setting-sources' ''")
    expect(command).toContain('\'{"disableAllHooks":true}\'')
    expect(command).toContain("'--no-session-persistence'")
  })

  it('gives up on an account without plan limits, an older Claude, or none at all', async () => {
    const apiKey = fakeShell('claude-key', claude(answer({ subscription_type: null, rate_limits_available: false, rate_limits: null })))
    expect(await readClaudeAccountUsage(apiKey)).toMatchObject({ kind: 'unsupported', state: 'no-plan' })
    const old = fakeShell(
      'claude-old',
      claude(`'${JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: 'usage', error: 'Unsupported control request subtype: get_usage' } })}'`)
    )
    expect(await readClaudeAccountUsage(old)).toMatchObject({ kind: 'unsupported', state: 'outdated', detail: expect.stringContaining('Unsupported') })
    expect(await readClaudeAccountUsage(fakeShell('claude-missing', 'exit 127'))).toMatchObject({ kind: 'unsupported', state: 'missing' })
    // Three login shells in a row: more than the default 5 s when the whole suite runs at once.
  }, 15_000)

  it('reports a plan whose limits could not be read now, a crash and a silence as errors (retried later)', async () => {
    const busy = fakeShell('claude-busy', claude(answer({ subscription_type: 'pro', rate_limits_available: false, rate_limits: null })))
    expect(await readClaudeAccountUsage(busy)).toMatchObject({ kind: 'error' })
    expect(await readClaudeAccountUsage(fakeShell('claude-crash', 'exit 3'))).toMatchObject({ kind: 'error', detail: expect.stringContaining('code 3') })
    expect(await readClaudeAccountUsage(fakeShell('claude-silent', 'sleep 5'), { timeoutMs: 300 })).toMatchObject({ kind: 'error', detail: expect.stringContaining('in time') })
  })
})

describe('CodexAccountClient (codex app-server)', () => {
  // Answers by request id; after a rate-limit read it also pushes an update of another bucket and of the plan's own.
  // `login` is account/read's answer (0.165 shape).
  const codex = (reply: string, login = '\\"result\\":{\\"account\\":{\\"type\\":\\"chatgpt\\",\\"planType\\":\\"plus\\"}}') => `while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\\([0-9]*\\).*/\\1/p')
  case "$line" in
    *'"initialize"'*) echo "{\\"id\\":$id,\\"result\\":{}}" ;;
    *'"account/read"'*) echo "{\\"id\\":$id,${login}}" ;;
    *'account/rateLimits/read'*) echo "{\\"id\\":$id,${reply}}"
      echo '{"method":"account/rateLimits/updated","params":{"rateLimits":{"limitId":"codex_bengalfox","primary":{"usedPercent":99,"windowDurationMins":300}}}}'
      echo '{"method":"account/rateLimits/updated","params":{"rateLimits":{"limitId":"codex","primary":{"usedPercent":42,"windowDurationMins":300,"resetsAt":1792420883}}}}' ;;
  esac
done`
  const result = JSON.stringify({
    rateLimits: { limitId: 'codex', primary: { usedPercent: 41, windowDurationMins: 300, resetsAt: 1792420883 }, secondary: null },
    rateLimitsByLimitId: null
  })

  it('reads the plan windows, keeps one app-server for repeated reads, and passes on pushed updates of the plan’s bucket', async () => {
    const shell = fakeShell('codex-ok', codex(`\\"result\\":${result.replaceAll('"', '\\"')}`))
    const pushed: VendorUsage[] = []
    const client = new CodexAccountClient(shell, (u) => pushed.push(u), { now: () => AT })
    try {
      expect(await client.read()).toEqual({
        kind: 'ok',
        usage: { vendor: 'codex', at: AT, complete: true, windows: [{ minutes: 300, percent: 41, resetsAt: 1792420883_000 }] },
        plan: 'plus'
      })
      expect(await client.read()).toMatchObject({ kind: 'ok' })
      expect(starts(shell)).toBe(1)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(pushed.map((u) => u.windows[0]?.percent)).toEqual([42, 42])
      expect(readFileSync(`${shell}.args`, 'utf8')).toContain("exec 'codex' '-s' 'read-only' '-a' 'never' '-c' 'features.plugins=false' 'app-server'")
    } finally {
      client.close()
    }
  })

  it('asks an older Codex (before 0.151) without params, which it rejects', async () => {
    const shell = fakeShell(
      'codex-old',
      `while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\\([0-9]*\\).*/\\1/p')
  case "$line" in
    *'"initialize"'*) echo "{\\"id\\":$id,\\"result\\":{}}" ;;
    *'"account/read"'*) echo "{\\"id\\":$id,\\"error\\":{\\"code\\":-32600,\\"message\\":\\"Invalid request: unknown variant account/read\\"}}" ;;
    *'excludeResetCreditDetails'*) echo "{\\"id\\":$id,\\"error\\":{\\"code\\":-32600,\\"message\\":\\"Invalid request: invalid type: map, expected unit\\"}}" ;;
    *'account/rateLimits/read'*) echo "{\\"id\\":$id,\\"result\\":${result.replaceAll('"', '\\"')}}" ;;
  esac
done`
    )
    const client = new CodexAccountClient(shell, () => undefined)
    try {
      expect(await client.read()).toMatchObject({ kind: 'ok', usage: { windows: [{ minutes: 300, percent: 41 }] } })
      expect(await client.read()).toMatchObject({ kind: 'ok' })
    } finally {
      client.close()
    }
  })

  it('gives up on an API-key login, a signed-out one or a missing codex, and starts over after the app-server goes away', async () => {
    const denied = '\\"error\\":{\\"code\\":-32600,\\"message\\":\\"chatgpt authentication required to read rate limits\\"}'
    const cases: [string, string, string][] = [
      ['codex-key', '\\"result\\":{\\"account\\":{\\"type\\":\\"apiKey\\"}}', 'api-key'],
      ['codex-out', '\\"result\\":{\\"account\\":null,\\"requiresOpenaiAuth\\":true}', 'signed-out'],
      // A third-party provider: no OpenAI login, and none needed.
      ['codex-provider', '\\"result\\":{\\"account\\":null,\\"requiresOpenaiAuth\\":false}', 'no-plan'],
      // A Codex that does not know account/read: only the rate-limit read's refusal says anything.
      ['codex-noread', '\\"error\\":{\\"code\\":-32601,\\"message\\":\\"method not found\\"}', 'no-plan']
    ]
    for (const [name, login, state] of cases) {
      const client = new CodexAccountClient(fakeShell(name, codex(denied, login)), () => undefined)
      try {
        expect(await client.read()).toMatchObject({ kind: 'unsupported', state })
      } finally {
        client.close()
      }
    }
    const missing = new CodexAccountClient(fakeShell('codex-missing', 'exit 127'), () => undefined)
    expect(await missing.read()).toMatchObject({ kind: 'unsupported', state: 'missing' })
    const crashing = fakeShell('codex-crash', 'exit 3')
    const flaky = new CodexAccountClient(crashing, () => undefined)
    expect(await flaky.read()).toMatchObject({ kind: 'error', detail: expect.stringContaining('code 3') })
    expect(await flaky.read()).toMatchObject({ kind: 'error' })
    expect(starts(crashing)).toBe(2)
    flaky.close()
    // Six login shells in a row: more than the default 5 s when the whole suite runs at once.
  }, 15_000)
})
