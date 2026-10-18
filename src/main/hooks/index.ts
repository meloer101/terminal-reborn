// Electron glue for the hook bridge: owns the hook socket + generated settings file for this app run,
// hands agent PTYs their env, and forwards bridge signals to the window that owns the session.
// Reliability (phase 2a): the socket lives under userData and is supervised (supervisor.ts); health and
// per-session "no hooks" / "no SessionStart" signals reach the renderer on IPC.agentHooksHealth / agentSessionHooks.
import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { HooksHealth, PermissionDecision, SessionHooksSignal } from '@shared/agent-events'
import type { AgentKind } from '@shared/types'
import type { HookJournalEntry } from '../../pty-host/protocol'
import { HookBridge, type BridgeEmitter } from './bridge'
import { CodexConfigCache, prepareCodexHookConfig } from './codex-probe'
import { DaemonHookEndpoint, type DaemonHookTarget } from './daemon-endpoint'
import { createHookDir, sweepStaleHookDirs } from './hook-dir'
import { UnknownSessionError } from './server'
import { buildClaudeHookSettings } from './settings'
import { StartWatchdog } from './start-watchdog'
import { HookSupervisor } from './supervisor'
import { sourceRoot } from '../source-checkout'

export interface AgentLaunchHooks {
  /** TR_SESSION_ID / TR_HOOK_SOCK / TR_HOOK_TOKEN for the PTY environment. */
  env: Record<string, string>
  /** The `--settings` file for Claude. */
  settingsPath?: string
  /** `-c` override values for Codex (hook definitions + trust pins); empty when its hooks could not be prepared. */
  codexConfig?: string[]
}

/** Where agents' hooks go: our own supervised server, or the pty daemon's socket (then hooks are relayed to us). */
interface HookEndpoint {
  readonly socketPath: string
  readonly token: string
  readonly settingsPath: string
  readonly health: HooksHealth
  check(): Promise<HooksHealth>
  stop(): Promise<void>
}

interface Runtime {
  bridge: HookBridge
  supervisor: HookEndpoint
  /** Codex's trust hashes are asked of the installed `codex` once per app run (failures for a few minutes). */
  codex: CodexConfigCache
}

const owners = new Map<string, WebContents>()
let runtime: Promise<Runtime | null> | null = null
let startFailure: HooksHealth = { ok: false, reason: 'server-unavailable', detail: 'hook server not started' }

const DECISIONS: ReadonlySet<unknown> = new Set<PermissionDecision>(['allow-once', 'allow-always', 'deny'])

/** `resources/hooks/tr-hook.sh`: in the checkout in dev and in the linked app, in Contents/Resources/hooks when packaged. */
export function hookScriptPath(): string {
  const checkout = sourceRoot()
  if (checkout) return join(checkout, 'resources', 'hooks', 'tr-hook.sh')
  return app.isPackaged ? join(process.resourcesPath, 'hooks', 'tr-hook.sh') : join(app.getAppPath(), 'resources', 'hooks', 'tr-hook.sh')
}

function ownerOf(sessionId: string): WebContents | null {
  const owner = owners.get(sessionId)
  return owner && !owner.isDestroyed() ? owner : null
}

function sendSessionSignal(owner: WebContents | null, signal: SessionHooksSignal): void {
  if (owner && !owner.isDestroyed()) owner.send(IPC.agentSessionHooks, signal)
}

const watchdog = new StartWatchdog((sessionId, afterMs) => sendSessionSignal(ownerOf(sessionId), { sessionId, kind: 'start-timeout', afterMs }))

function broadcastHealth(health: HooksHealth): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.agentHooksHealth, health)
  }
}

const emitter: BridgeEmitter = {
  event: (envelope) => {
    // Any hook traffic proves the hooks reach us; withdraw the "silent since launch" countdown.
    watchdog.disarm(envelope.sessionId)
    ownerOf(envelope.sessionId)?.send(IPC.agentEvent, envelope)
  },
  prompt: (prompt) => ownerOf(prompt.sessionId)?.send(IPC.agentPrompt, prompt),
  resolved: (resolution) => ownerOf(resolution.sessionId)?.send(IPC.agentPromptResolved, resolution),
  canDeliver: (sessionId) => ownerOf(sessionId) !== null
}

