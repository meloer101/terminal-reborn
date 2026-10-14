// Entry for the Electron utilityProcess that owns all node-pty instances.
// Talks to src/main/pty over process.parentPort using the messages in ./protocol.
import { accessSync, chmodSync, constants, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import * as nodePty from 'node-pty'
import { agentShellArgs } from '@shared/agent-launch'
import { OutputBatcher } from './batcher'
import { buildPtyEnv, resolveCwd, resolveShell } from './env'
import { FlowControl } from './flow-control'
import type { HostEvent, HostRequest, HostSpawnRequest } from './protocol'

interface PtySession {
  proc: nodePty.IPty
  batcher: OutputBatcher
  flow: FlowControl
  paused: boolean
}

const sessions = new Map<string, PtySession>()

function post(event: HostEvent): void {
  process.parentPort.postMessage(event)
}

/**
 * node-pty's prebuilt spawn-helper ships without the executable bit on some installs.
 * `postinstall` fixes it before packaging; this is a dev-time fallback that only touches the
 * file when it really isn't executable, so a packaged (signed) bundle is never modified.
 */
function ensureSpawnHelperExecutable(): void {
  try {
    const pkgDir = dirname(require.resolve('node-pty/package.json')).replace('app.asar', 'app.asar.unpacked')
    const helper = join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
    try {
      accessSync(helper, constants.X_OK)
    } catch {
      chmodSync(helper, 0o755)
    }
  } catch {
    // Source builds have no prebuilds directory; nothing to fix.
  }
}

/** Codex keys trust by real path (spike §6), so /tmp → /private/tmp matters. */
function realpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function spawn(request: HostSpawnRequest): void {
  const previous = sessions.get(request.id)
  if (previous) destroy(request.id, previous)

  const env = buildPtyEnv(process.env, request.env)
  const shell = resolveShell(env)
  const cwd = resolveCwd(request.cwd, homedir())
  const command = request.command ?? shell.command
  const args =
    request.command !== undefined
      ? (request.args ?? [])
      : request.agent && request.agent !== 'shell'
        ? agentShellArgs(request.agent, realpath(cwd), shell.command, {
            ...(request.claudeSettingsPath ? { claudeSettingsPath: request.claudeSettingsPath } : {}),
            ...(request.codexConfig ? { codexConfig: request.codexConfig } : {}),
            ...(request.resumeAgentSessionId ? { resumeAgentSessionId: request.resumeAgentSessionId } : {})
          })
        : shell.args

  let proc: nodePty.IPty
  try {
    proc = nodePty.spawn(command, args, {
      name: 'xterm-256color',
      cols: request.cols,
      rows: request.rows,
      cwd,
      env,
      encoding: 'utf8'
    })
  } catch (error) {
    post({ type: 'spawn-error', id: request.id, message: error instanceof Error ? error.message : String(error) })
    return
  }

  const batcher = new OutputBatcher((data) => post({ type: 'data', id: request.id, data }))
  const session: PtySession = { proc, batcher, flow: new FlowControl(), paused: false }
  sessions.set(request.id, session)

  proc.onData((data) => {
    batcher.append(data)
    if (session.flow.onOutput(data.length) && !session.paused) {
      session.paused = true
      proc.pause()
    }
  })
  proc.onExit(({ exitCode, signal }) => {
    batcher.flush()
    batcher.dispose()
    // A replaced session's late exit must not report on the new one.
    if (sessions.get(request.id) !== session) return
    sessions.delete(request.id)
    post({ type: 'exit', id: request.id, exitCode, ...(signal ? { signal } : {}) })
  })
  post({ type: 'spawned', id: request.id, pid: proc.pid })
}

function destroy(id: string, session: PtySession): void {
  sessions.delete(id)
  session.batcher.dispose()
  try {
    session.proc.kill()
  } catch {
    // Already gone.
  }
}

function handle(message: HostRequest): void {
  switch (message.type) {
    case 'spawn':
      spawn(message)
      break
    case 'write':
      sessions.get(message.id)?.proc.write(message.data)
      break
    case 'resize':
      try {
        sessions.get(message.id)?.proc.resize(message.cols, message.rows)
      } catch {
        // The PTY exited between the renderer's resize and now.
      }
      break
    case 'kill':
      sessions.get(message.id)?.proc.kill()
      break
    case 'ack': {
      const session = sessions.get(message.id)
      if (session?.flow.onAck(message.count) && session.paused) {
        session.paused = false
        session.proc.resume()
      }
      break
    }
    case 'killAll':
      for (const [id, session] of [...sessions]) destroy(id, session)
      break
  }
}

ensureSpawnHelperExecutable()
process.parentPort.on('message', (event) => handle(event.data as HostRequest))
