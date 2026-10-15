// Main-process side of the terminal: forks the pty-host utilityProcess and relays
// renderer IPC <-> host messages. All payloads from the renderer are validated here.
import { app, ipcMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { join } from 'node:path'
import { IPC, type PtySpawnOptions } from '@shared/ipc'
import { hostRestartDelay, type HostRestartedEvent } from '@shared/lifecycle'
import type { HostEvent, HostRequest } from '../../pty-host/protocol'
import { endAgentSession, prepareAgentLaunch } from '../hooks'
import { isOrphanSpawn } from './late-spawn'
import { assertCwdExists } from './preflight'
import { parseAckCount, parseSessionId, parseSize, parseSpawnOptions, parseWriteData } from './validate'

const SPAWN_TIMEOUT_MS = 10_000
/** Crashes older than this no longer count towards the restart backoff. */
const CRASH_WINDOW_MS = 60_000

interface LiveSession {
  owner: WebContents
}

interface PendingSpawn {
  resolve(result: { pid: number }): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

let host: UtilityProcess | null = null
const sessions = new Map<string, LiveSession>()
const pending = new Map<string, PendingSpawn>()
const watchedOwners = new WeakSet<WebContents>()
let crashTimes: number[] = []
let restartTimer: ReturnType<typeof setTimeout> | null = null

function ensureHost(): UtilityProcess {
  if (host) return host
  const child = utilityProcess.fork(join(__dirname, 'pty-host.js'), [], { serviceName: 'terminal-reborn-pty-host' })
  child.on('message', (event: HostEvent) => handleHostEvent(event))
  child.on('exit', (code) => {
    if (host !== child) return
    host = null
    console.error(`[main] pty host exited unexpectedly (code ${code})`)
    handleHostCrash()
  })
  host = child
  return child
}

/** The host died: every live terminal is gone with it. Tell each owner which sessions, and bring a host back. */
function handleHostCrash(): void {
  const lostByOwner = new Map<WebContents, string[]>()
  for (const [id, session] of sessions) {
    endAgentSession(id)
    notifyExit(session.owner, id, -1)
    lostByOwner.set(session.owner, [...(lostByOwner.get(session.owner) ?? []), id])
  }
  sessions.clear()
  for (const [id, spawn] of pending) {
    clearTimeout(spawn.timer)
    spawn.reject(new Error('pty host exited'))
    pending.delete(id)
  }

  const now = Date.now()
  crashTimes = [...crashTimes.filter((t) => now - t < CRASH_WINDOW_MS), now]
  // Restart in the background (with backoff for a crash loop). A spawn arriving earlier forks it lazily.
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    try {
      ensureHost()
    } catch (error) {
      console.error('[main] could not restart the pty host:', error)
    }
  }, hostRestartDelay(crashTimes.length))

  for (const [owner, sessionIds] of lostByOwner) {
    if (owner.isDestroyed()) continue
    owner.send(IPC.ptyHostRestarted, { sessionIds } satisfies HostRestartedEvent)
  }
}

function send(message: HostRequest): void {
  ensureHost().postMessage(message)
}

function notifyExit(owner: WebContents, sessionId: string, exitCode: number, signal?: number): void {
  if (owner.isDestroyed()) return
  owner.send(IPC.ptyExit, { sessionId, exit: { exitCode, ...(signal ? { signal } : {}) } })
}

function handleHostEvent(event: HostEvent): void {
  switch (event.type) {
    case 'spawned': {
      // Late news of a spawn main already gave up on: kill it rather than leave an invisible live process.
      if (isOrphanSpawn(sessions, event.id)) send({ type: 'kill', id: event.id })
      const spawn = pending.get(event.id)
      if (!spawn) break
      clearTimeout(spawn.timer)
      pending.delete(event.id)
      spawn.resolve({ pid: event.pid })
      break
    }
    case 'spawn-error': {
      sessions.delete(event.id)
      endAgentSession(event.id)
      const spawn = pending.get(event.id)
      if (!spawn) break
      clearTimeout(spawn.timer)
      pending.delete(event.id)
      spawn.reject(new Error(event.message))
      break
    }
    case 'data': {
      const session = sessions.get(event.id)
      if (session && !session.owner.isDestroyed()) session.owner.send(IPC.ptyData, { sessionId: event.id, data: event.data })
      break
    }
    case 'exit': {
      const session = sessions.get(event.id)
      if (!session) break
      sessions.delete(event.id)
      endAgentSession(event.id)
      notifyExit(session.owner, event.id, event.exitCode, event.signal)
      break
    }
  }
}

