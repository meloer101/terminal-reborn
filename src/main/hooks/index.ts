// Electron glue for the hook bridge: owns the hook socket + generated settings file for this app run,
// hands agent PTYs their env, and forwards bridge signals to the window that owns the session.
// Reliability (phase 2a): the socket lives under userData and is supervised (supervisor.ts); health and
// per-session "no hooks" / "no SessionStart" signals reach the renderer on IPC.agentHooksHealth / agentSessionHooks.
import { app, ipcMain, type WebContents } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { AgentEvent, AgentEventEnvelope, HookAgent, HooksHealth, PendingPrompt, PermissionDecision, PromptResolution, SessionHooksSignal } from '@shared/agent-events'
import type { ContextHistory, SessionSpend, UsageAccount, UsageAlert, UsageVendor, VendorUsage } from '@shared/session-meta'
import type { AgentKind } from '@shared/types'
import type { HookJournalEntry } from '../../pty-host/protocol'
import { cliAdapterLaunch } from './cli-adapters'
import { CodexAccountClient, readClaudeAccountUsage } from './account-usage'
import { AgentTitleWatcher } from './agent-title'
import { SubagentWatcher } from './subagents'
import { WorkflowWatcher } from './workflows'
import { HookBridge, type BridgeEmitter } from './bridge'
import { CodexConfigCache, prepareCodexHookConfig } from './codex-probe'
import { CodexUsageWatcher } from './codex-usage'
import { DaemonHookEndpoint, relayOutlastsHold, type DaemonHookTarget } from './daemon-endpoint'
import { PERMISSION_TIMEOUT_MS } from './permission-registry'
import { createHookDir, sweepStaleHookDirs } from './hook-dir'
import { UnknownSessionError, type HookRequest } from './server'
import { isDispatchEvent } from '../dispatch/broker'
import { buildClaudeHookSettings } from './settings'
import { shellIntegrationEnv, writeCodexOverrides, writeShims, type ShimDirs } from './shell-agents'
import { StartWatchdog } from './start-watchdog'
import { TranscriptMeter } from './transcript-meter'
import { HookSupervisor } from './supervisor'
import { packageScriptsReader } from './package-scripts'
import { claudeInterval, codexInterval, PlanUsagePoller } from './plan-usage-poller'
import { UsageStore } from './usage-store'
import { userStatusLineFor } from './user-statusline'
import { appWindows } from '../app-windows'
import { sourceRoot } from '../source-checkout'

export interface AgentLaunchHooks {
  /** TR_SESSION_ID / TR_HOOK_SOCK / TR_HOOK_TOKEN for the PTY environment. */
  env: Record<string, string>
  /** The `--settings` file for Claude. */
  settingsPath?: string
  /** `-c` override values for Codex (hook definitions + trust pins); empty when its hooks could not be prepared. */
  codexConfig?: string[]
  /** Arguments the other CLIs' adapters add after the binary (Gemini `--skip-trust`, Pi `-e <extension>`). */
  extraArgs?: string[]
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

/** The window that receives this session's hook events (PRD F21 sends its tool calls there too). */
export const sessionOwner = (sessionId: string): WebContents | null => ownerOf(sessionId)

let dispatchHandler: ((request: HookRequest) => Promise<string>) | null = null

/** src/main/dispatch takes what Claude's SessionStart hook reports about its inbox (WaviInbox, PRD F21). */
export function setDispatchHookHandler(handler: (request: HookRequest) => Promise<string>): void {
  dispatchHandler = handler
}

/** Dispatch requests go to src/main/dispatch, everything else to the bridge. */
function route(bridge: HookBridge, request: HookRequest): Promise<string> | string {
  if (isDispatchEvent(request.event)) return dispatchHandler ? dispatchHandler(request) : ''
  return bridge.handle(request)
}

function sendSessionSignal(owner: WebContents | null, signal: SessionHooksSignal): void {
  if (owner && !owner.isDestroyed()) owner.send(IPC.agentSessionHooks, signal)
}

const watchdog = new StartWatchdog((sessionId, afterMs) => sendSessionSignal(ownerOf(sessionId), { sessionId, kind: 'start-timeout', afterMs }))

function broadcastHealth(health: HooksHealth): void {
  for (const win of appWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.agentHooksHealth, health)
  }
}

