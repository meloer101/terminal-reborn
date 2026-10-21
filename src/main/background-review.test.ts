// A real git repository and a fake `claude` / `codex` on PATH: the diff goes in on stdin, the JSON comes back as
// comments, one diff is reviewed once, a new diff cancels the running review, and switches gate the automatic ones.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { dismissKey, type ReviewStatus } from '@shared/background-review'
import { DEFAULT_SETTINGS, type ReviewSettings } from '@shared/settings'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-review-')))
const bin = join(base, 'bin')
let review: ReviewSettings = { ...DEFAULT_SETTINGS.review }

vi.mock('electron', () => ({ app: { on: () => {} }, ipcMain: { handle: () => {}, on: () => {} } }))
vi.mock('./settings', () => ({ getSettings: () => ({ ...DEFAULT_SETTINGS, review }) }))
vi.mock('./agents-installed', async (original) => ({
  ...(await original<typeof import('./agents-installed')>()),
  userLoginPath: async () => `${bin}:/usr/bin:/bin`
}))

const { parseReviewRequest, startReview, cancelReview, triggerAllowed, turnStarted, turnEnded, ReviewResultsFile, useReviewResultsFile, latestReview, dismissFindings, pickReviewer } =
  await import('./background-review')
const resultsPath = join(base, 'review-results.json')
useReviewResultsFile(new ReviewResultsFile(resultsPath))

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()