async function spawnSession(owner: WebContents, options: PtySpawnOptions): Promise<{ pid: number }> {
  const id = options.sessionId
  // An agent in a missing directory is refused rather than quietly started in the home directory (phase 2a · A8).
  if (options.command === undefined && options.agent !== undefined && options.agent !== 'shell') assertCwdExists(options.cwd)
  // Re-spawning an id (e.g. after a renderer reload) makes the host replace the old process.
  sessions.set(id, { owner })

  // Agent sessions get their hook environment and the per-launch `--settings` file. Our TR_* keys
  // come last so the renderer cannot spoof them.
  const hooks = options.command === undefined ? await prepareAgentLaunch(id, owner, options.agent) : null

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      sessions.delete(id)
      endAgentSession(id)
      // The host handles messages in order, so this lands right after the spawn it is still working on.
      // If it somehow slips past, handleHostEvent kills the late process when it reports in.
      if (host) send({ type: 'kill', id })
      reject(new Error('timed out starting the terminal process'))
    }, SPAWN_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    const { sessionId: _sessionId, env, ...rest } = options
    send({
      type: 'spawn',
      id,
      ...rest,
      ...(hooks
        ? {
            env: { ...env, ...hooks.env },
            ...(hooks.settingsPath ? { claudeSettingsPath: hooks.settingsPath } : {}),
            ...(hooks.codexConfig ? { codexConfig: hooks.codexConfig } : {})
          }
        : env
          ? { env }
          : {})
    })
  })
}

/** Kills every terminal a window owns (its renderer crashed or the window is gone). */
export function releaseSessionsOf(owner: WebContents): void {
  killOwnedBy(owner)
}

function killOwnedBy(owner: WebContents): void {
  for (const [id, session] of sessions) {
    if (session.owner !== owner) continue
    sessions.delete(id)
    endAgentSession(id)
    send({ type: 'kill', id })
  }
}

/** Only the window that spawned a session may drive it. */
function ownedSession(sender: WebContents, sessionIdRaw: unknown): string | null {
  const id = parseSessionId(sessionIdRaw)
  return sessions.get(id)?.owner === sender ? id : null
}

export function registerPtyHandlers(): void {
  ipcMain.handle(IPC.ptySpawn, (event, raw: unknown) => {
    const options = parseSpawnOptions(raw)
    const owner = event.sender
    if (!watchedOwners.has(owner)) {
      watchedOwners.add(owner)
      owner.once('destroyed', () => killOwnedBy(owner))
    }
    return spawnSession(owner, options)
  })

  ipcMain.on(IPC.ptyWrite, (event, sessionId: unknown, data: unknown) => {
    const id = ownedSession(event.sender, sessionId)
    if (id) send({ type: 'write', id, data: parseWriteData(data) })
  })

  ipcMain.on(IPC.ptyResize, (event, sessionId: unknown, cols: unknown, rows: unknown) => {
    const id = ownedSession(event.sender, sessionId)
    if (id) send({ type: 'resize', id, ...parseSize(cols, rows) })
  })

  ipcMain.on(IPC.ptyKill, (event, sessionId: unknown) => {
    const id = ownedSession(event.sender, sessionId)
    if (id) send({ type: 'kill', id })
  })

  ipcMain.on(IPC.ptyAck, (event, sessionId: unknown, count: unknown) => {
    const id = ownedSession(event.sender, sessionId)
    if (id) send({ type: 'ack', id, count: parseAckCount(count) })
  })

  // `will-quit` (not `before-quit`): the quit guard may still cancel a quit after before-quit fired.
  app.on('will-quit', () => {
    if (restartTimer) clearTimeout(restartTimer)
    if (!host) return
    host.postMessage({ type: 'killAll' } satisfies HostRequest)
    host.kill()
    host = null
    sessions.clear()
  })
}
