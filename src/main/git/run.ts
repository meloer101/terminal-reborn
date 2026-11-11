// How main runs git and the CLIs next to it (gh, agents' one-shot runs): one way to start a process, feed it, bound
// its time and output, and read its exit; and the environment git always gets (never a prompt, the PATH Finder lacks).
// Each module keeps what is its own (a longer timeout for a push, no optional locks while an agent works, an editor
// that never opens) and passes it in. Architecture review, batch 8: these were a dozen copies that had drifted apart.
import { spawn, type ChildProcess } from 'node:child_process'
import { delimiter } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { userLoginPath } from '../agents-installed'

/** A read-only command's time (status, rev-parse, log): longer ones (commit hooks, push, fetch) pass their own. */
export const GIT_TIMEOUT_MS = 15_000
const MAX_STDOUT = 8 * 1024 * 1024
const MAX_STDERR = 8 * 1024
/** Where Homebrew and the system keep git and gh: an app started from Finder gets a minimal PATH. */
export const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
/** For commands that only read while an agent may be writing: never take the index lock (status would refresh it). */
export const NO_OPTIONAL_LOCKS: Readonly<Record<string, string>> = { GIT_OPTIONAL_LOCKS: '0' }

export interface Ran {
  /** The exit code; -1 when it could not start, was stopped (timeout) or printed more than it may. */
  code: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeout: number
  /** Keep only about this many characters of the end of stdout (a long log). */
  tail?: number
  /** Stop and fail (code -1) once stdout is longer than this (default 8 MiB). */
  maxStdout?: number
  input?: string
}

/** Runs a program; never rejects (a spawn error is code -1). */
export function runProcess(bin: string, args: readonly string[], options: RunOptions): Promise<Ran> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let overflow = false
    let settled = false
    const maxStdout = options.maxStdout ?? MAX_STDOUT
    const out = new StringDecoder('utf8')
    const err = new StringDecoder('utf8')
    const child = spawn(bin, [...args], { cwd: options.cwd, env: options.env, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    if (options.input !== undefined) {
      child.stdin?.on('error', () => {})
      child.stdin?.end(options.input)
    }
    const timer = setTimeout(() => {
      stderr += `\n超过 ${Math.round(options.timeout / 1000)} 秒没有结束，已停止`
      child.kill('SIGTERM')
    }, options.timeout)
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdout += out.end()
      resolve({ code: overflow ? -1 : code, stdout, stderr: (stderr + err.end()).slice(-MAX_STDERR) })
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += out.write(chunk)
      if (options.tail !== undefined) {
        if (stdout.length > options.tail * 2) stdout = stdout.slice(-options.tail)
      } else if (stdout.length > maxStdout && !overflow) {
        overflow = true
        stderr += `\n输出超过 ${Math.round(maxStdout / 1024 / 1024)} MiB，已停止`
        child.kill('SIGTERM')
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + err.write(chunk)).slice(-MAX_STDERR)
    })
    child.once('error', (error) => {
      stderr += error.message
      finish(-1)
    })
    child.once('close', (code) => finish(code ?? -1))
  })
}

/**
 * Stops a child started `detached` (its own process group) and whatever it started — also after the child itself
 * exited: what it left running (a job holding the output open, an MCP server) is what is still to stop. The group's id
 * is not handed out again while any of them lives.
 */
export function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // already gone
    }
  }
}

/** The end of what a command printed, on one line (an error to show). */
export const lastLines = (text: string, lines = 3, max = 500): string => text.trim().split('\n').slice(-lines).join(' ').slice(0, max)

/** The app's PATH with EXTRA_PATH after it. */
export const appPath = (): string => [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_PATH].join(delimiter)

/**
 * git always speaks English: the failure classes (src/shared/git-failures.ts) and the parsers read its words, and a
 * gettext-built git (Homebrew's) translates them under a Chinese login locale. UTF-8, so non-ASCII paths still work;
 * the hooks git runs inherit it, as under VS Code's git.
 */
