// AI 写 (PRD F16 v1.68): gathers the git material for a commit message or a PR title / body and runs the user's own
// Claude / Codex headlessly over it (src/shared/ship-writer.ts has the prompt, argv and parsing). One run per worktree
// and kind (commit message / PR text): asking again cancels the earlier one. Nothing is committed or sent here — the text goes back to the sheet's fields.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { ipcMain } from 'electron'
import { untrackedFileDiff } from '@shared/background-review'
import { commitSubject, PR_IPC } from '@shared/pull-requests'
import {
  commitConventions,
  parseWriteRequest,
  parseWriterOutput,
  schemaFor,
  WRITER_DIFF_CHARS,
  writerArgv,
  writerPrompt,
  type WriteRequest,
  type WriteResult,
  type WriterAgent,
  type WriterMaterial
} from '@shared/ship-writer'
import { buildPtyEnv } from '../pty-host/env'
import { executableOnPath } from './agents-installed'
import { branchInfo, git, gitOut, prTemplate, refExists, searchPath, uncommittedFiles } from './pull-requests'
import { getSettings } from './settings'
import { isProjectRoot } from './workspace-store'

const RUN_TIMEOUT_MS = 120_000
const KILL_GRACE_MS = 2_000
const MAX_STDOUT = 2 * 1024 * 1024
/** Untracked files read into a commit diff: at most this many, each cut to this size. */
const MAX_UNTRACKED_FILES = 40
const MAX_UNTRACKED_BYTES = 8 * 1024

const running = new Map<string, ChildProcess>()

const fail = (message: string): WriteResult => ({ ok: false, message })

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

/** `git diff HEAD` of the ticked tracked files plus the start of each ticked untracked file. */
async function uncommittedDiff(cwd: string, paths: readonly string[]): Promise<string> {
  const wanted = new Set(paths)
  const files = (await uncommittedFiles(cwd)).filter((f) => wanted.has(f.path))
  const tracked = files.filter((f) => !f.untracked).flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path]))
  const parts: string[] = []
  if (tracked.length > 0) {
    const ran = await git(cwd, ['diff', '--no-color', '--no-ext-diff', '-M', 'HEAD', '--', ...tracked], { env: { GIT_LITERAL_PATHSPECS: '1' } })
    if (ran.code === 0) parts.push(ran.stdout)
  }
  for (const file of files.filter((f) => f.untracked).slice(0, MAX_UNTRACKED_FILES)) {
    const content = await readFile(join(cwd, file.path))
      .then((buffer) => buffer.subarray(0, MAX_UNTRACKED_BYTES))
      .catch(() => null)
    if (!content) continue
    parts.push(content.includes(0) ? `新文件 ${file.path}（二进制）\n` : untrackedFileDiff(file.path, content.toString('utf8')))
  }
  return parts.join('\n')
}

async function conventions(cwd: string): Promise<string> {
  const texts = await Promise.all(['CLAUDE.md', 'AGENTS.md'].map((name) => readFile(join(cwd, name), 'utf8').then((t) => t.slice(0, 64 * 1024)).catch(() => '')))
  return commitConventions(texts.join('\n'))
}

async function material(request: WriteRequest, cwd: string, branch: string, base: string, remote: string | null): Promise<WriterMaterial> {
  const [recent, rules] = await Promise.all([
    gitOut(cwd, ['log', '--no-merges', '--max-count=10', '--format=%s']).then((out) => out.split('\n').filter(Boolean)),
    conventions(cwd)
  ])
  const pending = request.paths.length > 0 ? await uncommittedDiff(cwd, request.paths) : ''
  if (request.kind === 'commit') return { diff: pending, recentSubjects: recent, conventions: rules }
  const remoteBase = remote ? `refs/remotes/${remote}/${base}` : null
  const baseRef = remoteBase && (await refExists(cwd, remoteBase)) ? remoteBase : `refs/heads/${base}`
  const [subjects, diffstat, committed, template] = await Promise.all([
    gitOut(cwd, ['log', '--reverse', '--max-count=100', '--format=%s', `${baseRef}..refs/heads/${branch}`, '--']).then((out) => out.split('\n').filter(Boolean)),
    gitOut(cwd, ['diff', '--no-color', '--stat=120', `${baseRef}...refs/heads/${branch}`, '--']),
    gitOut(cwd, ['diff', '--no-color', '--no-ext-diff', '-M', `${baseRef}...refs/heads/${branch}`, '--']),
    prTemplate(cwd)
  ])
  const subject = request.pendingMessage ? commitSubject(request.pendingMessage) : ''
  return {
    // The branch's own diff first (cut to the budget), then the commit about to be made.
    diff: [committed.slice(0, WRITER_DIFF_CHARS), pending].filter(Boolean).join('\n'),
    recentSubjects: recent,
    subjects: subject ? [...subjects, subject] : subjects,
    diffstat,
    template,
    conventions: rules
  }
}

