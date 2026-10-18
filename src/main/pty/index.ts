// Main-process side of the terminal. The PTYs live in the pty daemon (src/pty-daemon), a detached process that
// outlives the app so agents keep running across quits and a relaunch reattaches (PRD §6.8).
// When the daemon cannot be reached, the pty-host utilityProcess takes over for this run (sessions then end with
// the app). Main relays renderer IPC <-> host messages and validates every renderer payload.
import { app, ipcMain, utilityProcess, type WebContents } from 'electron'
import { join } from 'node:path'
import { IPC, type LivePtySession, type PtyAttachResult, type PtySpawnOptions } from '@shared/ipc'
import { hostRestartDelay, type HostRestartedEvent } from '@shared/lifecycle'
import type { HostEvent, HostRequest, HostSessionInfo } from '../../pty-host/protocol'
import { adoptAgentSession, endAgentSession, handleRelayedHook, prepareAgentLaunch, setHookTarget } from '../hooks'
import { daemonLocation, openDaemon } from './daemon-client'
import { shouldKillLateSpawn } from './late-spawn'
import { assertCwdExists } from './preflight'
import { parseAckCount, parseSessionId, parseSize, parseSpawnOptions, parseWriteData } from './validate'

const SPAWN_TIMEOUT_MS = 10_000
const ATTACH_TIMEOUT_MS = 5_000
/** Crashes older than this no longer count towards the restart backoff. */
const CRASH_WINDOW_MS = 60_000

interface LiveSession {
  owner: WebContents
  /** The PTY's root process (shell or agent), once spawned or attached. */
  pid?: number
}

interface Pending<T> {
  resolve(result: T): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/** Where the PTYs are: the daemon (survives the app) or the fallback utilityProcess (dies with it). */
interface HostLink {
  readonly kind: 'daemon' | 'utility'
  post(message: HostRequest): void
  /** Daemon: disconnect, sessions keep running. Utility: kill it and every session. */
  close(): void
  /** Daemon only: ask it to exit, ending every session. */
  shutdown?(): Promise<void>
}

let link: HostLink | null = null
let linking: Promise<HostLink> | null = null
/** Messages sent while no host is connected (it is starting or restarting). */
let queued: HostRequest[] = []
/** The daemon could not be reached at all: use the utilityProcess for the rest of this run. */
let daemonUnavailable = process.env.TR_PTY_DAEMON === '0'
/** Quit ends every session (the "退出并结束所有会话" menu item; e2e runs). Otherwise the daemon keeps them. */
let endSessionsOnQuit = process.env.TR_KILL_SESSIONS_ON_QUIT === '1'
let quitHandled = false

const sessions = new Map<string, LiveSession>()
const pendingSpawns = new Map<string, Pending<{ pid: number }>>()
const pendingAttaches = new Map<string, Pending<PtyAttachResult | null>>()
const pendingLists: Array<(sessions: HostSessionInfo[]) => void> = []
const watchedOwners = new WeakSet<WebContents>()
let crashTimes: number[] = []
let restartTimer: ReturnType<typeof setTimeout> | null = null

function forkUtility(): HostLink {
  const child = utilityProcess.fork(join(__dirname, 'pty-host.js'), [], { serviceName: 'wavi-pty-host' })
  const self: HostLink = {
    kind: 'utility',
    post: (message) => child.postMessage(message),
    close: () => {
      child.postMessage({ type: 'killAll' } satisfies HostRequest)
      child.kill()
    }
  }
  child.on('message', (event: HostEvent) => handleHostEvent(event))
  child.on('exit', (code) => {
    if (link !== self) return
    console.error(`[main] pty host exited unexpectedly (code ${code})`)
    handleHostCrash()
  })
  return self
}

async function connectDaemon(): Promise<HostLink> {
  let self: HostLink | null = null
  const connection = await openDaemon({
    userData: app.getPath('userData'),
    script: join(__dirname, 'pty-daemon.js'),
    appVersion: app.getVersion(),
    handlers: {
      onEvent: (event) => handleHostEvent(event),
      onHook: (hook) => handleRelayedHook(hook),
      onLost: () => {
        if (!self || link !== self) return
        console.error('[main] lost the pty daemon')
        handleHostCrash()
      }
    }
  })
  if (connection.hooks) setHookTarget({ ...connection.hooks, settingsDir: daemonLocation(app.getPath('userData')).dir })
  else setHookTarget(null)
  self = {
    kind: 'daemon',
    post: (message) => connection.post(message),
    close: () => connection.close(),
    shutdown: () => connection.shutdown(true)
  }
  return self
}

async function connectHost(): Promise<HostLink> {
  if (!daemonUnavailable) {
    try {
      return await connectDaemon()
    } catch (error) {
      daemonUnavailable = true
      console.error('[main] pty daemon unavailable; terminals will end with the app this run:', error)
    }
  }
  setHookTarget(null)
  return forkUtility()
}

function ensureHost(): Promise<HostLink> {
  if (link) return Promise.resolve(link)
  linking ??= connectHost().then((next) => {
    link = next
    linking = null
    const backlog = queued
    queued = []
    for (const message of backlog) next.post(message)
    return next
  })
  return linking
}

function send(message: HostRequest): void {
  if (link) {
    link.post(message)
    return
  }
  queued.push(message)
  void ensureHost()
}

/** The host died: every live terminal is gone with it. Tell each owner which sessions, and bring a host back. */
function handleHostCrash(): void {
  link = null
  const lostByOwner = new Map<WebContents, string[]>()
  for (const [id, session] of sessions) {
    endAgentSession(id)
    notifyExit(session.owner, id, -1)
    lostByOwner.set(session.owner, [...(lostByOwner.get(session.owner) ?? []), id])
  }
  sessions.clear()
  for (const [id, spawn] of pendingSpawns) {
    clearTimeout(spawn.timer)
    spawn.reject(new Error('pty host exited'))
    pendingSpawns.delete(id)
  }
  for (const [id, attach] of pendingAttaches) {
    clearTimeout(attach.timer)
    attach.resolve(null)
    pendingAttaches.delete(id)
  }
  for (const resolve of pendingLists.splice(0)) resolve([])

  const now = Date.now()
  crashTimes = [...crashTimes.filter((t) => now - t < CRASH_WINDOW_MS), now]
  // Restart in the background (with backoff for a crash loop). A spawn arriving earlier starts it lazily.
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    ensureHost().catch((error: unknown) => console.error('[main] could not restart the pty host:', error))
  }, hostRestartDelay(crashTimes.length))

  for (const [owner, sessionIds] of lostByOwner) {
    if (owner.isDestroyed()) continue
    owner.send(IPC.ptyHostRestarted, { sessionIds } satisfies HostRestartedEvent)
  }
}