/** `TR_HOOKS_CHECK_MS` lets e2e fault-injection runs shorten the self-check interval. */
function checkIntervalOverride(): { intervalMs?: number } {
  const ms = Number(process.env.TR_HOOKS_CHECK_MS)
  return Number.isFinite(ms) && ms >= 100 ? { intervalMs: ms } : {}
}

/** Settled by the pty layer once it knows whether the daemon serves the hook socket (null: we serve it ourselves). */
let decideTarget: (target: DaemonHookTarget | null) => void = () => undefined
const targetDecision = new Promise<DaemonHookTarget | null>((resolve) => {
  decideTarget = resolve
})
/** Never wait longer than this for the pty layer: hooks then run on our own server. */
const TARGET_DECISION_TIMEOUT_MS = 8000

/** Called once by src/main/pty when its host is up: the daemon's hook socket, or null for the fallback host. */
export function setHookTarget(target: DaemonHookTarget | null): void {
  decideTarget(target)
}

async function start(): Promise<Runtime | null> {
  const target = await Promise.race([
    targetDecision,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), TARGET_DECISION_TIMEOUT_MS).unref())
  ])
  if (target) {
    try {
      const bridge = new HookBridge(emitter, { holdPermissions: false })
      const supervisor = new DaemonHookEndpoint({
        target,
        settings: () => buildClaudeHookSettings(hookScriptPath()),
        onHealth: broadcastHealth,
        ...checkIntervalOverride()
      })
      await supervisor.start()
      const codex = new CodexConfigCache(() => prepareCodexHookConfig(hookScriptPath(), process.env.SHELL || '/bin/zsh'))
      return { bridge, supervisor, codex }
    } catch (error) {
      console.error('[hooks] could not use the pty daemon hook socket:', error)
      startFailure = { ok: false, reason: 'server-unavailable', detail: error instanceof Error ? error.message : String(error) }
      return null
    }
  }
  try {
    const userData = app.getPath('userData')
    const dir = createHookDir({ userData })
    // Leftovers of earlier runs (including the old $TMPDIR/tr-hooks-* layout); never blocks startup.
    void sweepStaleHookDirs({ userData, keep: dir }).then((removed) => {
      if (removed.length > 0) console.log(`[hooks] removed ${removed.length} stale hook director${removed.length === 1 ? 'y' : 'ies'}`)
    })
    // No in-app answering UI: permission requests are announced, never held (the TUI answers them).
    const bridge = new HookBridge(emitter, { holdPermissions: false })
    const supervisor = new HookSupervisor({
      dir,
      handler: (request) => bridge.handle(request),
      settings: () => buildClaudeHookSettings(hookScriptPath()),
      onHealth: broadcastHealth,
      ...checkIntervalOverride()
    })
    // Never rejects; an unavailable server shows up in supervisor.health and is retried by the self-check.
    await supervisor.start()
    const codex = new CodexConfigCache(() => prepareCodexHookConfig(hookScriptPath(), process.env.SHELL || '/bin/zsh'))
    return { bridge, supervisor, codex }
  } catch (error) {
    // Agents still work without hooks; the sidebar just falls back to its slower signals.
    console.error('[hooks] could not set up the hook server:', error)
    startFailure = { ok: false, reason: 'server-unavailable', detail: error instanceof Error ? error.message : String(error) }
    return null
  }
}

export function registerHookHandlers(): void {
  runtime = start()

  ipcMain.handle(IPC.agentGetHooksHealth, async (): Promise<HooksHealth> => {
    const rt = await runtime
    return rt ? rt.supervisor.health : startFailure
  })

  ipcMain.on(IPC.agentRespondPermission, (event, promptId: unknown, decision: unknown) => {
    if (typeof promptId !== 'string' || promptId.length > 128 || !DECISIONS.has(decision)) return
    void runtime?.then((rt) => {
      if (!rt) return
      // Only the window that owns the session may answer for it.
      const sessionId = rt.bridge.sessionOfPrompt(promptId)
      if (sessionId === undefined || owners.get(sessionId) !== event.sender) return
      rt.bridge.respondPermission(promptId, decision as PermissionDecision)
    })
  })

  app.on('before-quit', () => {
    const pending = runtime
    runtime = null
    owners.clear()
    watchdog.clear()
    void pending?.then((rt) => rt?.supervisor.stop())
  })
}

