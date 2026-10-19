import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shellIntegrationEnv, shimDirs, shimFile, writeCodexOverrides, writeShims } from './shell-agents'

const SCRIPT = resolve(__dirname, '../../../resources/hooks/agent-shim.sh')

describe('shellIntegrationEnv', () => {
  const dirs = shimDirs('/u/agent-shims')

  it('puts the shims first on PATH once, for every shell', () => {
    const env = shellIntegrationEnv('/bin/bash', { PATH: '/u/agent-shims/bin:/usr/bin::/bin' }, dirs)
    expect(env).toEqual({ WAVI_SHIM_DIR: '/u/agent-shims/bin', PATH: '/u/agent-shims/bin:/usr/bin:/bin' })
  })

  it('hands zsh our ZDOTDIR and remembers the user’s', () => {
    expect(shellIntegrationEnv('/bin/zsh', { PATH: '/usr/bin', ZDOTDIR: '/u/.config/zsh' }, dirs)).toMatchObject({
      ZDOTDIR: '/u/agent-shims/zsh',
      WAVI_USER_ZDOTDIR: '/u/.config/zsh'
    })
    expect(shellIntegrationEnv('/opt/homebrew/bin/zsh', { PATH: '/usr/bin' }, dirs)).not.toHaveProperty('WAVI_USER_ZDOTDIR')
  })

  it('gives fish a vendor_conf.d through XDG_DATA_DIRS', () => {
    expect(shellIntegrationEnv('/usr/local/bin/fish', { PATH: '/usr/bin' }, dirs).XDG_DATA_DIRS).toBe('/u/agent-shims/fish-data:/usr/local/share:/usr/share')
    expect(shellIntegrationEnv('/usr/local/bin/fish', { PATH: '/usr/bin', XDG_DATA_DIRS: '/x' }, dirs).XDG_DATA_DIRS).toBe('/u/agent-shims/fish-data:/x')
  })
})

describe('writeShims', () => {
  it('writes executable shims that hand over to the script, and the integration files', () => {
    const root = mkdtempSync(join(tmpdir(), 'wavi-shims-'))
    const dirs = writeShims(root, "/Apps/Wavi's.app/agent-shim.sh")
    expect(readFileSync(join(dirs.bin, 'claude'), 'utf8')).toBe(shimFile('claude', "/Apps/Wavi's.app/agent-shim.sh"))
    expect(readFileSync(join(dirs.bin, 'codex'), 'utf8')).toContain(`exec /bin/sh '/Apps/Wavi'\\''s.app/agent-shim.sh' codex "$@"`)
    expect(statSync(join(dirs.bin, 'claude')).mode & 0o111).toBe(0o111)
    expect(readFileSync(join(dirs.zsh, '.zshenv'), 'utf8')).toContain('add-zsh-hook precmd __wavi_shims_first')
    expect(readFileSync(join(dirs.fishData, 'fish', 'vendor_conf.d', 'wavi.fish'), 'utf8')).toContain('--on-event fish_prompt')
    writeCodexOverrides(dirs, ['hooks.Stop=[1]', 'bad\nline', 'hooks.state={a="b c"}'])
    expect(readFileSync(dirs.codexConfig, 'utf8')).toBe('hooks.Stop=[1]\nhooks.state={a="b c"}\n')
  })
})