function notifyExit(owner: WebContents, sessionId: string, exitCode: number, signal?: number): void {
  if (owner.isDestroyed()) return
  owner.send(IPC.ptyExit, { sessionId, exit: { exitCode, ...(signal ? { signal } : {}) } })
}

function settle<T>(map: Map<string, Pending<T>>, id: string): Pending<T> | undefined {
  const pending = map.get(id)
  if (!pending) return undefined
  clearTimeout(pending.timer)
  map.delete(id)
  return pending
}

function handleHostEvent(event: HostEvent): void {
  switch (event.type) {
    case 'spawned': {
      // Late news of a spawn main already gave up on: kill it rather than leave an invisible live process.
      if (shouldKillLateSpawn(sessions, event.id, link?.kind === 'daemon')) send({ type: 'kill', id: event.id })
      const spawned = sessions.get(event.id)
      if (spawned) spawned.pid = event.pid
      settle(pendingSpawns, event.id)?.resolve({ pid: event.pid })
      break
    }
    case 'spawn-error': {
      sessions.delete(event.id)
      endAgentSession(event.id)
      settle(pendingSpawns, event.id)?.reject(new Error(event.message))
      break
    }
    case 'data': {
      const session = sessions.get(event.id)
      if (session && !session.owner.isDestroyed()) session.owner.send(IPC.ptyData, { sessionId: event.id, data: event.data, seq: event.seq })
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
    case 'attached': {
      const pending = settle(pendingAttaches, event.id)
      const session = sessions.get(event.id)
      if (!pending || !session) {
        // Nobody waits for it any more (timed out, window gone): leave it running, unwatched.
        if (!event.exit) send({ type: 'detach', id: event.id })
        break
      }
      session.pid = event.pid
      if (event.exit) sessions.delete(event.id)
      else if (event.agent === 'claude' || event.agent === 'codex') adoptAgentSession(event.id, session.owner, event.hooks)
      pending.resolve({
        pid: event.pid,
        seq: event.seq,
        screen: event.screen,
        ...(event.exit ? { exit: event.exit } : {})
      })
      break
    }
    case 'attach-miss': {
      sessions.delete(event.id)
      settle(pendingAttaches, event.id)?.resolve(null)
      break
    }
    case 'sessions': {
      for (const resolve of pendingLists.splice(0)) resolve(event.sessions)
      break
    }
  }
}

/** Only string values: the app's environment as the base for new PTYs (the daemon's own may be days old). */
function appEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  return env
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
  await ensureHost()
  // The window went away (reload, close) while we were getting ready: starting the process now would orphan it.
  if (sessions.get(id)?.owner !== owner) {
    if (hooks) endAgentSession(id)
    throw new Error('the window went away before the terminal process started')
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSpawns.delete(id)
      sessions.delete(id)
      endAgentSession(id)
      // The host handles messages in order, so this lands right after the spawn it is still working on.
      // If it somehow slips past, handleHostEvent kills the late process when it reports in.
      if (link) send({ type: 'kill', id })
      reject(new Error('timed out starting the terminal process'))
    }, SPAWN_TIMEOUT_MS)
    pendingSpawns.set(id, { resolve, reject, timer })
    const { sessionId: _sessionId, env, ...rest } = options
    send({
      type: 'spawn',
      id,
      ...rest,
      baseEnv: appEnv(),
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

async function attachSession(owner: WebContents, id: string): Promise<PtyAttachResult | null> {
  const host = await ensureHost()
  if (host.kind !== 'daemon') return null
  const current = sessions.get(id)
  // Another live window drives it: not ours to take.
  if (current && current.owner !== owner && !current.owner.isDestroyed()) return null
  settle(pendingAttaches, id)?.resolve(null)
  sessions.set(id, { owner })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAttaches.delete(id)
      if (sessions.get(id)?.owner === owner) sessions.delete(id)
      resolve(null)
    }, ATTACH_TIMEOUT_MS)
    pendingAttaches.set(id, { resolve, reject, timer })
    send({ type: 'attach', id })
  })
}

