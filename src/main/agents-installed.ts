// Which agent CLIs are installed, for the first-run screen (phase 2b · B10). Agents start inside the user's
// login shell, where version managers (nvm, volta, asdf, …) extend PATH, so the check reads that shell's PATH
// rather than the app's own environment (which Finder launches with a minimal PATH).
import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { IPC, type AgentAvailability } from '@shared/ipc'

const TIMEOUT_MS = 5000
const CACHE_MS = 10_000
const AGENTS = ['claude', 'codex'] as const

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
  return { claude: found(AGENTS[0]), codex: found(AGENTS[1]) }
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

let cached: { at: number; result: Promise<AgentAvailability> } | null = null

export function detectAgents(shell: string = process.env.SHELL || '/bin/zsh'): Promise<AgentAvailability> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.result
  const result = loginShellPath(shell).then((path) => findOnPath(path ?? process.env.PATH ?? ''))
  cached = { at: now, result }
  return result
}

export function registerAgentDetection(): void {
  ipcMain.handle(IPC.appDetectAgents, () => detectAgents())
}
