// Electron glue for GUI sessions (PRD F23): `window.tr.gui` handlers (every payload validated, every call checked
// against the window that owns the session), the launch each agent gets (Claude's per-launch hooks and
// CLAUDE_CODE_ENTRYPOINT=wavi, `wavi` on PATH for dispatch, the worktree's TR_PORT), status into the hook bridge's
// event path, and reports from dispatch delivered over the agent's protocol.

import { app, ipcMain, type WebContents } from 'electron'
import { realpathSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { HookAgent } from '@shared/agent-events'
import { isCliAgent, type CliAgent } from '@shared/agents'
import { AGENT_GUI, NO_GUI_REASON } from '@shared/gui-agents'
import { GUI_IPC, type GuiCatalogResult, type GuiLaunch, type GuiLiveSession, type GuiOpenResult, type GuiSendResult } from '@shared/gui-chat'
import { GUI_TASK_ID } from '@shared/workflow-run'
import type { HookJournalEntry } from '../../pty-host/protocol'
import { agentVersion } from '../agents-installed'
import { keepInlineImage } from '../files'
import { dispatchLaunchFor, setGuiDelivery } from '../dispatch'
import { adoptAgentSession, emitGuiAgentEvent, endAgentSession, hookScriptPath, hooksViaDaemon, prepareAgentLaunch, setGuiSession } from '../hooks'
import { defaultAgentDataDirs } from '../hooks/agent-title'
import { pipeLink } from '../pty/pipes'
import { sniffPhoto } from '../remote/photos'
import { portFor } from '../repo-scripts'
import type { ImageBlock } from './driver'
import { agentModels } from './catalog'
import { claudeResumePoint, claudeTranscriptFor, codexRolloutFor, piSessionFileFor, piSessionsDir, readPiHistory, readTranscript } from './history'
import { GuiHost, type PreparedLaunch } from './host'
import { guiArgv, guiCommand, guiEnv, takesSystemPromptArgs } from './launch'
import { parseGuiAnswer, parseGuiLaunch, parseGuiMessage, parseGuiSessionId, parseGuiText, parseGuiValue } from './validate'

/** Claude's API takes images up to 5 MB; a bigger one goes as its path instead. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MEDIA_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' } as const

const HOOK_AGENTS: ReadonlySet<string> = new Set<HookAgent>(['claude', 'codex', 'gemini', 'qwen', 'opencode', 'pi'])

/**
 * The envelope's `agent` (a HookAgent) for status from a GUI session. The renderer reads it only to tell Claude and
 * Codex apart (session meta) and main only to nudge their plan usage; an ACP agent outside that list is reported as
 * `opencode`, which neither path treats specially.
 */
export const hookAgentOf = (agent: CliAgent): HookAgent => (HOOK_AGENTS.has(agent) ? (agent as HookAgent) : 'opencode')

/** Only string values: the app's environment as the base for the agent's (the daemon's own may be days old). */
function appEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  return env
}