function run(key: string, binary: string, args: string[], prompt: string, cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string; cancelled: boolean }> {
  return new Promise((resolve) => {
    const earlier = running.get(key)
    if (earlier) killGroup(earlier, 'SIGTERM')
    const child = spawn(binary, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    running.set(key, child)
    const out = new StringDecoder('utf8')
    const err = new StringDecoder('utf8')
    let stdout = ''
    let stderr = ''
    let cancelled = false
    let settled = false
    const timer = setTimeout(() => {
      stderr += `\n超过 ${RUN_TIMEOUT_MS / 1000} 秒没有结束，已停止`
      killGroup(child, 'SIGTERM')
      setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS).unref()
    }, RUN_TIMEOUT_MS)
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (running.get(key) === child) running.delete(key)
      else cancelled = true
      resolve({ code, stdout: stdout + out.end(), stderr: (stderr + err.end()).slice(-4000), cancelled })
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT) stdout += out.write(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + err.write(chunk)).slice(-4000)
    })
    child.once('error', (error) => {
      stderr += error.message
      finish(null)
    })
    child.once('close', (code) => finish(code))
    child.stdin?.on('error', () => {})
    child.stdin?.end(prompt)
  })
}

/** Writes a commit message or a PR title / body for the sheet. */
export async function writeShipText(raw: unknown): Promise<WriteResult> {
  const request = parseWriteRequest(raw)
  if (!request || !isProjectRoot(request.root)) return fail('请求无效')
  const info = await branchInfo(request)
  if (!info) return fail('不是这个项目的 worktree')
  if (!info.branch) return fail('处于分离 HEAD')
  if (!info.base || info.base === info.branch) return fail('这是基线分支本身')

  const path = await searchPath()
  const order: WriterAgent[] = request.agent === 'claude' ? ['claude', 'codex'] : ['codex', 'claude']
  const agent = order.find((name) => executableOnPath(path, name))
  if (!agent) return fail('没有找到 claude 或 codex：装好其中一个后再试')
  const binary = executableOnPath(path, agent)!
  const settings = getSettings().pr
  const model = agent === 'claude' ? settings.writerClaudeModel : settings.writerCodexModel

  const facts = await material(request, info.cwd, info.branch, info.base, info.remote ?? 'origin')
  if (!facts.diff.trim()) return fail(request.kind === 'commit' ? '勾选的文件没有改动' : '分支没有比基线新的改动')

  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'wavi-writer-'))
    const schemaPath = join(dir, 'schema.json')
    const outputPath = join(dir, 'out.json')
    if (agent === 'codex') await writeFile(schemaPath, JSON.stringify(schemaFor(request.kind)))
    const argv = writerArgv({ agent, kind: request.kind, model, schemaPath, outputPath })
    const ran = await run(`${request.worktree}\0${request.kind}`, binary, argv.slice(1), writerPrompt(request.kind, facts), info.cwd, buildPtyEnv(process.env, { PATH: path }))
    if (ran.cancelled) return fail('已取消')
    const output = agent === 'codex' ? await readFile(outputPath, 'utf8').catch(() => '') : ran.stdout
    const parsed = parseWriterOutput(request.kind, output || ran.stdout)
    if (!parsed.ok) {
      const tail = ran.stderr.trim().split('\n').slice(-2).join(' ')
      return fail(`${agent === 'claude' ? 'Claude' : 'Codex'} 没写出来：${parsed.reason}${ran.code !== 0 && tail ? `（${tail.slice(0, 300)}）` : ''}`)
    }
    return 'message' in parsed
      ? { ok: true, kind: 'commit', message: parsed.message, agent, model }
      : { ok: true, kind: 'pr', title: parsed.title, body: parsed.body, agent, model }
  } finally {
    if (dir) void rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Stops the worktree's runs, if any (the sheet closed). */
export function cancelShipText(worktree: unknown): void {
  if (typeof worktree !== 'string') return
  for (const kind of ['commit', 'pr']) {
    const key = `${worktree}\0${kind}`
    const child = running.get(key)
    if (!child) continue
    running.delete(key)
    killGroup(child, 'SIGTERM')
  }
}

export function registerPrWriter(): void {
  ipcMain.handle(PR_IPC.write, (_event, raw: unknown) => writeShipText(raw))
  ipcMain.on(PR_IPC.cancelWrite, (_event, worktree: unknown) => cancelShipText(worktree))
}