describe('agent-shim.sh', () => {
  const root = mkdtempSync(join(tmpdir(), 'wavi-shim-run-'))
  const shimBin = join(root, 'shims')
  const realBin = join(root, 'real')
  const log = join(root, 'hooks.log')
  const sock = join(root, 'hook.sock')
  let server: Server

  beforeAll(async () => {
    for (const dir of [shimBin, realBin]) spawnSync('mkdir', ['-p', dir])
    // The real CLIs: print what they got, exit with $FAKE_EXIT.
    for (const agent of ['claude', 'codex']) {
      writeFileSync(
        join(realBin, agent),
        `#!/bin/sh\nprintf 'argv:'; for a in "$@"; do printf '[%s]' "$a"; done; printf '\\nwrapped:%s\\npath:%s\\n' "\${WAVI_AGENT_WRAPPED-}" "$PATH"\nexit "\${FAKE_EXIT:-0}"\n`
      )
      chmodSync(join(realBin, agent), 0o755)
    }
    writeFileSync(join(root, 'hook.sh'), `cat >/dev/null; printf '%s %s\\n' "$1" "$2" >> '${log}'\n`)
    writeFileSync(join(root, 'claude-settings.json'), '{}')
    writeFileSync(join(root, 'codex-config'), 'hooks.Stop=[{x=1}]\nhooks.state={a="it\'s"}\n')
    server = createServer()
    await new Promise<void>((done) => server.listen(sock, done))
  })

  afterAll(() => server?.close())

  function run(agent: string, args: string[], extra: Record<string, string | undefined> = {}) {
    writeFileSync(log, '')
    const env: Record<string, string> = {
      PATH: `${shimBin}:${realBin}:/usr/bin:/bin`,
      WAVI_SHIM_DIR: shimBin,
      TR_SESSION_ID: 's1',
      TR_HOOK_SOCK: sock,
      TR_HOOK_TOKEN: 't',
      TR_HOOK_SCRIPT: join(root, 'hook.sh'),
      TR_CLAUDE_SETTINGS: join(root, 'claude-settings.json'),
      TR_CODEX_CONFIG: join(root, 'codex-config')
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
    const result = spawnSync('/bin/sh', [SCRIPT, agent, ...args], { env, encoding: 'utf8' })
    const out = result.stdout
    return {
      status: result.status,
      argv: /argv:(.*)/.exec(out)?.[1] ?? null,
      wrapped: /wrapped:(.*)/.exec(out)?.[1] ?? null,
      path: /path:(.*)/.exec(out)?.[1] ?? null,
      hooks: readFileSync(log, 'utf8').trim(),
      stderr: result.stderr
    }
  }

  it('adds our settings to an interactive claude, runs it without the shims on PATH and reports its end', () => {
    const r = run('claude', ['--model', 'opus', 'fix the nav'], { FAKE_EXIT: '3' })
    expect(r.argv).toBe(`[--settings][${join(root, 'claude-settings.json')}][--model][opus][fix the nav]`)
    expect(r.wrapped).toBe('1')
    expect(r.path?.split(':')).not.toContain(shimBin)
    expect(r.status).toBe(3)
    expect(r.hooks).toBe('AgentExit claude')
  })

  it('leaves management commands, one-shot runs and the user’s own --settings alone', () => {
    for (const args of [['mcp', 'list'], ['-p', 'hi'], ['--print', 'hi'], ['--version'], ['--settings', 'mine.json'], ['--settings=mine.json'], ['update']]) {
      const r = run('claude', args)
      expect(r.argv).toBe(args.map((a) => `[${a}]`).join(''))
      expect(r.wrapped).toBe('')
      expect(r.hooks).toBe('')
    }
  })

  it('does nothing outside a Wavi terminal or inside an agent', () => {
    expect(run('claude', ['hi'], { TR_SESSION_ID: undefined }).argv).toBe('[hi]')
    expect(run('claude', ['hi'], { TR_HOOK_SOCK: join(root, 'nope.sock') }).argv).toBe('[hi]')
    expect(run('claude', ['hi'], { WAVI_AGENT_WRAPPED: '1' }).argv).toBe('[hi]')
    expect(run('claude', ['hi'], { TR_CLAUDE_SETTINGS: join(root, 'missing.json') }).argv).toBe('[hi]')
  })

  it('puts the Codex overrides first for an interactive codex and resume, not for exec', () => {
    const c = `[-c][hooks.Stop=[{x=1}]][-c][hooks.state={a="it's"}]`
    expect(run('codex', []).argv).toBe(c)
    expect(run('codex', ['resume', 'abc']).argv).toBe(`${c}[resume][abc]`)
    expect(run('codex', ['resume', 'abc']).hooks).toBe('AgentExit codex')
    expect(run('codex', ['exec', 'hi']).argv).toBe('[exec][hi]')
    expect(run('codex', ['login']).argv).toBe('[login]')
  })

  it('says so when the CLI is not installed', () => {
    const r = run('claude', [], { PATH: `${shimBin}:/usr/bin:/bin` })
    expect(r.status).toBe(127)
    expect(r.stderr).toContain('claude: command not found')
  })
})