const ENGLISH: Readonly<Record<string, string>> = { LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8', LANGUAGE: 'en' }

/** git's environment: never a credential prompt, the app's PATH; `extra` wins, except over the English locale. */
export function gitEnv(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', PATH: appPath(), ...extra, ...ENGLISH }
}

/**
 * Arguments for Wavi's own merges, rebases, fetches and pushes with what the user's git config would change about them
 * pinned on the command line (git-config: merge.ff / autoStash / log, branch.<name>.mergeOptions, rebase.autoSquash /
 * autoStash / updateRefs / rebaseMerges / backend, fetch.prune / pruneTags / recurseSubmodules, remote.<name>.prune /
 * pruneTags / tagOpt, push.followTags / recurseSubmodules / pushOption, submodule.recurse). Signing (commit.gpgSign,
 * push.gpgSign, merge.verifySignatures) and hooks stay the user's. Wavi never runs `git pull` (it fetches and merges
 * `--ff-only`), so pull.ff / pull.rebase never apply.
 */
export const pinned = {
  /** The caller says --ff, --ff-only or --no-ff. */
  merge: (...args: string[]): string[] => ['-c', 'merge.autoStash=false', 'merge', '--no-squash', '--commit', '--no-log', ...args],
  rebase: (...args: string[]): string[] => [
    ...['-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', '-c', 'rebase.rebaseMerges=false', '-c', 'rebase.backend=merge'],
    'rebase',
    '--no-autosquash',
    '--no-autostash',
    ...args
  ],
  fetch: (...args: string[]): string[] => ['fetch', '--no-prune', '--no-prune-tags', '--no-recurse-submodules', '--no-tags', ...args],
  push: (...args: string[]): string[] => ['-c', 'push.pushOption=', 'push', '--no-follow-tags', '--recurse-submodules=no', ...args]
}

export interface GitOptions {
  timeout?: number
  env?: Readonly<Record<string, string>>
  input?: string
  maxStdout?: number
}

/** Runs git; never rejects. */
export function runGit(cwd: string, args: readonly string[], options: GitOptions = {}): Promise<Ran> {
  return runProcess('git', args, {
    cwd,
    env: gitEnv(options.env),
    timeout: options.timeout ?? GIT_TIMEOUT_MS,
    ...(options.maxStdout !== undefined ? { maxStdout: options.maxStdout } : {}),
    ...(options.input !== undefined ? { input: options.input } : {})
  })
}

/**
 * stdout of git, or a rejection when its exit code is not in `ok` (default 0). `message` words the rejection (default:
 * the last lines git printed); the modules differ in how much of git's output they show.
 */
export async function gitText(cwd: string, args: readonly string[], options: GitOptions & { ok?: readonly number[]; message?: (ran: Ran) => string } = {}): Promise<string> {
  const { ok = [0], message, ...rest } = options
  const ran = await runGit(cwd, args, rest)
  if (ok.includes(ran.code)) return ran.stdout
  throw new Error((message ? message(ran) : lastLines(ran.stderr || ran.stdout)) || `git exited with ${ran.code}`)
}

/** git without optional locks (an agent may be writing in the same worktree; status would refresh the index); never rejects. */
export function git(cwd: string, args: readonly string[], options: GitOptions = {}): Promise<Ran> {
  return runGit(cwd, args, { ...options, env: { ...NO_OPTIONAL_LOCKS, ...options.env } })
}

/** stdout of `git` (no optional locks), '' when it failed. */
export async function gitOut(cwd: string, args: readonly string[]): Promise<string> {
  const ran = await git(cwd, args)
  return ran.code === 0 ? ran.stdout : ''
}

/** Whether `ref` names a commit. */
export async function refExists(cwd: string, ref: string): Promise<boolean> {
  return (await git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])).code === 0
}

/** The login shell's PATH (where gh and the agents' CLIs are) with EXTRA_PATH after it. */
export async function searchPath(): Promise<string> {
  const login = await userLoginPath()
  return [...(login ?? process.env.PATH ?? '').split(delimiter), ...EXTRA_PATH].filter(Boolean).join(delimiter)
}

/**
 * ssh for fetch and push, never prompting: the user's own command (GIT_SSH_COMMAND, core.sshCommand) with BatchMode
 * added, so multi-account keys and agents keep working. GIT_SSH (a program, not a command line) is left alone.
 */
export function sshCommandFor(env: NodeJS.ProcessEnv, coreSshCommand: string): string | null {
  if (env.GIT_SSH_COMMAND) return `${env.GIT_SSH_COMMAND} -o BatchMode=yes`
  if (coreSshCommand) return `${coreSshCommand} -o BatchMode=yes`
  if (env.GIT_SSH) return null
  return 'ssh -o BatchMode=yes'
}

/** The environment a fetch or push in `cwd` needs on top of gitEnv: ssh that never prompts. */
export async function pushEnv(cwd: string): Promise<Record<string, string>> {
  const ssh = sshCommandFor(process.env, (await gitOut(cwd, ['config', '--get', 'core.sshCommand'])).trim())
  return ssh ? { GIT_SSH_COMMAND: ssh } : {}
}