/**
 * Asked once by each renderer load. A reload keeps the same WebContents, so sessions it still "owns" belong to the
 * page that is gone: detach them first, and they are listed for the new page to reattach.
 */
async function liveSessions(owner: WebContents): Promise<LivePtySession[]> {
  const host = await ensureHost()
  if (host.kind !== 'daemon') return []
  releaseOwner(owner)
  const listed = await new Promise<HostSessionInfo[]>((resolve) => {
    pendingLists.push(resolve)
    send({ type: 'list' })
  })
  return listed
    .filter((s) => !sessions.has(s.id))
    .map((s) => ({ sessionId: s.id, pid: s.pid, ...(s.agent ? { agent: s.agent } : {}), exited: s.exit !== undefined }))
}

/** A window is gone (closed, crashed, reloaded): with the daemon its sessions keep running for the next attach. */
function releaseOwner(owner: WebContents): void {
  const keep = link?.kind === 'daemon'
  for (const [id, session] of sessions) {
    if (session.owner !== owner) continue
    sessions.delete(id)
    endAgentSession(id)
    send(keep ? { type: 'detach', id } : { type: 'kill', id })
  }
}

/** A window's renderer is gone (crash): its terminals are detached (daemon) or killed (fallback host). */
export function releaseSessionsOf(owner: WebContents): void {
  releaseOwner(owner)
}

/** Whether quitting now leaves the sessions running (the pty daemon is in use and no "end sessions" quit was asked for). */
export function quitKeepsSessions(): boolean {
  return link?.kind === 'daemon' && !endSessionsOnQuit
}

/** The next quit ends every session (and the daemon) instead of leaving them running. */
export function endSessionsOnNextQuit(): void {
  endSessionsOnQuit = true
}

/** The PTY root process of a live session `owner` drives (port detection, PRD F14); undefined otherwise. */
export function sessionPid(owner: WebContents, sessionId: string): number | undefined {
  const session = sessions.get(sessionId)
  return session?.owner === owner ? session.pid : undefined
}

/** Only the window that spawned a session may drive it. */
function ownedSession(sender: WebContents, sessionIdRaw: unknown): string | null {
  const id = parseSessionId(sessionIdRaw)
  return sessions.get(id)?.owner === sender ? id : null
}

function watchOwner(owner: WebContents): void {
  if (watchedOwners.has(owner)) return
  watchedOwners.add(owner)
  owner.once('destroyed', () => releaseOwner(owner))
}

export function registerPtyHandlers(): void {
  // Connect (or launch) right away: the window's first attach should not wait for it.
  ensureHost().catch((error: unknown) => console.error('[main] could not start the pty host:', error))

  ipcMain.handle(IPC.ptySpawn, (event, raw: unknown) => {
    const options = parseSpawnOptions(raw)
    watchOwner(event.sender)
    return spawnSession(event.sender, options)
  })

  ipcMain.handle(IPC.ptyLive, (event) => liveSessions(event.sender))

  ipcMain.handle(IPC.ptyAttach, (event, sessionId: unknown) => {
    const id = parseSessionId(sessionId)
    watchOwner(event.sender)
    return attachSession(event.sender, id)
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
  app.on('will-quit', (event) => {
    if (restartTimer) clearTimeout(restartTimer)
    const current = link
    if (!current || quitHandled) return
    if (current.kind === 'daemon' && endSessionsOnQuit && current.shutdown) {
      // Wait (briefly) for the daemon to end the sessions, so none outlives an explicit "end everything".
      event.preventDefault()
      quitHandled = true
      void current.shutdown().finally(() => {
        link = null
        sessions.clear()
        app.quit()
      })
      return
    }
    quitHandled = true
    current.close()
    link = null
    sessions.clear()
  })
}