/** Plan usage is the account's (PRD F11): every window gets it, and it is kept across runs. Created once userData is known. */
let usageStore: UsageStore | null = null

/** The account asked directly, per vendor (./plan-usage-poller.ts); none when `TR_ACCOUNT_USAGE=off` (e2e). */
let pollers: Partial<Record<UsageVendor, PlanUsagePoller>> = {}
let codexAccount: CodexAccountClient | null = null
/** What each account said when last asked this run (the 额度 page's status per vendor). */
const accounts = new Map<UsageVendor, UsageAccount>()

/** A one-off ask's figures (./plan-usage-poller.ts · show): to every window, not kept. */
function showUsage(usage: VendorUsage): void {
  for (const win of appWindows()) if (!win.webContents.isDestroyed()) win.webContents.send(IPC.agentUsage, usage)
}

function broadcastAccount(account: UsageAccount): void {
  accounts.set(account.vendor, account)
  for (const win of appWindows()) if (!win.webContents.isDestroyed()) win.webContents.send(IPC.agentUsageAccount, account)
}

function createPollers(): void {
  if (process.env.TR_ACCOUNT_USAGE === 'off') return
  const shell = process.env.SHELL || '/bin/zsh'
  const apply = (usage: VendorUsage) => usageStore?.update(usage)
  const log = (message: string) => console.log(`[usage] ${message}`)
  codexAccount = new CodexAccountClient(shell, apply)
  const codex = codexAccount
  pollers = {
    claude: new PlanUsagePoller({ vendor: 'claude', fetch: () => readClaudeAccountUsage(shell), apply, show: showUsage, account: broadcastAccount, interval: claudeInterval, minRefreshGapMs: 60_000, log }),
    codex: new PlanUsagePoller({ vendor: 'codex', fetch: () => codex.read(), apply, show: showUsage, account: broadcastAccount, interval: codexInterval, minRefreshGapMs: 15_000, log })
  }
  // Used before (held from an earlier run): keep it fresh at the slow pace until a session says more.
  for (const usage of usageStore?.list() ?? []) pollers[usage.vendor]?.start()
}

