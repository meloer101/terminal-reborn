// Main-process side of the terminal. The PTYs live in the pty daemon (src/pty-daemon), a detached process that
// outlives the app so agents keep running across quits and a relaunch reattaches (PRD §6.8).
// When the daemon cannot be reached, the pty-host utilityProcess takes over for this run (sessions then end with
// the app). Main relays renderer IPC <-> host messages and validates every renderer payload.
import { app, ipcMain, utilityProcess, type WebContents } from 'electron'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { agentShellArgs } from '@shared/agent-launch'
import { IPC, type LivePtySession, type PtyAttachResult, type PtySpawnOptions } from '@shared/ipc'
import { hostRestartDelay, type HostRestartedEvent } from '@shared/lifecycle'
import { runShellArgs, SCRIPT_MARKER_OSC, SETUP_DONE_PAYLOAD, setupCommand } from '@shared/script-launch'
import { buildPtyEnv, resolveShell } from '../../pty-host/env'
import type { HostEvent, HostRequest, HostSessionInfo } from '../../pty-host/protocol'
import {
  adoptAgentSession,
  armStartWatchdog,
  endAgentSession,
  handleRelayedHook,
  prepareAgentLaunch,
  prepareShellLaunch,
  setHookTarget,
  type AgentLaunchHooks
} from '../hooks'
import { approvedScript, portFor } from '../repo-scripts'
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
  /** Daemon only: a logout / restart / shutdown is under way, so its SIGTERM may end the sessions. */
  systemShutdown?(): void
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
const sessionRootListeners = new Set<() => void>()
/** Agent launches whose setup script is still running, with the tail of their output: the start watchdog waits. */
const awaitingSetup = new Map<string, string>()
const SETUP_DONE_MARKER = `\x1b]${SCRIPT_MARKER_OSC};${SETUP_DONE_PAYLOAD}\x07`
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
    shutdown: () => connection.shutdown(true),
    systemShutdown: () => connection.systemShutdown()
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
      notifySessionRoots()
      break
    }
    case 'spawn-error': {
      awaitingSetup.delete(event.id)
      sessions.delete(event.id)
      endAgentSession(event.id)
      settle(pendingSpawns, event.id)?.reject(new Error(event.message))
      notifySessionRoots()
      break
    }
    case 'data': {
      watchSetup(event.id, event.data)
      const session = sessions.get(event.id)
      if (session && !session.owner.isDestroyed()) session.owner.send(IPC.ptyData, { sessionId: event.id, data: event.data, seq: event.seq })
      break
    }
    case 'exit': {
      awaitingSetup.delete(event.id)
      const session = sessions.get(event.id)
      if (!session) break
      sessions.delete(event.id)
      endAgentSession(event.id)
      notifyExit(session.owner, event.id, event.exitCode, event.signal)
      notifySessionRoots()
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
      // Plain terminals too: an agent started in one by hand reports through the same hooks (PRD F11).
      else adoptAgentSession(event.id, session.owner, event.hooks)
      notifySessionRoots()
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
      notifySessionRoots()
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

/** The setup runner said it is done: from now on the agent should report SessionStart within the usual time. */
function watchSetup(id: string, data: string): void {
  const tail = awaitingSetup.get(id)
  if (tail === undefined) return
  const seen = tail + data
  if (!seen.includes(SETUP_DONE_MARKER)) {
    awaitingSetup.set(id, seen.slice(-SETUP_DONE_MARKER.length))
    return
  }
  awaitingSetup.delete(id)
  armStartWatchdog(id)
}

/** The real folder a terminal starts in, or null when it is missing (the host then falls back to the home folder). */
function realCwdOf(cwd: string): string | null {
  try {
    return realpathSync(cwd)
  } catch {
    return null
  }
}

/**
 * A spawn that runs one of the repository's approved scripts (PtySpawnOptions.script): main builds the login shell's
 * arguments itself — `run` alone, or `setup` followed by the agent / shell — so the pty host needs nothing new.
 */
async function scriptLaunch(
  options: PtySpawnOptions,
  realCwd: string | null,
  env: Record<string, string>,
  hooks: AgentLaunchHooks | null
): Promise<{ command: string; args: string[] } | null> {
  if (!options.script) return null
  if (!realCwd) throw new Error(`the folder ${options.cwd} does not exist`)
  const script = await approvedScript(realCwd, options.script)
  const shell = resolveShell(buildPtyEnv(appEnv(), env)).command
  if (options.script === 'run') return { command: shell, args: runShellArgs(script) }
  const args = agentShellArgs(options.agent ?? 'shell', realCwd, shell, {
    ...(hooks?.settingsPath ? { claudeSettingsPath: hooks.settingsPath } : {}),
    ...(hooks?.codexConfig ? { codexConfig: hooks.codexConfig } : {}),
    ...(options.resumeAgentSessionId ? { resumeAgentSessionId: options.resumeAgentSessionId } : {}),
    before: setupCommand(script)
  })
  return { command: shell, args }
}

async function spawnSession(owner: WebContents, options: PtySpawnOptions): Promise<{ pid: number }> {
  const id = options.sessionId
  const agent = options.agent !== undefined && options.agent !== 'shell' ? options.agent : undefined
  if (options.script === 'run' && agent) throw new Error('the run script starts in a plain terminal')
  // An agent in a missing directory is refused rather than quietly started in the home directory (phase 2a · A8).
  if (options.command === undefined && agent) assertCwdExists(options.cwd)
  // Re-spawning an id (e.g. after a renderer reload) makes the host replace the old process.
  sessions.set(id, { owner })
  awaitingSetup.delete(id)

  // Agent sessions get their hook environment and the per-launch `--settings` file. Our TR_* keys
  // come last so the renderer cannot spoof them. Every terminal of a worktree gets the worktree's TR_PORT (PRD F4).
  const setup = options.script === 'setup' && agent !== undefined
  const realCwd = realCwdOf(options.cwd)
  const hooks = options.command === undefined ? await prepareAgentLaunch(id, owner, options.agent, { deferStartWatchdog: setup, cwd: realCwd ?? options.cwd }) : null
  // A plain terminal gets the agent shims, so a `claude` / `codex` typed in it reports here too (PRD F11).
  const shellEnv =
    !agent && options.command === undefined && !options.script
      ? await prepareShellLaunch(id, owner, {
          shell: resolveShell(buildPtyEnv(appEnv(), options.env ?? {})).command,
          base: { ...appEnv(), ...options.env },
          cwd: realCwd ?? options.cwd
        })
      : null
  const attached = hooks !== null || shellEnv !== null
  const port = realCwd ? portFor(realCwd) : null
  const env = { ...options.env, ...hooks?.env, ...shellEnv, ...(port !== null ? { TR_PORT: String(port) } : {}) }
  let launch: { command: string; args: string[] } | null
  try {
    launch = await scriptLaunch(options, realCwd, env, hooks)
  } catch (error) {
    sessions.delete(id)
    if (attached) endAgentSession(id)
    notifySessionRoots()
    throw error
  }
  await ensureHost()
  // The window went away (reload, close) while we were getting ready: starting the process now would orphan it.
  if (sessions.get(id)?.owner !== owner) {
    if (attached) endAgentSession(id)
    notifySessionRoots()
    throw new Error('the window went away before the terminal process started')
  }
  if (setup && hooks) awaitingSetup.set(id, '')

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSpawns.delete(id)
      sessions.delete(id)
      awaitingSetup.delete(id)
      endAgentSession(id)
      notifySessionRoots()
      // The host handles messages in order, so this lands right after the spawn it is still working on.
      // If it somehow slips past, handleHostEvent kills the late process when it reports in.
      if (link) send({ type: 'kill', id })
      reject(new Error('timed out starting the terminal process'))
    }, SPAWN_TIMEOUT_MS)
    pendingSpawns.set(id, { resolve, reject, timer })
    const { sessionId: _sessionId, env: _env, script: _script, ...rest } = options
    send({
      type: 'spawn',
      id,
      ...rest,
      ...(launch ?? {}),
      baseEnv: appEnv(),
      env,
      // A script launch has the hook flags in its arguments already.
      ...(hooks && !launch
        ? {
            ...(hooks.settingsPath ? { claudeSettingsPath: hooks.settingsPath } : {}),
            ...(hooks.codexConfig ? { codexConfig: hooks.codexConfig } : {})
          }
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
  let changed = false
  for (const [id, session] of sessions) {
    if (session.owner !== owner) continue
    sessions.delete(id)
    endAgentSession(id)
    send(keep ? { type: 'detach', id } : { type: 'kill', id })
    changed = true
  }
  if (changed) notifySessionRoots()
}

/** A window's renderer is gone (crash): its terminals are detached (daemon) or killed (fallback host). */
export function releaseSessionsOf(owner: WebContents): void {
  releaseOwner(owner)
}

/** Whether quitting now leaves the sessions running (the pty daemon is in use and no "end sessions" quit was asked for). */
export function quitKeepsSessions(): boolean {
  return link?.kind === 'daemon' && !endSessionsOnQuit
}

/** powerMonitor `shutdown` (logout, restart, shutdown): tell the daemon, which otherwise keeps sessions on SIGTERM. */
export function notifySystemShutdown(): void {
  link?.systemShutdown?.()
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

export interface SessionRoot {
  owner: WebContents
  sessionId: string
  pid: number
}

/** Live PTY roots. Port scanning uses this so it runs for every session, not only a watched browser tab. */
export function sessionRoots(): SessionRoot[] {
  const list: SessionRoot[] = []
  for (const [sessionId, session] of sessions) {
    if (session.pid !== undefined && !session.owner.isDestroyed()) list.push({ owner: session.owner, sessionId, pid: session.pid })
  }
  return list
}

/** Fires when a session gains a pid or leaves the map (the port scan starts or drops it). */
export function onSessionRootsChanged(listener: () => void): () => void {
  sessionRootListeners.add(listener)
  return () => sessionRootListeners.delete(listener)
}

function notifySessionRoots(): void {
  for (const listener of sessionRootListeners) listener()
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