async function prepare(launch: GuiLaunch, owner: WebContents, resume: string | undefined): Promise<PreparedLaunch> {
  const driver = AGENT_GUI[launch.agent]
  if (!driver) throw new Error(NO_GUI_REASON[launch.agent] ?? '这个智能体只能用 CLI')
  let realCwd: string
  try {
    realCwd = realpathSync(launch.cwd)
  } catch {
    throw new Error(`文件夹 ${launch.cwd} 不存在`)
  }
  const claude = driver.protocol === 'claude-stream'
  // Claude keeps its hooks under -p (PRD §6.17): status, titles and the phone work as for a TUI. Marked first, so its
  // PermissionRequest hook is never held.
  if (claude) setGuiSession(launch.sessionId, true)
  // Asked alongside the hooks and dispatch. Unknown (not on PATH, no answer in 5 s): launched without the flags an
  // older Claude would exit on.
  const version = claude ? agentVersion('claude').catch(() => null) : undefined
  const hooks = claude ? await prepareAgentLaunch(launch.sessionId, owner, 'claude', { deferStartWatchdog: true, cwd: realCwd }) : null
  const dispatch = await dispatchLaunchFor(launch.sessionId, launch.agent, { child: launch.dispatched === true })
  const claudeVersion = await version
  const argv = guiArgv({
    agent: launch.agent,
    realCwd,
    launch,
    ...(resume ? { resume } : {}),
    ...(hooks?.settingsPath ? { claudeSettingsPath: hooks.settingsPath } : {}),
    ...(claudeVersion ? { claudeVersion } : {}),
    // Pi's permission extension sits next to the hook relay, like its TUI one (resources/hooks).
    ...(driver.protocol === 'pi-rpc' ? { piExtensionPath: join(dirname(hookScriptPath()), 'wavi-pi-gui.js') } : {}),
    extraArgs: dispatch && takesSystemPromptArgs(driver.protocol) ? dispatch.extraArgs : []
  })
  if (!argv) throw new Error('这个智能体只能用 CLI')
  const port = portFor(realCwd)
  const env = {
    ...guiEnv(launch.agent),
    ...hooks?.env,
    ...dispatch?.env,
    ...(port !== null ? { TR_PORT: String(port) } : {}),
    // Mandatory (PRD F23 / §6.17): the GUI's own label, not the `sdk-cli` one -p would otherwise report.
    ...(claude ? { CLAUDE_CODE_ENTRYPOINT: 'wavi' } : {})
  }
  const { command, args } = guiCommand(argv, dispatch?.pathPrefix)
  // Claude's hooks carry its status only when they reach this app: without a hook server there are none, and the pty
  // daemon's hook socket answers 404 for a process it does not host (an older daemon: the process runs in main). Then
  // the host derives the status from the stream instead, so it is never reported twice.
  const synthStatus = claude && (hooks === null || ((await hooksViaDaemon()) && !pipeLink().durable))
  return { command, args, env, baseEnv: appEnv(), binary: argv[0]!, ...(synthStatus ? { synthStatus } : {}) }
}

async function history(agent: CliAgent, cwd: string, agentSessionId: string) {
  const dirs = defaultAgentDataDirs()
  if (agent === 'claude') {
    const path = claudeTranscriptFor(cwd, agentSessionId, dirs)
    return path ? readTranscript({ agent: 'claude', path }, keepInlineImage) : null
  }
  if (agent === 'codex') {
    const path = await codexRolloutFor(agentSessionId, dirs.codexHome)
    return path ? readTranscript({ agent: 'codex', path }, keepInlineImage) : null
  }
  if (agent === 'pi') {
    const path = await piSessionFileFor(agentSessionId, piSessionsDir(), cwd)
    return path ? readPiHistory(path, cwd, keepInlineImage) : null
  }
  return null
}

async function resumePoint(agent: CliAgent, cwd: string, agentSessionId: string, messageId: string) {
  if (agent !== 'claude') return undefined
  const path = claudeTranscriptFor(cwd, agentSessionId, defaultAgentDataDirs())
  return path ? claudeResumePoint(path, messageId) : undefined
}

async function readImage(path: string): Promise<ImageBlock | null> {
  try {
    if ((await stat(path)).size > MAX_IMAGE_BYTES) return null
    const bytes = await readFile(path)
    const type = sniffPhoto(bytes)
    if (!type || type === 'heic') return null
    return { mediaType: MEDIA_TYPES[type], data: bytes.toString('base64') }
  } catch {
    return null
  }
}

const host = new GuiHost<WebContents>({
  link: () => pipeLink(),
  prepare,
  history,
  resumePoint,
  status: (sessionId, agent, events, owner) => {
    const at = Date.now()
    for (const event of events) emitGuiAgentEvent({ sessionId, agent: hookAgentOf(agent), at, event }, owner)
  },
  adopted: (sessionId, agent, owner, hooks) => {
    if (agent !== 'claude') return
    setGuiSession(sessionId, true)
    adoptAgentSession(sessionId, owner, hooks as readonly HookJournalEntry[])
  },
  ended: (sessionId, agent) => {
    if (agent !== 'claude') return
    endAgentSession(sessionId)
    setGuiSession(sessionId, false)
  },
  image: readImage,
  keepImage: keepInlineImage,
  clientVersion: app.getVersion()
})

/** The window a GUI session belongs to (dispatch and remote route to it, like `ptySessionOwner`). */
export const guiSessionOwner = (sessionId: string): WebContents | null => host.ownerOf(sessionId)

const watched = new WeakSet<WebContents>()

function watchOwner(owner: WebContents): void {
  if (watched.has(owner)) return
  watched.add(owner)
  // Reload, close, crash: the agent keeps running for the next `open`.
  owner.once('destroyed', () => host.release(owner))
}

/** A session id the calling window owns, or null. */
function owned(sender: WebContents, raw: unknown): string | null {
  const id = parseGuiSessionId(raw)
  return id && host.ownerOf(id) === sender ? id : null
}

