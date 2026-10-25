// Which agent CLIs are installed, for the first-run screen (phase 2b · B10). Agents start inside the user's
// login shell, where version managers (nvm, volta, asdf, …) extend PATH, so the check reads that shell's PATH
// rather than the app's own environment (which Finder launches with a minimal PATH).
import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { AGENT_SPECS, CLI_AGENTS } from '@shared/agents'
import { IPC, type AgentAvailability, type AgentVersions } from '@shared/ipc'

const TIMEOUT_MS = 5000
const CACHE_MS = 10_000

/** PATH from `env` output; rc files may print noise before it, so the last PATH= line wins. */
export function pathFromEnvOutput(output: string): string | null {
  const line = output
    .split('\n')
    .filter((l) => l.startsWith('PATH='))
    .pop()
  return line ? line.slice('PATH='.length).trim() || null : null
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Whether each name is an executable file in one of PATH's directories. */
export function findOnPath(pathValue: string, isExecutable: (path: string) => boolean = isExecutableFile): AgentAvailability {
  const dirs = pathValue.split(':').filter((d) => d.startsWith('/'))
  const found = (name: string) => dirs.some((dir) => isExecutable(join(dir, name)))
  return Object.fromEntries(CLI_AGENTS.map((id) => [id, found(AGENT_SPECS[id].binary)])) as AgentAvailability
}

function loginShellPath(shell: string): Promise<string | null> {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(shell, ['-l', '-i', '-c', 'env'], { stdio: ['ignore', 'pipe', 'ignore'] })
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < 1_000_000) output += chunk.toString('utf8')
    })
    child.once('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.once('close', () => {
      clearTimeout(timer)
      resolve(pathFromEnvOutput(output))
    })
  })
}

let loginPathOnce: Promise<string | null> | null = null

/**
 * PATH of the user's interactive login shell, read once per app run: what a background process needs to find
 * `claude` / `codex` the way a terminal would (PRD F13).
 */
export function userLoginPath(shell: string = process.env.SHELL || '/bin/zsh'): Promise<string | null> {
  loginPathOnce ??= loginShellPath(shell)
  return loginPathOnce
}

/** The executable `name` on `pathValue`, or null. */
export function executableOnPath(pathValue: string, name: string, isExecutable: (path: string) => boolean = isExecutableFile): string | null {
  for (const dir of pathValue.split(':')) {
    if (!dir.startsWith('/')) continue
    const candidate = join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

let cached: { at: number; result: Promise<AgentAvailability> } | null = null

export function detectAgents(shell: string = process.env.SHELL || '/bin/zsh'): Promise<AgentAvailability> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.result
  const result = loginShellPath(shell).then((path) => findOnPath(path ?? process.env.PATH ?? ''))
  cached = { at: now, result }
  return result
}

/** The first version-looking token of a `--version` output (`codex-cli 0.164.0` → `0.164.0`), or null. */
export function versionFromOutput(output: string): string | null {
  return /\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(output)?.[1] ?? null
}

function runVersion(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    let output = ''
    // stdin closed and no TTY: a CLI that would prompt or start its TUI gets EOF instead of waiting.
    const child = spawn(path, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', CI: '1' } })
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
    const take = (chunk: Buffer): void => {
      if (output.length < 4096) output += chunk.toString('utf8')
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.once('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.once('close', () => {
      clearTimeout(timer)
      resolve(versionFromOutput(output))
    })
  })
}

let versionsOnce: Promise<AgentVersions> | null = null

/** `--version` of every installed agent CLI, once per app run (设置 · 智能体). */
export function agentVersions(shell: string = process.env.SHELL || '/bin/zsh'): Promise<AgentVersions> {
  versionsOnce ??= userLoginPath(shell).then(async (loginPath) => {
    const pathValue = loginPath ?? process.env.PATH ?? ''
    const entries = await Promise.all(
      CLI_AGENTS.map(async (id) => {
        const path = executableOnPath(pathValue, AGENT_SPECS[id].binary)
        return path ? ([id, await runVersion(path)] as const) : null
      })
    )
    return Object.fromEntries(entries.filter((e) => e !== null)) as AgentVersions
  })
  return versionsOnce
}

export function registerAgentDetection(): void {
  ipcMain.handle(IPC.appDetectAgents, () => detectAgents())
  ipcMain.handle(IPC.appAgentVersions, () => agentVersions().catch(() => ({})))
}
