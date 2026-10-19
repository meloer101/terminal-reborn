// A repository's `.tr/settings.toml` scripts and the worktrees' TR_PORT blocks (PRD F4 · 脚本与端口), main side:
// reading the file from a worktree, asking before a repository's scripts run for the first time (and after they
// change), and handing approved scripts to PTY spawns. Approvals (a hash per repository) and port blocks live in
// `<userData>/repo-scripts.json`; nothing is written to the repository or to the user's agent config.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { IPC, type RepoScriptsInfo, type ScriptApproval, type ScriptRunResult } from '@shared/ipc'
import { allocatePortBlock, portOf } from '@shared/ports'
import {
  approvalDetail,
  approvalInput,
  MAX_SETTINGS_BYTES,
  parseRepoSettings,
  REPO_SETTINGS_FILE,
  sanitizeRepoScriptsStore,
  withApproval,
  type CapturedScript,
  type RepoScripts,
  type RepoScriptsStore,
  type RunnableScript
} from '@shared/repo-scripts'
import { cancelAllCapturedScripts, cancelCapturedScript, startCapturedScript } from './script-run'
import { confirm } from './confirm'
import { getSettings } from './settings'
import { resolveRoot } from './worktree-files'

const GIT_TIMEOUT_MS = 5_000
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
          PATH: [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_PATH].join(delimiter)
        }
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
  })
}

/** Hash of what an approval covers (every script of the file, see approvalInput). */
export function approvalHash(scripts: RepoScripts): string {
  return createHash('sha256').update(approvalInput(scripts)).digest('hex')
}

export interface RepoLocation {
  /** The worktree's top level (where `.tr/settings.toml` is read). */
  top: string
  /** Same for every worktree of a repository: its git common dir (the folder itself outside git). */
  key: string
}

/** Where `dir`'s settings file is and which repository approvals it shares. */
export async function locateRepo(realDir: string): Promise<RepoLocation> {
  const out = await git(realDir, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir']).catch(() => '')
  const [top, common] = out.split('\n').map((line) => line.trim())
  if (!top || !common || !isAbsolute(top) || !isAbsolute(common)) return { top: realDir, key: realDir }
  return { top, key: common.replace(/\/$/, '') }
}

/** The scripts `.tr/settings.toml` at `top` names; a missing file has none. */
export async function readRepoSettings(top: string): Promise<{ scripts: RepoScripts; problems: string[] }> {
  const path = join(top, REPO_SETTINGS_FILE)
  const info = await stat(path).catch(() => null)
  if (!info) return { scripts: {}, problems: [] }
  if (!info.isFile()) return { scripts: {}, problems: [`${REPO_SETTINGS_FILE} 不是文件`] }
  if (info.size > MAX_SETTINGS_BYTES) return { scripts: {}, problems: [`${REPO_SETTINGS_FILE} 太大（最多 64 KB）`] }
  return parseRepoSettings(await readFile(path, 'utf8'))
}

// --- the store -----------------------------------------------------------------------------------------------------

/** `<userData>/repo-scripts.json`: read once, changed in memory, written atomically in order. */
export class RepoScriptsFile {
  private data: RepoScriptsStore | null = null
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  get(): RepoScriptsStore {
    if (!this.data) {
      let raw: unknown = null
      try {
        raw = JSON.parse(readFileSync(this.path, 'utf8'))
      } catch {
        // missing or unreadable: start empty
      }
      this.data = sanitizeRepoScriptsStore(raw)
    }
    return this.data
  }

  update(change: (data: RepoScriptsStore) => RepoScriptsStore): void {
    this.data = change(this.get())
    const snapshot = JSON.stringify(this.data, null, 2)
    const tmp = `${this.path}.tmp`
    this.chain = this.chain
      .then(() => writeFile(tmp, snapshot))
      .then(() => rename(tmp, this.path))
      .catch((error: unknown) => console.error(`[repo-scripts] could not save ${this.path}`, error))
  }

  /** Resolves once every queued write settled (tests). */
  flushed(): Promise<void> {
    return this.chain
  }
}

let store: RepoScriptsFile | null = null
function file(): RepoScriptsFile {
  store ??= new RepoScriptsFile(join(app.getPath('userData'), 'repo-scripts.json'))
  return store
}

/**
 * First port of the block for the folder `realPath` (allocating one if it has none). Null when every block is taken:
 * the terminal then starts without TR_PORT rather than not at all.
 */
export function portFor(realPath: string, target: RepoScriptsFile = file(), base = getSettings().ports.base): number | null {
  const current = target.get()
  const result = allocatePortBlock(current.ports, realPath, base, existsSync)
  if (!result) return null
  if (current.ports[realPath] !== result.index || Object.keys(result.assigned).length !== Object.keys(current.ports).length) {
    target.update((data) => ({ ...data, ports: result.assigned }))
  }
  return portOf(base, result.index)
}

// --- approvals -----------------------------------------------------------------------------------------------------

export function isApproved(key: string, scripts: RepoScripts, target: RepoScriptsFile = file()): boolean {
  return target.get().approvals[key]?.includes(approvalHash(scripts)) ?? false
}

export function rememberApproval(key: string, scripts: RepoScripts, target: RepoScriptsFile = file()): void {
  const hash = approvalHash(scripts)
  target.update((data) => ({ ...data, approvals: { ...data.approvals, [key]: withApproval(data.approvals[key], hash) } }))
}

/** Sheets already on screen, by repository + content: a second session asking at the same time waits for the first. */
const asking = new Map<string, Promise<boolean>>()

function parseScriptName(value: unknown): RunnableScript | CapturedScript {
  if (value !== 'setup' && value !== 'run' && value !== 'test' && value !== 'archive') throw new Error('invalid script name')
  return value
}

function parseCapturedScript(value: unknown): CapturedScript {
  if (value !== 'test' && value !== 'archive') throw new Error('invalid script name')
  return value
}

/**
 * Cancel and run for one directory stay in order. The renderer fires cancel as a sheet closes and run as the next
 * one opens; without a queue the cancel can land on the run that just started.
 */
const runQueues = new Map<string, Promise<unknown>>()

function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = runQueues.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  runQueues.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  )
  return run
}

