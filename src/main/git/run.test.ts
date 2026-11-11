// The process runner every git and gh call goes through: what callers read when a command fails, stops or floods.
import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))
const { gitEnv, gitText, lastLines, runGit, runProcess } = await import('./run')

const shell = (script: string, options: { timeout?: number; maxStdout?: number; input?: string } = {}) =>
  runProcess('/bin/sh', ['-c', script], { cwd: '/', env: process.env, timeout: options.timeout ?? 5_000, ...options })

describe('runProcess', () => {
  it('returns the exit code and both outputs, feeding stdin when given', async () => {
    expect(await shell('cat; echo err >&2; exit 3', { input: 'hello' })).toEqual({ code: 3, stdout: 'hello', stderr: 'err\n' })
  })

  it('stops a command that runs too long or prints too much, and says why (code -1)', async () => {
    const slow = await shell('sleep 5', { timeout: 200 })
    expect(slow.code).toBe(-1)
    expect(slow.stderr).toContain('秒没有结束，已停止')
    const loud = await shell('yes', { maxStdout: 1024 * 1024 })
    expect(loud.code).toBe(-1)
    expect(loud.stderr).toContain('输出超过 1 MiB，已停止')
  })

  it('never rejects when the program is not there', async () => {
    const missing = await runProcess('/no/such/program', [], { cwd: '/', env: process.env, timeout: 1_000 })
    expect(missing.code).toBe(-1)
    expect(missing.stderr).toContain('ENOENT')
  })
})

describe('git', () => {
  it('runs git without a credential prompt, and gitText rejects with its last lines unless the code is allowed', async () => {
    expect((await runGit('/', ['--version'])).stdout).toMatch(/^git version/)
    await expect(gitText('/', ['rev-parse', '--git-dir'])).rejects.toThrow(/not a git repository/)
    await expect(gitText('/', ['rev-parse', '--git-dir'], { ok: [128] })).resolves.toBe('')
    await expect(gitText('/', ['rev-parse', '--git-dir'], { message: () => 'custom' })).rejects.toThrow('custom')
    expect(lastLines('a\nb\nc\nd', 2)).toBe('c d')
  })
})

describe('git speaks English', () => {
  // The failure classes and the parsers read git's English words; hooks inherit the same locale (VS Code's git does so too).
  const english = { LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8', LANGUAGE: 'en' }

  it('gives every git process an English UTF-8 locale that no caller can override', () => {
    const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, LANGUAGE: process.env.LANGUAGE }
    Object.assign(process.env, { LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', LANGUAGE: 'zh_CN' })
    try {
      expect(gitEnv()).toMatchObject(english)
      expect(gitEnv({ LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8', GIT_EDITOR: 'true' })).toMatchObject({ ...english, GIT_EDITOR: 'true' })
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  // Only a git built with gettext and its Chinese catalogue (Homebrew's) translates; Apple's git prints English anyway.
  const zh = { ...process.env, LC_ALL: 'zh_CN.UTF-8', LANG: 'zh_CN.UTF-8', LANGUAGE: 'zh_CN' }
  let translated = false
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: '/', env: zh, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    translated = /[\u4e00-\u9fff]/.test(String((error as { stderr?: Buffer }).stderr ?? ''))
  }
  it.skipIf(!translated)('prints English under a Chinese login locale (skipped: this machine’s git has no Chinese translations)', async () => {
    const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, LANGUAGE: process.env.LANGUAGE }
    Object.assign(process.env, { LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', LANGUAGE: 'zh_CN' })
    try {
      expect((await runGit('/', ['rev-parse', '--git-dir'])).stderr).toMatch(/not a git repository/)
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