/**
 * Called by the pty layer before spawning an agent. Returns null for shells and when hooks are unavailable
 * (then the owner gets a `SessionHooksSignal` of kind 'unavailable'). Claude gets a `--settings` file; Codex gets
 * `-c` overrides (PRD §6.7).
 */
export async function prepareAgentLaunch(sessionId: string, owner: WebContents, agent: AgentKind | undefined): Promise<AgentLaunchHooks | null> {
  if (agent !== 'claude' && agent !== 'codex') return null
  const rt = await runtime
  // A cheap self-check per launch: an agent must not inherit a socket that is already gone.
  const health = rt ? await rt.supervisor.check() : startFailure
  if (!rt || !health.ok) {
    sendSessionSignal(owner, { sessionId, kind: 'unavailable', reason: 'server-unavailable', ...(health.ok ? {} : { detail: health.detail }) })
    return null
  }
  const env = { TR_SESSION_ID: sessionId, TR_HOOK_SOCK: rt.supervisor.socketPath, TR_HOOK_TOKEN: rt.supervisor.token }
  if (agent === 'claude') {
    owners.set(sessionId, owner)
    rt.bridge.attach(sessionId)
    watchdog.arm(sessionId)
    return { env, settingsPath: rt.supervisor.settingsPath }
  }
  const codex = await rt.codex.get()
  // Without trusted hooks Codex would skip ours, so there is nothing to attach (status falls back to titles).
  if (!codex.ok) {
    sendSessionSignal(owner, { sessionId, kind: 'unavailable', reason: codex.reason, detail: codex.detail })
    return null
  }
  owners.set(sessionId, owner)
  rt.bridge.attach(sessionId)
  watchdog.arm(sessionId)
  return { env, codexConfig: codex.config }
}

/**
 * A window reattached to an agent that kept running in the pty daemon: route its hook events to that window again.
 * No start watchdog: the agent started long ago.
 */
export function adoptAgentSession(sessionId: string, owner: WebContents, missed: readonly HookJournalEntry[] = []): void {
  owners.set(sessionId, owner)
  void runtime?.then(async (rt) => {
    if (!rt) return
    rt.bridge.attach(sessionId)
    // What happened while the app was closed (a finished turn, a permission prompt) brings the status up to date.
    const signal = new AbortController().signal
    for (const entry of missed) {
      await rt.bridge
        .handle({ event: entry.event, sessionId, agent: entry.agent, payload: entry.payload ?? undefined, signal, receivedAt: entry.at })
        .catch(() => undefined)
    }
  })
}

/** A hook the pty daemon relays from an agent of an attached session; answers like our own server would. */
export async function handleRelayedHook(request: {
  sessionId: string
  event: string
  agent: 'claude' | 'codex'
  payload: unknown
}): Promise<{ status: number; body: string }> {
  const rt = await runtime
  if (!rt) return { status: 404, body: '' }
  try {
    const body = await rt.bridge.handle({ ...request, payload: request.payload ?? undefined, signal: new AbortController().signal })
    return { status: 200, body }
  } catch (error) {
    return { status: error instanceof UnknownSessionError ? 404 : 500, body: '' }
  }
}

/** The session's PTY ended (exit, kill, host crash): release holds and withdraw its prompts. */
export function endAgentSession(sessionId: string): void {
  watchdog.disarm(sessionId)
  const owner = owners.get(sessionId)
  if (!owner || !runtime) return
  void runtime.then((rt) => {
    rt?.bridge.detach(sessionId)
    // A re-spawn under the same id may have attached a new owner meanwhile.
    if (owners.get(sessionId) === owner) owners.delete(sessionId)
  })
}
