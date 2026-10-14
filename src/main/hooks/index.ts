// Electron glue for the hook bridge: owns the hook socket + generated settings file for this app run,
// hands agent PTYs their env, and forwards bridge signals to the window that owns the session.
import { app, ipcMain, type WebContents } from 'electron'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { PermissionDecision } from '@shared/agent-events'
import type { AgentKind } from '@shared/types'
import { HookBridge, type BridgeEmitter } from './bridge'
import { startHookServer, type HookServer } from './server'
import { buildClaudeHookSettings } from './settings'

export interface AgentLaunchHooks {
  /** TR_SESSION_ID / TR_HOOK_SOCK / TR_HOOK_TOKEN for the PTY environment. */
  env: Record<string, string>
  /** The `--settings` file for Claude. */
  settingsPath: string
}

interface Runtime {
  bridge: HookBridge
  server: HookServer
  settingsPath: string
}

const owners = new Map<string, WebContents>()
let runtime: Promise<Runtime | null> | null = null

const DECISIONS: ReadonlySet<unknown> = new Set<PermissionDecision>(['allow-once', 'allow-always', 'deny'])

/** `resources/hooks/tr-hook.sh`: next to the app in dev, in Contents/Resources/hooks when packaged. */
export function hookScriptPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'hooks', 'tr-hook.sh') : join(app.getAppPath(), 'resources', 'hooks', 'tr-hook.sh')
}

function ownerOf(sessionId: string): WebContents | null {
  const owner = owners.get(sessionId)
  return owner && !owner.isDestroyed() ? owner : null
}

const emitter: BridgeEmitter = {
  event: (envelope) => ownerOf(envelope.sessionId)?.send(IPC.agentEvent, envelope),
  prompt: (prompt) => ownerOf(prompt.sessionId)?.send(IPC.agentPrompt, prompt),
  resolved: (resolution) => ownerOf(resolution.sessionId)?.send(IPC.agentPromptResolved, resolution),
  canDeliver: (sessionId) => ownerOf(sessionId) !== null
}

async function start(): Promise<Runtime | null> {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'tr-hooks-'))
    const bridge = new HookBridge(emitter)
    const server = await startHookServer((request) => bridge.handle(request), { socketDir: dir })
    const settingsPath = join(dir, 'claude-settings.json')
    writeFileSync(settingsPath, JSON.stringify(buildClaudeHookSettings(hookScriptPath()), null, 2), { mode: 0o600 })
    chmodSync(settingsPath, 0o600)
    return { bridge, server, settingsPath }
  } catch (error) {
    // Agents still work without hooks; the sidebar just falls back to its slower signals.
    console.error('[hooks] could not start the hook server:', error)
    return null
  }
}

export function registerHookHandlers(): void {
  runtime = start()

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
    void pending?.then((rt) => rt?.server.close())
  })
}

/**
 * Called by the pty layer before spawning an agent. Returns null when the agent has no hook
 * integration yet (Codex: M3) or the hook server is unavailable.
 */
export async function prepareAgentLaunch(sessionId: string, owner: WebContents, agent: AgentKind | undefined): Promise<AgentLaunchHooks | null> {
  if (agent !== 'claude') return null
  const rt = await runtime
  if (!rt) return null
  owners.set(sessionId, owner)
  rt.bridge.attach(sessionId)
  return {
    env: { TR_SESSION_ID: sessionId, TR_HOOK_SOCK: rt.server.socketPath, TR_HOOK_TOKEN: rt.server.token },
    settingsPath: rt.settingsPath
  }
}

/** The session's PTY ended (exit, kill, host crash): release holds and withdraw its prompts. */
export function endAgentSession(sessionId: string): void {
  const owner = owners.get(sessionId)
  if (!owner || !runtime) return
  void runtime.then((rt) => {
    rt?.bridge.detach(sessionId)
    // A re-spawn under the same id may have attached a new owner meanwhile.
    if (owners.get(sessionId) === owner) owners.delete(sessionId)
  })
}
