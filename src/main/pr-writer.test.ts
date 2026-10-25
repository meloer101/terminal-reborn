// AI 写 (PRD F16 v1.68) against real git repositories and fake `claude` / `codex` scripts first on the PATH: each logs
// its arguments and stdin and answers like the real CLI (Claude on stdout, Codex into its -o file).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-writer-')))
const bin = join(base, 'bin')
const log = join(base, 'log')
mkdirSync(bin)
mkdirSync(log)

writeFileSync(
  join(bin, 'claude'),
  `#!/bin/sh
printf '%s\\n' "$@" > "${log}/claude-args"
cat > "${log}/claude-stdin"
cat "${log}/claude-answer"
`
)
writeFileSync(
  join(bin, 'codex'),
  `#!/bin/sh
printf '%s\\n' "$@" > "${log}/codex-args"
cat > "${log}/codex-stdin"
out=""
prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
cp "${log}/codex-answer" "$out"
`
)
chmodSync(join(bin, 'claude'), 0o755)
chmodSync(join(bin, 'codex'), 0o755)

const roots = new Set<string>()
let pathValue = `${bin}:/usr/bin:/bin`
vi.mock('./workspace-store', () => ({ isProjectRoot: (path: string) => roots.has(path) }))
vi.mock('./settings', () => ({ getSettings: () => DEFAULT_SETTINGS }))
// searchPath() adds /opt/homebrew/bin and friends after the login PATH: only this test's folders may be searched, so
// a real claude / codex on the machine is never started.
vi.mock('./agents-installed', async (importOriginal) => {
  const real = await importOriginal<typeof import('./agents-installed')>()
  return {
    ...real,
    userLoginPath: async () => pathValue,
    executableOnPath: (path: string, name: string) =>
      real.executableOnPath(
        path
          .split(':')
          .filter((dir) => dir.startsWith(base))
          .join(':'),
        name
      )
  }
})
vi.mock('electron', () => ({
  app: { on: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null, fromWebContents: () => null }
}))

const { writeShipText } = await import('./pr-writer')

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env: process.env }).toString()

let n = 0
function setup() {
  n++
  const root = join(base, `repo-${n}`)
  mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, 'a.txt'), 'a\n')
  writeFileSync(join(root, 'CLAUDE.md'), '# Guide\nUse tabs.\nCommits: Conventional Commits, English.\n')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'feat(core): start')
  roots.add(root)
  const wt = join(base, `wt-${n}`)
  git(root, 'worktree', 'add', '-q', '-b', 'feat', wt)
  git(root, 'config', 'branch.feat.base', 'main')
  writeFileSync(join(wt, 'b.txt'), 'b\n')
  git(wt, 'add', '.')
  git(wt, 'commit', '-q', '-m', 'feat(nav): add b')
  return { root, wt }
}