function stopPollers(): void {
  for (const poller of Object.values(pollers)) poller.stop()
  pollers = {}
  codexAccount?.close()
  codexAccount = null
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

function writeJson(file: string, value: unknown, what: string): void {
  try {
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
    renameSync(tmp, file)
  } catch (error) {
    console.error(`[hooks] could not save ${what}:`, error)
  }
}

function createUsageStore(): UsageStore {
  const file = join(app.getPath('userData'), 'plan-usage.json')
  const marks = join(app.getPath('userData'), 'usage-alerts.json')
  return new UsageStore({
    load: () => readJson(file),
    save: (usage) => writeJson(file, usage, 'plan usage'),
    loadMarks: () => readJson(marks),
    saveMarks: (list) => writeJson(marks, list, 'usage alerts'),
    // The account's alert is announced once, by one window (the renderer checks 设置 · 额度 · 提醒).
    alert: (alert: UsageAlert) => {
      const win = appWindows().find((w) => !w.webContents.isDestroyed())
      win?.webContents.send(IPC.agentUsageAlert, alert)
    },
    broadcast: (usage: VendorUsage) => {
      pollers[usage.vendor]?.observe(usage)
      for (const win of appWindows()) if (!win.webContents.isDestroyed()) win.webContents.send(IPC.agentUsage, usage)
    }
  })
}

/** Sessions whose agent is off its vendor's plan (AgentEvent `billing`): they say nothing about the account's use. */
const offPlan = new Set<string>()

function trackBilling(sessionId: string, event: AgentEvent): void {
  if (event.type === 'billing') {
    if (event.plan) offPlan.delete(sessionId)
    else offPlan.add(sessionId)
    transcripts.setPlan(sessionId, event.plan)
  } else if (event.type === 'agent-exit') {
    offPlan.delete(sessionId)
    transcripts.setPlan(sessionId, true)
  }
}

/** 手机远程 (PRD F22): what the phone server sees of the hooks. */
export interface RemoteHookListener {
  prompt(prompt: PendingPrompt): void
  resolved(resolution: PromptResolution): void
  /** Any hook of the session: its transcript may have grown. */
  activity(sessionId: string): void
  /** A question prompt can now be answered from the phone. */
  held(promptId: string): void
}

let remoteListener: RemoteHookListener | null = null
let remoteHolds: () => boolean = () => false

/** src/main/remote: listen to prompts and hook traffic, and hold permission requests while `holds()` (a phone is connected). */
export function setRemoteHooks(listener: RemoteHookListener | null, holds: () => boolean = () => false): void {
  remoteListener = listener
  remoteHolds = holds
}

/**
 * Whose permission requests are held while a phone is connected: Claude's only. Its TUI shows the dialog while the hook
 * waits (PRD §6.16); Codex shows nothing until the hook answers (§6.7), which would leave the desk without a dialog.
 * Never behind a pty daemon that answers the relay before the hold ends (an older daemon the app adopted).
 */
const holdsFor = (agent: HookAgent, sessionId: string): boolean => agent === 'claude' && !guiSessions.has(sessionId) && relayHolds && remoteHolds()

/**
 * GUI sessions (PRD F23): Claude runs headless and its `can_use_tool` answers each permission, so the hook must return
 * at once (§6.17); holding it for a phone would stall the GUI's own card.
 */
const guiSessions = new Set<string>()

/** src/main/gui marks its Claude sessions before launch (and unmarks them when they end). */
export function setGuiSession(sessionId: string, gui: boolean): void {
  if (gui) guiSessions.add(sessionId)
  else guiSessions.delete(sessionId)
}
/** Set once the hook target is known (`relayOutlastsHold`). */
let relayHolds = true

/** A permission answered on the phone; false when it is no longer pending. */
export async function respondFromRemote(promptId: string, decision: PermissionDecision): Promise<boolean> {
  const rt = await runtime
  return rt?.bridge.respondPermission(promptId, decision) ?? false
}

/** An AskUserQuestion answered on the phone (PRD §6.16); false when it can no longer be answered there. */
export async function answerFromRemote(promptId: string, answers: Record<string, string>): Promise<boolean> {
  const rt = await runtime
  return rt?.bridge.answerQuestion(promptId, answers) ?? false
}

/** Whether an answer from the phone would reach the agent (the request behind the prompt is held). */
export async function promptHeld(promptId: string): Promise<boolean> {
  const rt = await runtime
  return rt?.bridge.isHeld(promptId) ?? false
}

/** The session's transcript, once a hook has named it. */
export const transcriptSource = (sessionId: string): { agent: 'claude' | 'codex'; path: string } | null => transcripts.sourceOf(sessionId)

const emitter: BridgeEmitter = {
  event: (envelope) => {
    // Any hook traffic proves the hooks reach us; withdraw the "silent since launch" countdown.
    watchdog.disarm(envelope.sessionId)
    trackBilling(envelope.sessionId, envelope.event)
    // A session on a third-party endpoint does not make the account "in use" (it would be asked far more often).
    if (!offPlan.has(envelope.sessionId) && (envelope.agent === 'claude' || envelope.agent === 'codex')) pollers[envelope.agent]?.nudge()
    ownerOf(envelope.sessionId)?.send(IPC.agentEvent, envelope)
    remoteListener?.activity(envelope.sessionId)
  },
  prompt: (prompt) => {
    ownerOf(prompt.sessionId)?.send(IPC.agentPrompt, prompt)
    remoteListener?.prompt(prompt)
  },
  resolved: (resolution) => {
    ownerOf(resolution.sessionId)?.send(IPC.agentPromptResolved, resolution)
    remoteListener?.resolved(resolution)
  },
  canDeliver: (sessionId) => ownerOf(sessionId) !== null,
  held: (promptId) => remoteListener?.held(promptId),
  usage: (usage) => {
    usageStore?.update(usage)
    pollers[usage.vendor]?.nudge()
  }
}

/**
 * Status of a GUI session without hooks (Codex app-server, ACP; PRD F23), in the hook bridge's own vocabulary: to its
 * window like a hook's event, and to the phone server and the plan-usage pollers the same way.
 */
export function emitGuiAgentEvent(envelope: AgentEventEnvelope, owner: WebContents | null): void {
  if (!offPlan.has(envelope.sessionId) && (envelope.agent === 'claude' || envelope.agent === 'codex')) pollers[envelope.agent]?.nudge()
  if (owner && !owner.isDestroyed()) owner.send(IPC.agentEvent, envelope)
  remoteListener?.activity(envelope.sessionId)
}

/** The agents' own session titles, read back from their data files after hooks (PRD F2). */
const titles = new AgentTitleWatcher((sessionId, agent, title) =>
  emitter.event({ sessionId, agent, at: Date.now(), event: { type: 'agent-title', title } })
)

/** The subagents running inside each Claude session, read from its own files after hooks (PRD F21 v1.109). */
const subagents = new SubagentWatcher((sessionId, agent, items) =>
  emitter.event({ sessionId, agent, at: Date.now(), event: { type: 'subagents', items } })
)

/**
 * Claude's workflow runs in each terminal session, read from the run's own files after hooks (ultracode, PRD F25). GUI
 * sessions get theirs from stream-json (gui/claude-driver.ts).
 */
const workflows = new WorkflowWatcher(
  (sessionId, agent, runs) => emitter.event({ sessionId, agent, at: Date.now(), event: { type: 'workflows', runs } }),
  { skip: (sessionId) => guiSessions.has(sessionId) }
)

/** Context history and token spend per session, read from the agents' transcripts (Figma 18). */
const transcripts = new TranscriptMeter()

/** package.json scripts, so a turn's `npm run check` counts as the checks it runs (PRD F9 / F4). */
const scripts = packageScriptsReader()

/** Codex's context and plan usage, read from its rollout after its hooks (PRD F11, §6.7). */
const rollouts = new CodexUsageWatcher((sessionId, reading) => void runtime?.then((rt) => rt?.bridge.applyReading(sessionId, 'codex', reading)))

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

/** Whether agents' hooks go to the pty daemon's hook socket, which answers only for the processes the daemon hosts. */
export async function hooksViaDaemon(): Promise<boolean> {
  const rt = await runtime
  return rt?.supervisor instanceof DaemonHookEndpoint
}

async function start(): Promise<Runtime | null> {
  const target = await Promise.race([
    targetDecision,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), TARGET_DECISION_TIMEOUT_MS).unref())
  ])
  relayHolds = relayOutlastsHold(target, PERMISSION_TIMEOUT_MS)
  if (!relayHolds) console.warn('[hooks] the pty daemon answers permission relays before a phone could; nothing is held for the phone')
  if (target) {
    try {
      const bridge = new HookBridge(emitter, { holdPermissions: holdsFor, titles, rollouts, transcripts, subagents, workflows, scripts })
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
    // No in-app answering UI: permission requests are announced and answered in the TUI; held only while a paired
    // phone is connected (PRD F22), and the TUI dialog shows meanwhile all the same.
    const bridge = new HookBridge(emitter, { holdPermissions: holdsFor, titles, rollouts, transcripts, subagents, workflows, scripts })
    const supervisor = new HookSupervisor({
      dir,
      handler: (request) => route(bridge, request),
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

/** The agent shims for plain terminals (./shell-agents.ts); null when they could not be written. */
let shims: ShimDirs | null = null

/** `resources/hooks/agent-shim.sh`, next to the hook relay. */
function agentShimScriptPath(): string {
  return join(dirname(hookScriptPath()), 'agent-shim.sh')
}

export function registerHookHandlers(): void {
  usageStore = createUsageStore()
  createPollers()
  runtime = start()
  try {
    shims = writeShims(join(app.getPath('userData'), 'agent-shims'), agentShimScriptPath())
  } catch (error) {
    console.error('[hooks] could not write the agent shims:', error)
  }

  ipcMain.handle(IPC.agentGetUsage, (): VendorUsage[] => usageStore?.list() ?? [])

  // The usage popover or the 额度 page opened: ask the accounts now (each poller keeps its own minimum gap).
  ipcMain.on(IPC.agentRefreshUsage, (_event, all: unknown) => {
    for (const poller of Object.values(pollers)) poller.refresh(all === true)
  })
  ipcMain.handle(IPC.agentGetUsageAccounts, (): UsageAccount[] => [...accounts.values()])

  ipcMain.handle(IPC.agentContextHistory, async (_event, sessionId: unknown): Promise<ContextHistory | null> => {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) return null
    return transcripts.history(sessionId)
  })

  ipcMain.handle(IPC.agentUsageShares, async (_event, vendor: unknown, since: unknown): Promise<SessionSpend[]> => {
    if ((vendor !== 'claude' && vendor !== 'codex') || typeof since !== 'number' || !Number.isFinite(since)) return []
    return transcripts.spend(vendor, since)
  })

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
    stopPollers()
    void pending?.then((rt) => rt?.supervisor.stop())
  })
}

/**
 * Called by the pty layer before spawning an agent. Returns null for shells and when hooks are unavailable
 * (then the owner gets a `SessionHooksSignal` of kind 'unavailable'). Claude gets a `--settings` file; Codex gets
 * `-c` overrides (PRD §6.7).
 */
export async function prepareAgentLaunch(
  sessionId: string,
  owner: WebContents,
  agent: AgentKind | undefined,
  /** The agent starts only after something else (the repository's setup script): armStartWatchdog() then. */
  options: { deferStartWatchdog?: boolean; cwd?: string } = {}
): Promise<AgentLaunchHooks | null> {
  if (agent !== 'claude' && agent !== 'codex' && agent !== 'gemini' && agent !== 'qwen' && agent !== 'pi') return null
  if (agent === 'claude' || agent === 'codex') pollers[agent]?.nudge()
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
    if (!options.deferStartWatchdog) watchdog.arm(sessionId)
    // Our statusLine replaces the user's own; the relay runs theirs (resolved for this directory) and prints it as is.
    const userStatusLine = options.cwd ? userStatusLineFor(options.cwd) : ''
    return { env: { ...env, TR_USER_STATUSLINE: userStatusLine }, settingsPath: rt.supervisor.settingsPath }
  }
  if (agent !== 'codex') {
    const adapter = cliAdapterLaunch(agent, dirname(rt.supervisor.settingsPath), hookScriptPath())
    if (!adapter) {
      sendSessionSignal(owner, { sessionId, kind: 'unavailable', reason: 'server-unavailable', detail: `could not prepare the ${agent} hooks` })
      return null
    }
    owners.set(sessionId, owner)
    rt.bridge.attach(sessionId)
    if (!options.deferStartWatchdog) watchdog.arm(sessionId)
    return { env: { ...env, ...adapter.env }, ...(adapter.args.length > 0 ? { extraArgs: adapter.args } : {}) }
  }
  const codex = await rt.codex.get()
  // Without trusted hooks Codex would skip ours, so there is nothing to attach (status falls back to titles).
  if (!codex.ok) {
    sendSessionSignal(owner, { sessionId, kind: 'unavailable', reason: codex.reason, detail: codex.detail })
    return null
  }
  owners.set(sessionId, owner)
  rt.bridge.attach(sessionId)
  if (!options.deferStartWatchdog) watchdog.arm(sessionId)
  return { env, codexConfig: codex.config }
}

