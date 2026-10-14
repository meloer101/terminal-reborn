import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { agentArgv } from '@shared/agent-launch'
import {
  buildCodexHookOverrides,
  buildCodexTrustOverride,
  CODEX_HOOK_EVENTS,
  codexHookCommand,
  coversAllEvents,
  sessionFlagHashes
} from './codex-config'
import { prepareCodexHookConfig, requestHooksList } from './codex-probe'

const SCRIPT = '/Applications/Terminal Reborn.app/Contents/Resources/hooks/tr-hook.sh'
const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`

/** A `hooks/list` result as Codex 0.142.5 answers it (trimmed), with the user's own hooks mixed in. */
function listResult(keys: string[]) {
  const mine = keys.map((key, i) => ({ key, source: 'sessionFlags', sourcePath: '/<session-flags>/config.toml', currentHash: hash(i + 1), trustStatus: 'untrusted' }))
  const users = [{ key: '/Users/x/.codex/hooks.json:stop:0:0', source: 'user', currentHash: hash(99), trustStatus: 'trusted' }]
  return { data: [{ cwd: '/tmp', hooks: [...users, ...mine], warnings: [], errors: [] }] }
}
const ALL_KEYS = ['session_start', 'user_prompt_submit', 'pre_tool_use', 'permission_request', 'post_tool_use', 'stop'].map((e) => `/<session-flags>/config.toml:${e}:0:0`)

describe('buildCodexHookOverrides', () => {
  const overrides = buildCodexHookOverrides(SCRIPT)

  it('has one hooks.<Event> override per event, each a single sh-run relay for the codex agent', () => {
    expect(overrides).toHaveLength(CODEX_HOOK_EVENTS.length)
    expect(overrides[0]).toBe(
      `hooks.SessionStart=[{hooks=[{type="command",command="/bin/sh '${SCRIPT}' SessionStart codex",timeout=10}]}]`
    )
    expect(codexHookCommand(SCRIPT, 'Stop')).toBe(`/bin/sh '${SCRIPT}' Stop codex`)
  })

  it('lets only PermissionRequest outlive the app hold', () => {
    const permission = overrides.find((o) => o.startsWith('hooks.PermissionRequest='))
    expect(permission).toContain('timeout=130')
    expect(overrides.filter((o) => o.includes('timeout=130'))).toHaveLength(1)
  })

  it('escapes quotes and backslashes in the script path for TOML', () => {
    const [first] = buildCodexHookOverrides('/a "b"\\c')
    expect(first).toContain(`command="/bin/sh '/a \\"b\\"\\\\c' SessionStart codex"`)
  })
})

describe('buildCodexTrustOverride', () => {
  it('pins exactly the given hashes under hooks.state', () => {
    expect(buildCodexTrustOverride({ '/<session-flags>/config.toml:stop:0:0': hash(1) })).toBe(
      `hooks.state={"/<session-flags>/config.toml:stop:0:0"={trusted_hash="${hash(1)}"}}`
    )
  })

  it('is null without hashes', () => {
    expect(buildCodexTrustOverride({})).toBeNull()
  })
})

describe('sessionFlagHashes', () => {
  it('keeps only session-flag hooks, never the user, project or plugin ones', () => {
    const hashes = sessionFlagHashes(listResult(ALL_KEYS))
    expect(Object.keys(hashes)).toEqual(ALL_KEYS)
    expect(hashes['/Users/x/.codex/hooks.json:stop:0:0']).toBeUndefined()
  })

  it('ignores malformed results and malformed hashes', () => {
    expect(sessionFlagHashes(null)).toEqual({})
    expect(sessionFlagHashes({ data: 'x' })).toEqual({})
    expect(sessionFlagHashes({ data: [{ hooks: [{ key: 'k', source: 'sessionFlags', currentHash: 'md5:abc' }, { source: 'sessionFlags' }] }] })).toEqual({})
  })
})

describe('coversAllEvents', () => {
  it('needs a hash for every configured event', () => {
    expect(coversAllEvents(sessionFlagHashes(listResult(ALL_KEYS)))).toBe(true)
    expect(coversAllEvents(sessionFlagHashes(listResult(ALL_KEYS.slice(1))))).toBe(false)
    expect(coversAllEvents({})).toBe(false)
  })
})

describe('agentArgv · codex config overrides', () => {
  it('appends every override as its own -c after the trust flags', () => {
    const argv = agentArgv('codex', '/work', { codexConfig: ['hooks.Stop=[]', 'hooks.state={}'] })
    expect(argv.slice(-4)).toEqual(['-c', 'hooks.Stop=[]', '-c', 'hooks.state={}'])
    expect(argv.slice(0, 5)).toEqual(['codex', '-c', 'check_for_update_on_startup=false', '-c', 'projects={"/work"={trust_level="trusted"}}'])
  })

  it('claude ignores them', () => {
    expect(agentArgv('claude', '/work', { codexConfig: ['x=1'] })).toEqual(['claude'])
  })
})

describe('requestHooksList', () => {
  /** A fake `codex app-server`: answers initialize, then hooks/list. */
  function fakeServer(answer: (id: number) => object | null) {
    const input = new PassThrough()
    const output = new PassThrough()
    const received: object[] = []
    let buffer = ''
    input.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, i)) as { id?: number }
        buffer = buffer.slice(i + 1)
        received.push(message)
        if (message.id !== undefined) {
          const reply = answer(message.id)
          if (reply) output.write(`${JSON.stringify({ id: message.id, ...reply })}\n`)
        }
      }
    })
    return { input, output, received }
  }

  it('sends initialize, initialized and hooks/list for the cwd, and returns the result', async () => {
    const server = fakeServer((id) => (id === 2 ? { result: listResult(ALL_KEYS) } : { result: {} }))
    server.output.write('some shell rc noise\n')
    const result = await requestHooksList(server.input, server.output, '/tmp/probe', 1000)
    expect(sessionFlagHashes(result)).toHaveProperty([ALL_KEYS[0]!])
    expect(server.received).toEqual([
      { id: 1, method: 'initialize', params: { clientInfo: { name: 'terminal-reborn', version: '0' } } },
      { method: 'initialized' },
      { id: 2, method: 'hooks/list', params: { cwds: ['/tmp/probe'] } }
    ])
  })

  it('rejects on a JSON-RPC error', async () => {
    const server = fakeServer((id) => (id === 2 ? { error: { message: 'boom' } } : { result: {} }))
    await expect(requestHooksList(server.input, server.output, '/tmp', 1000)).rejects.toThrow('boom')
  })

  it('rejects when codex stays silent', async () => {
    const server = fakeServer(() => null)
    await expect(requestHooksList(server.input, server.output, '/tmp', 30)).rejects.toThrow('did not answer')
  })
})

describe('prepareCodexHookConfig', () => {
  it('returns the hook overrides followed by the trust pin built from the probe', async () => {
    const hashes = sessionFlagHashes(listResult(ALL_KEYS))
    const probe = vi.fn().mockResolvedValue(hashes)
    const prepared = await prepareCodexHookConfig(SCRIPT, '/bin/zsh', probe)
    expect(probe).toHaveBeenCalledWith(buildCodexHookOverrides(SCRIPT), '/bin/zsh')
    expect(prepared.ok).toBe(true)
    const config = prepared.ok ? prepared.config : []
    expect(config.slice(0, -1)).toEqual(buildCodexHookOverrides(SCRIPT))
    expect(config.at(-1)).toBe(buildCodexTrustOverride(hashes))
  })

  it('degrades to no hooks (not ok, with a reason) when the probe fails or is incomplete', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await prepareCodexHookConfig(SCRIPT, '/bin/zsh', () => Promise.reject(new Error('no codex')))).toMatchObject({ ok: false, reason: 'codex-probe-failed' })
    expect(await prepareCodexHookConfig(SCRIPT, '/bin/zsh', () => Promise.resolve({}))).toMatchObject({ ok: false, reason: 'codex-probe-failed' })
    expect(await prepareCodexHookConfig(SCRIPT, '/bin/zsh', () => Promise.resolve(sessionFlagHashes(listResult(ALL_KEYS.slice(2)))))).toMatchObject({
      ok: false,
      reason: 'codex-probe-failed'
    })
    error.mockRestore()
  })
})