beforeEach(() => {
  for (const f of ['claude-args', 'claude-stdin', 'codex-args', 'codex-stdin']) rmSync(join(log, f), { force: true })
  pathValue = `${bin}:/usr/bin:/bin`
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('AI 写 (PRD F16 v1.68)', () => {
  it("writes a commit message from the ticked files only, with the repository's style and rules, with no tools", async () => {
    const { root, wt } = setup()
    writeFileSync(join(wt, 'a.txt'), 'a changed\n')
    writeFileSync(join(wt, 'new.txt'), 'brand new\n')
    writeFileSync(join(wt, 'skip.txt'), 'not ticked\n')
    writeFileSync(join(log, 'claude-answer'), JSON.stringify({ type: 'result', structured_output: { message: 'fix(core): change a' }, total_cost_usd: 0.0004 }))
    const result = await writeShipText({ root, worktree: wt, kind: 'commit', agent: 'claude', paths: ['a.txt', 'new.txt'] })
    expect(result).toEqual({ ok: true, kind: 'commit', message: 'fix(core): change a', agent: 'claude', model: 'haiku' })
    const args = readFileSync(join(log, 'claude-args'), 'utf8').split('\n')
    expect(args).toEqual(expect.arrayContaining(['-p', '--no-session-persistence', '--strict-mcp-config', '--model', 'haiku']))
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    const prompt = readFileSync(join(log, 'claude-stdin'), 'utf8')
    expect(prompt).toContain('+a changed')
    expect(prompt).toContain('+brand new')
    expect(prompt).not.toContain('not ticked')
    expect(prompt).toContain('- feat(nav): add b')
    expect(prompt).toContain('Commits: Conventional Commits, English.')
    expect(prompt).not.toContain('Use tabs.')
  })

  it('writes a PR title and body with Codex, from the branch and the commit about to be made', async () => {
    const { root, wt } = setup()
    writeFileSync(join(wt, 'c.txt'), 'c\n')
    writeFileSync(join(log, 'codex-answer'), JSON.stringify({ title: 'Add nav pieces', body: '## 改了什么\n- b\n- c' }))
    const result = await writeShipText({ root, worktree: wt, kind: 'pr', agent: 'codex', paths: ['c.txt'], pendingMessage: 'feat(nav): add c' })
    expect(result).toEqual({ ok: true, kind: 'pr', title: 'Add nav pieces', body: '## 改了什么\n- b\n- c', agent: 'codex', model: '' })
    const prompt = readFileSync(join(log, 'codex-stdin'), 'utf8')
    expect(prompt).toContain('<branch-commits>\n- feat(nav): add b\n- feat(nav): add c\n</branch-commits>')
    expect(prompt).toContain('+b')
    expect(prompt).toContain('+c')
    expect(readFileSync(join(log, 'codex-args'), 'utf8')).toContain('model_reasoning_effort="low"')
  })

  it('falls back to the other CLI when the chosen one is not installed, and says when neither is', async () => {
    const { root, wt } = setup()
    writeFileSync(join(wt, 'a.txt'), 'x\n')
    const onlyCodex = join(base, 'only-codex')
    mkdirSync(onlyCodex)
    execFileSync('ln', ['-s', join(bin, 'codex'), join(onlyCodex, 'codex')])
    pathValue = `${onlyCodex}:/usr/bin:/bin`
    writeFileSync(join(log, 'codex-answer'), JSON.stringify({ message: 'fix: x' }))
    expect(await writeShipText({ root, worktree: wt, kind: 'commit', agent: 'claude', paths: ['a.txt'] })).toMatchObject({ ok: true, agent: 'codex', message: 'fix: x' })
    pathValue = '/usr/bin:/bin'
    expect(await writeShipText({ root, worktree: wt, kind: 'commit', agent: 'claude', paths: ['a.txt'] })).toEqual({ ok: false, message: '没有找到 claude 或 codex：装好其中一个后再试' })
  })

  it('says what went wrong, and refuses the base branch, files without changes and bad input', async () => {
    const { root, wt } = setup()
    writeFileSync(join(wt, 'a.txt'), 'x\n')
    writeFileSync(join(log, 'claude-answer'), JSON.stringify({ type: 'result', is_error: true, result: 'Credit balance is too low' }))
    expect(await writeShipText({ root, worktree: wt, kind: 'commit', agent: 'claude', paths: ['a.txt'] })).toEqual({ ok: false, message: 'Claude 没写出来：Credit balance is too low' })
    expect(await writeShipText({ root, worktree: wt, kind: 'commit', agent: 'claude', paths: ['b.txt'] })).toEqual({ ok: false, message: '勾选的文件没有改动' })
    expect(await writeShipText({ root, worktree: root, kind: 'pr', agent: 'claude', paths: [] })).toEqual({ ok: false, message: '这是基线分支本身' })
    expect(await writeShipText({ root: '/elsewhere', worktree: wt, kind: 'commit', agent: 'claude', paths: ['a.txt'] })).toEqual({ ok: false, message: '请求无效' })
    expect(existsSync(join(log, 'claude-stdin'))).toBe(true)
  })
})