/**
 * A plain terminal: an agent the user starts in it by hand reports to this session (PRD F11). Returns the environment
 * that puts the agent shims first on PATH (and keeps them there in zsh / fish) plus the hook variables; null when
 * hooks or shims are unavailable (the terminal then works as before). `base` is the shell's starting environment.
 */
export async function prepareShellLaunch(
  sessionId: string,
  owner: WebContents,
  options: { shell: string; base: Readonly<Record<string, string | undefined>>; cwd?: string }
): Promise<Record<string, string> | null> {
  if (!shims) return null
  const rt = await runtime
  if (!rt || !rt.supervisor.health.ok) return null
  const codex = await rt.codex.get()
  try {
    if (codex.ok) writeCodexOverrides(shims, codex.config)
  } catch (error) {
    console.error('[hooks] could not write the Codex overrides for the shims:', error)
  }
  owners.set(sessionId, owner)
  rt.bridge.attach(sessionId)
  return {
    ...shellIntegrationEnv(options.shell, options.base, shims),
    TR_SESSION_ID: sessionId,
    TR_HOOK_SOCK: rt.supervisor.socketPath,
    TR_HOOK_TOKEN: rt.supervisor.token,
    TR_HOOK_SCRIPT: hookScriptPath(),
    TR_CLAUDE_SETTINGS: rt.supervisor.settingsPath,
    ...(codex.ok ? { TR_CODEX_CONFIG: shims.codexConfig } : {}),
    // Resolved for the folder the terminal starts in (a statusLine in another project's settings is not seen).
    TR_USER_STATUSLINE: options.cwd ? userStatusLineFor(options.cwd) : ''
  }
}

