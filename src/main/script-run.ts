// Runs one approved repository script outside a terminal and keeps the tail of its output (PRD F4 · 合并前测试).
// Same login shell and `/bin/sh -e` as the Run button, so PATH matches a terminal. The child is its own process
// group: cancelling kills the script and whatever it started.
import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { appendScriptOutput, runShellArgs } from '@shared/script-launch'
import { buildPtyEnv, resolveShell } from '../pty-host/env'

const KILL_GRACE_MS = 1000

export interface CapturedRun {
  /** Null when the process was cancelled or never started. */
  code: number | null
  output: string
  cancelled: boolean
}

interface Job {
  child: ChildProcess
  cancelled: boolean
  output: string
  killTimer?: ReturnType<typeof setTimeout>
  settle: (result: CapturedRun) => void
}

const jobs = new Map<string, Job>()

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (pid === undefined) return
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // already gone
    }
  }
}

function finish(key: string, job: Job, result: CapturedRun): void {
  if (jobs.get(key) === job) jobs.delete(key)
  if (job.killTimer) clearTimeout(job.killTimer)
  job.settle(result)
}

/**
 * Runs `script` in `cwd`. A second start for the same `key` cancels the first. `baseEnv` is the app environment
 * (the user's SHELL); `extraEnv` wins, which is how TR_PORT is injected and cannot be overridden by the script's
 * own assignment before the shell starts.
 */
export function startCapturedScript(options: {
  key: string
  cwd: string
  script: string
  baseEnv: NodeJS.ProcessEnv
  extraEnv?: Record<string, string>
}): Promise<CapturedRun> {
  cancelCapturedScript(options.key)
  const env = buildPtyEnv(options.baseEnv, options.extraEnv)
  const shell = resolveShell(env).command
  const child = spawn(shell, runShellArgs(options.script), {
    cwd: options.cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let settled = false
  let resolveRun: (result: CapturedRun) => void = () => {}
  const done = new Promise<CapturedRun>((resolve) => {
    resolveRun = resolve
  })
  const job: Job = {
    child,
    cancelled: false,
    output: '',
    settle: (result) => {
      if (settled) return
      settled = true
      resolveRun(result)
    }
  }
  const decoder = new StringDecoder('utf8')
  const onData = (chunk: Buffer): void => {
    job.output = appendScriptOutput(job.output, decoder.write(chunk))
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('error', () => {
    job.output = appendScriptOutput(job.output, decoder.end())
    finish(options.key, job, { code: null, output: job.output, cancelled: job.cancelled })
  })
  child.on('close', (code) => {
    job.output = appendScriptOutput(job.output, decoder.end())
    finish(options.key, job, { code: job.cancelled ? null : code, output: job.output, cancelled: job.cancelled })
  })
  jobs.set(options.key, job)
  return done
}

/** Stops the run for `key`, if there is one. The promise resolves with `cancelled: true`. */
export function cancelCapturedScript(key: string): void {
  const job = jobs.get(key)
  if (!job || job.cancelled) return
  job.cancelled = true
  killGroup(job.child, 'SIGTERM')
  job.killTimer = setTimeout(() => killGroup(job.child, 'SIGKILL'), KILL_GRACE_MS)
}

export function cancelAllCapturedScripts(): void {
  for (const key of [...jobs.keys()]) cancelCapturedScript(key)
}