function repo(name: string): string {
  const dir = join(base, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

/** A fake CLI: saves stdin and argv next to itself, then runs `body`. */
function fake(name: 'claude' | 'codex', body: string): void {
  mkdirSync(bin, { recursive: true })
  const path = join(bin, name)
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > "${bin}/${name}.argv"\ncat > "${bin}/${name}.stdin"\n${body}\n`)
  chmodSync(path, 0o755)
}

const claudeJson = (findings: unknown[]) =>
  JSON.stringify({ type: 'result', is_error: false, total_cost_usd: 0.039, duration_ms: 11000, structured_output: { findings, summary: '看过了' } })

interface Owner {
  sent: ReviewStatus[]
  isDestroyed(): boolean
  send(channel: string, status: ReviewStatus): void
  once(): void
}

function owner(): Owner {
  const sent: ReviewStatus[] = []
  return { sent, isDestroyed: () => false, send: (_channel, status) => sent.push(status), once: () => {} }
}

const settled = async (o: Owner, root: string): Promise<ReviewStatus> => {
  await vi.waitFor(() => expect(o.sent.filter((s) => s.root === root).at(-1)?.phase).not.toBe('running'), { timeout: 10_000 })
  return o.sent.filter((s) => s.root === root).at(-1)!
}

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('parseReviewRequest / triggerAllowed', () => {
  it('accepts an absolute root, a known agent and trigger', () => {
    expect(parseReviewRequest({ root: '/w', agent: 'claude', trigger: 'manual' })).toEqual({ root: '/w', agent: 'claude', trigger: 'manual' })
    expect(() => parseReviewRequest({ root: 'w', agent: 'claude', trigger: 'manual' })).toThrow()
    expect(() => parseReviewRequest({ root: '/w', agent: 'bash', trigger: 'manual' })).toThrow()
    expect(() => parseReviewRequest({ root: '/w', agent: 'codex', trigger: 'cron' })).toThrow()
  })

  it('runs automatic triggers only when their switch is on and the built-in reviewer is chosen', () => {
    const off = DEFAULT_SETTINGS.review
    expect(triggerAllowed('manual', off)).toBe(true)
    expect(triggerAllowed('merge', off)).toBe(false)
    expect(triggerAllowed('turn', off)).toBe(false)
    expect(triggerAllowed('merge', { ...off, beforeMerge: true })).toBe(true)
    expect(triggerAllowed('push', { ...off, beforePush: true })).toBe(true)
    expect(triggerAllowed('turn', { ...off, afterTurnWithCommits: true })).toBe(true)
    expect(triggerAllowed('merge', { ...off, beforeMerge: true, mode: 'agent-command' })).toBe(false)
  })
})

describe('startReview', () => {
  it('sends the diff on stdin, read-only flags on argv, and lands the findings as comments', async () => {
    const root = repo('claude')
    writeFileSync(join(root, 'a.ts'), 'export const a = items[i]\n')
    writeFileSync(join(root, 'new.ts'), 'console.log(1)\n')
    fake('claude', `printf '%s' '${claudeJson([{ path: 'a.ts', startLine: 1, endLine: 1, side: 'new', group: 'committed', severity: 'P1', confidence: 0.8, title: '越界', explanation: 'i 可能越界' }])}'`)
    const o = owner()
    const first = await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })
    expect(first.phase).toBe('running')
    const done = await settled(o, root)
    expect(done.phase).toBe('done')
    expect(done.costUsd).toBe(0.039)
    expect(done.comments).toHaveLength(1)
    // The file's stamp wins over the group the reviewer guessed.
    expect(done.comments?.[0]).toMatchObject({ path: 'a.ts', group: 'uncommitted', severity: 'P1', origin: 'review', code: 'export const a = items[i]' })
    const stdin = readFileSync(join(bin, 'claude.stdin'), 'utf8')
    expect(stdin).toContain('+export const a = items[i]')
    expect(stdin).toContain('+++ b/new.ts')
    expect(stdin).toContain('# wavi-group: uncommitted')
    const argv = readFileSync(join(bin, 'claude.argv'), 'utf8').split('\n')
    expect(argv).toEqual(expect.arrayContaining(['-p', '--tools', 'Read,Grep,Glob', '--strict-mcp-config', 'project,local']))

    // The same diff again: the saved result stands, also after a restart (PRD F13 v1.63).
    const again = await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })
    expect(again).toMatchObject({ phase: 'done', cached: true, found: 1, counts: { P1: 1 }, message: '看过了' })
    const saved = new ReviewResultsFile(resultsPath)
    useReviewResultsFile(saved)
    await vi.waitFor(() => expect(saved.get()[root]?.records).toHaveLength(1))
    expect(await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })).toMatchObject({ phase: 'done', cached: true, found: 1 })
    expect(latestReview(root)).toMatchObject({ phase: 'done', hash: done.hash, found: 1, costUsd: 0.039 })
    expect(latestReview(join(base, 'never-reviewed'))).toBeNull()
  })

  it('does not land a finding the user ignored before, and says how many were left out', async () => {
    const root = repo('dismissed')
    const finding = { path: 'a.ts', startLine: 1, endLine: 1, side: 'new', group: 'uncommitted', severity: 'P2', confidence: 0.6 }
    fake('claude', `printf '%s' '${claudeJson([{ ...finding, title: '命名不清', explanation: 'a 太短' }, { ...finding, title: '少了测试', explanation: '没有测试' }])}'`)
    dismissFindings(root, [dismissKey('a.ts', '  命名不清 ')])
    writeFileSync(join(root, 'a.ts'), 'export const a = 6\n')
    const o = owner()
    await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })
    const done = await settled(o, root)
    expect(done.comments?.map((c) => c.text.split('\n')[0])).toEqual(['少了测试'])
    expect(done.hidden).toBe(1)
    // Ticked again: it comes back next time.
    dismissFindings(root, [dismissKey('a.ts', '命名不清')], true)
    writeFileSync(join(root, 'a.ts'), 'export const a = 7\n')
    await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })
    await vi.waitFor(() => expect(o.sent.at(-1)?.comments).toHaveLength(2), { timeout: 10_000 })
  })

  it('reviews a Claude session with Codex when 另一家来审 is chosen', async () => {
    const root = repo('other')
    writeFileSync(join(root, 'a.ts'), 'export const a = 8\n')
    fake('codex', `while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then printf '%s' '{"findings":[],"summary":"Codex 看过了"}' > "$2"; fi; shift; done`)
    review = { ...DEFAULT_SETTINGS.review, reviewer: 'other', codexModel: 'gpt-5.5', model: 'opus' }
    const o = owner()
    expect(await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })).toMatchObject({ phase: 'running', agent: 'codex', message: '正在用 Codex 审阅…' })
    expect(await settled(o, root)).toMatchObject({ phase: 'done', agent: 'codex', message: 'Codex 看过了' })
    const argv = readFileSync(join(bin, 'codex.argv'), 'utf8').split('\n')
    expect(argv[argv.indexOf('--model') + 1]).toBe('gpt-5.5')
    review = { ...DEFAULT_SETTINGS.review }
  })

  it('falls back to the session\'s own CLI when the other one is missing', () => {
    const only = (agent: string) => (agent === 'claude' ? '/bin/claude' : null)
    expect(pickReviewer('claude', 'other', only)).toEqual({ agent: 'claude', binary: '/bin/claude', fellBack: true })
    expect(pickReviewer('codex', 'other', only)).toEqual({ agent: 'claude', binary: '/bin/claude', fellBack: false })
    expect(pickReviewer('claude', 'same', only)).toEqual({ agent: 'claude', binary: '/bin/claude', fellBack: false })
    expect(pickReviewer('codex', 'same', only)).toBeNull()
  })

  it('fails without comments when the reviewer does not return the schema', async () => {
    const root = repo('codex-bad')
    writeFileSync(join(root, 'a.ts'), 'export const a = 2\n')
    // Codex 0.142.5 does not check the schema itself: it writes whatever the model said into -o.
    fake('codex', `while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then printf '{"title":"nope"}' > "$2"; fi; shift; done`)
    const o = owner()
    await startReview(o as never, { root, agent: 'codex', trigger: 'manual' })
    const done = await settled(o, root)
    expect(done.phase).toBe('failed')
    expect(done.comments).toBeUndefined()
    expect(readFileSync(join(bin, 'codex.argv'), 'utf8').split('\n')).toEqual(expect.arrayContaining(['exec', '--sandbox', 'read-only', '--output-schema', '-']))
  })

  it('reports the exit code and stderr of a reviewer that failed', async () => {
    const root = repo('claude-fail')
    writeFileSync(join(root, 'a.ts'), 'export const a = 3\n')
    fake('claude', `echo 'not logged in' >&2; exit 3`)
    const o = owner()
    await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })
    const done = await settled(o, root)
    expect(done.phase).toBe('failed')
    expect(done.message).toContain('退出码 3')
    expect(done.message).toContain('not logged in')
  })

  it('cancels a running review, and a new diff replaces the running one', async () => {
    const root = repo('slow')
    writeFileSync(join(root, 'a.ts'), 'export const a = 4\n')
    fake('claude', `sleep 30`)
    const o = owner()
    await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })
    expect((await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })).phase).toBe('running')
    writeFileSync(join(root, 'a.ts'), 'export const a = 5\n')
    await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })
    expect(o.sent.some((s) => s.phase === 'cancelled' && s.message.includes('改动变了'))).toBe(true)
    cancelReview(root)
    const last = await settled(o, root)
    expect(last).toMatchObject({ phase: 'cancelled', message: '已取消审阅' })
  })

  it('skips automatic triggers that are off, and nothing to review', async () => {
    const root = repo('auto')
    const o = owner()
    expect((await startReview(o as never, { root, agent: 'claude', trigger: 'merge' })).message).toBe('自动审阅没有打开')
    expect((await startReview(o as never, { root, agent: 'claude', trigger: 'manual' })).message).toBe('没有要审阅的改动')
  })

  it('reviews after a turn only when HEAD moved and the switch is on', async () => {
    const root = repo('turn')
    git(root, 'switch', '-q', '-c', 'feat')
    fake('claude', `printf '%s' '${claudeJson([])}'`)
    const o = owner()
    review = { ...DEFAULT_SETTINGS.review, afterTurnWithCommits: true }
    await turnStarted(root)
    await turnEnded(o as never, root, 'claude')
    expect(o.sent).toHaveLength(0)
    await turnStarted(root)
    writeFileSync(join(root, 'b.ts'), 'export const b = 1\n')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'b')
    await turnEnded(o as never, root, 'claude')
    const done = await settled(o, root)
    expect(done).toMatchObject({ phase: 'done', trigger: 'turn', message: '看过了' })
    review = { ...DEFAULT_SETTINGS.review }
  })
})