/** Starts the SessionStart countdown of a launch prepared with `deferStartWatchdog` (its setup script finished). */
export function armStartWatchdog(sessionId: string): void {
  if (owners.has(sessionId)) watchdog.arm(sessionId)
}

/**
 * A window reattached to an agent that kept running in the pty daemon: route its hook events to that window again.
 * No start watchdog: the agent started long ago.
 */
export function adoptAgentSession(sessionId: string, owner: WebContents, missed: readonly HookJournalEntry[] = []): void {
  owners.set(sessionId, owner)
  void runtime?.then(async (rt) => {
    if (!rt) return
    rt.bridge.attach(sessionId, { adopt: true })
    // What happened while the app was closed (a finished turn, a permission prompt) brings the status up to date.
    const signal = new AbortController().signal
    for (const entry of missed) {
      // A tool call nobody answered while the app was away is not replayed: its MCP server already gave up.
      if (isDispatchEvent(entry.event)) continue
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
  agent: HookAgent
  payload: unknown
}): Promise<{ status: number; body: string }> {
  const rt = await runtime
  if (!rt) return { status: 404, body: '' }
  try {
    const body = await route(rt.bridge, { ...request, payload: request.payload ?? undefined, signal: new AbortController().signal })
    return { status: 200, body }
  } catch (error) {
    return { status: error instanceof UnknownSessionError ? 404 : 500, body: '' }
  }
}

/** The session's PTY ended (exit, kill, host crash): release holds and withdraw its prompts. */
export function endAgentSession(sessionId: string): void {
  watchdog.disarm(sessionId)
  offPlan.delete(sessionId)
  const owner = owners.get(sessionId)
  if (!owner || !runtime) return
  void runtime.then((rt) => {
    rt?.bridge.detach(sessionId)
    // A re-spawn under the same id may have attached a new owner meanwhile.
    if (owners.get(sessionId) === owner) owners.delete(sessionId)
  })
}