/** Not another window's: owned by the caller, or by no window (not opened in this app run, or its window is gone). */
const mayStop = (sender: WebContents, id: string): boolean => {
  const owner = host.ownerOf(id)
  return owner === null || owner === sender
}

export function registerGuiHandlers(): void {
  setGuiDelivery((sessionId, text) => (host.has(sessionId) ? host.send(sessionId, { text, attachments: [] }).then((r) => r.ok) : null))

  ipcMain.handle(GUI_IPC.open, (event, raw: unknown): Promise<GuiOpenResult> => {
    const launch = parseGuiLaunch(raw)
    if (!launch) return Promise.resolve({ ok: false, reason: '会话参数无效' })
    watchOwner(event.sender)
    return host.open(launch, event.sender)
  })

  ipcMain.handle(GUI_IPC.send, (event, rawId: unknown, rawMessage: unknown): Promise<GuiSendResult> => {
    const id = owned(event.sender, rawId)
    const message = parseGuiMessage(rawMessage)
    if (!id || !message) return Promise.resolve({ ok: false, reason: '消息无效' })
    return host.send(id, message)
  })

  ipcMain.handle(GUI_IPC.answer, (event, rawId: unknown, rawAnswer: unknown): boolean => {
    const id = owned(event.sender, rawId)
    const answer = parseGuiAnswer(rawAnswer)
    return id !== null && answer !== null && host.answer(id, answer)
  })

  ipcMain.handle(GUI_IPC.interrupt, (event, rawId: unknown): boolean => {
    const id = owned(event.sender, rawId)
    return id !== null && host.interrupt(id)
  })

  ipcMain.handle(GUI_IPC.stopTask, (event, rawId: unknown, rawTask: unknown): boolean => {
    const id = owned(event.sender, rawId)
    return id !== null && typeof rawTask === 'string' && GUI_TASK_ID.test(rawTask) && host.stopTask(id, rawTask)
  })

  ipcMain.handle(GUI_IPC.setConfig, (event, rawId: unknown, rawOption: unknown, rawValue: unknown): Promise<boolean> => {
    const id = owned(event.sender, rawId)
    const option = parseGuiValue(rawOption)
    const value = parseGuiValue(rawValue)
    if (!id || !option || !value) return Promise.resolve(false)
    return host.setConfig(id, option, value)
  })

  ipcMain.handle(GUI_IPC.editQueued, (event, rawId: unknown, rawQueued: unknown, rawText: unknown): boolean => {
    const id = owned(event.sender, rawId)
    const queued = parseGuiValue(rawQueued)
    const text = parseGuiText(rawText)
    return id !== null && queued !== null && text !== null && host.editQueued(id, queued, text)
  })

  ipcMain.handle(GUI_IPC.edit, (event, rawId: unknown, rawMessage: unknown, rawText: unknown): Promise<GuiOpenResult> => {
    const id = owned(event.sender, rawId)
    const messageId = parseGuiValue(rawMessage)
    const text = parseGuiText(rawText)
    if (!id || !messageId || text === null || !text.trim()) return Promise.resolve({ ok: false, reason: '消息无效' })
    return host.edit(id, messageId, text)
  })

  ipcMain.handle(GUI_IPC.stop, async (event, rawId: unknown): Promise<void> => {
    const id = parseGuiSessionId(rawId)
    if (id && mayStop(event.sender, id)) await host.end(id)
  })

  // Asked once per page load (gui/launch.ts adoptGuiSessions). Another window's sessions are left out, so its page
  // can neither adopt nor end them.
  ipcMain.handle(GUI_IPC.live, async (event): Promise<GuiLiveSession[]> => {
    const listed = await pipeLink()
      .list()
      .catch(() => [])
    return listed.filter((s) => mayStop(event.sender, s.id)).map((s) => ({ sessionId: s.id, exited: s.exit !== undefined }))
  })

  // Figma 65: an agent's models without a conversation (catalog.ts); any agent name not known is refused.
  ipcMain.handle(GUI_IPC.models, (_event, raw: unknown): Promise<GuiCatalogResult> =>
    isCliAgent(raw) ? agentModels(raw) : Promise.resolve({ ok: false, reason: '智能体无效' })
  )

  // Without the daemon the processes are this app's children: end them with it (the next run resumes by id).
  app.on('will-quit', () => {
    if (pipeLink().durable) return
    for (const id of host.ids()) host.stop(id)
  })
}