async function repoInfo(dirRaw: unknown): Promise<RepoScriptsInfo> {
  const dir = await resolveRoot(dirRaw)
  const { top } = await locateRepo(dir)
  const { scripts, problems } = await readRepoSettings(top)
  return { scripts, problems, port: portFor(dir) }
}

async function approve(owner: WebContents, dirRaw: unknown, nameRaw: unknown): Promise<ScriptApproval> {
  const name = parseScriptName(nameRaw)
  const dir = await resolveRoot(dirRaw)
  const { top, key } = await locateRepo(dir)
  const { scripts } = await readRepoSettings(top)
  if (scripts[name] === undefined) return 'none'
  if (isApproved(key, scripts)) return 'approved'
  const id = `${key}\0${approvalHash(scripts)}`
  let pending = asking.get(id)
  if (!pending) {
    const repoName = key.endsWith('/.git') ? key.slice(0, -5).split('/').pop() : top.split('/').pop()
    pending = confirm(
      {
        message: `运行仓库 ${repoName ?? ''} 的脚本？`,
        detail: approvalDetail(scripts),
        confirmLabel: '运行',
        cancelLabel: '不运行'
      },
      BrowserWindow.fromWebContents(owner)
    ).finally(() => asking.delete(id))
    asking.set(id, pending)
  }
  if (!(await pending)) return 'declined'
  rememberApproval(key, scripts)
  return 'approved'
}

/**
 * The approved script for a spawn in `realCwd` (PtySpawnOptions.script). Throws when the file has no such script or
 * it is not approved as it is now, so nothing runs that the user has not seen.
 */
export async function approvedScript(realCwd: string, name: RunnableScript | CapturedScript): Promise<string> {
  const { top, key } = await locateRepo(realCwd)
  const { scripts } = await readRepoSettings(top)
  const script = scripts[name]
  if (script === undefined) throw new Error(`${REPO_SETTINGS_FILE} has no ${name} script`)
  if (!isApproved(key, scripts)) throw new Error(`the ${name} script of ${REPO_SETTINGS_FILE} is not approved`)
  return script
}

async function runCaptured(dirRaw: unknown, nameRaw: unknown): Promise<ScriptRunResult> {
  const name = parseCapturedScript(nameRaw)
  const dir = await resolveRoot(dirRaw)
  const script = await approvedScript(dir, name)
  const port = portFor(dir)
  return startCapturedScript({
    key: dir,
    cwd: dir,
    script,
    baseEnv: process.env,
    ...(port !== null ? { extraEnv: { TR_PORT: String(port) } } : {})
  })
}

async function cancelCaptured(dirRaw: unknown): Promise<void> {
  try {
    cancelCapturedScript(await resolveRoot(dirRaw))
  } catch {
    if (typeof dirRaw === 'string') cancelCapturedScript(dirRaw)
  }
}

export function registerRepoScriptHandlers(): void {
  ipcMain.handle(IPC.repoScriptsGet, (_event, dir: unknown) => repoInfo(dir))
  ipcMain.handle(IPC.repoScriptsApprove, (event, dir: unknown, name: unknown) => approve(event.sender, dir, name))
  ipcMain.handle(IPC.repoScriptsRun, (_event, dir: unknown, name: unknown) => {
    const key = typeof dir === 'string' ? dir : ''
    return enqueue(key, () => runCaptured(dir, name))
  })
  ipcMain.handle(IPC.repoScriptsCancel, (_event, dir: unknown) => {
    const key = typeof dir === 'string' ? dir : ''
    return enqueue(key, () => cancelCaptured(dir))
  })
  app.on('before-quit', () => cancelAllCapturedScripts())
}
