// Electron glue for 手机远程 (PRD F22): runs the phone server while 设置 · 手机 · 允许手机连接 is on, answers the
// phone's requests — reading transcripts and git here, answering prompts through the hook bridge, and handing what
// the terminal must do (typing a prompt, Esc, a new session) to the window that owns the session — and keeps
// 设置 · 手机 up to date.
import { app, ipcMain, type WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { PendingPrompt } from '@shared/agent-events'
import { isCliAgent } from '@shared/agents'
import {
  pairingLink,
  parseRemoteResult,
  parseWindowSessions,
  REMOTE_IPC,
  REMOTE_LIMITS,
  remoteFail,
  type PhoneRequest,
  type RemoteAddress,
  type RemotePrompt,
  type RemoteResult,
  type RemoteStatus,
  type RemoteWindowCommand,
  type RemoteWindowRequest,
  type RemoteWindowSessions
} from '@shared/remote'
import { detectAgents } from '../agents-installed'
import { appWindows } from '../app-windows'
import { changes, fileDiff } from '../git-graph'
import { answerFromRemote, promptHeld, respondFromRemote, setRemoteHooks, transcriptSource } from '../hooks'
import { claudeTranscriptPath, defaultAgentDataDirs } from '../hooks/agent-title'
import { getSettings, onSettingsChange } from '../settings'
import { newSessionInfo } from '../worktree-create'
import { identityFromPem, identityToPem, newIdentity, type Identity } from './crypto'
import { DeviceStore, type StoredDevice } from './devices'
import { FeedHub, type FeedSource } from './feed'
import { PhotoError, savePhotos } from './photos'
import { RemoteServer, type RemoteConnection } from './server'

let server: RemoteServer | null = null
let running: { port: number } | null = null
let lastError: string | undefined
let windowSessions: RemoteWindowSessions = { projects: [], sessions: [], folders: {}, roots: {} }
const prompts = new Map<string, PendingPrompt>()
let ownerOf: (sessionId: string) => WebContents | null = () => null
let mainWindow: () => WebContents | null = () => null
let macName = hostname().replace(/\.local$/, '')

const dataDir = (): string => join(app.getPath('userData'), 'remote')

function writePrivate(file: string, content: string): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, content, { mode: 0o600 })
  renameSync(tmp, file)
  chmodSync(file, 0o600)
}

/** The Mac's X25519 key, made once per profile. */
function loadIdentity(): Identity {
  const file = join(dataDir(), 'identity.pem')
  try {
    const kept = identityFromPem(readFileSync(file, 'utf8'))
    if (kept) return kept
  } catch {
    // Made below.
  }
  const identity = newIdentity()
  writePrivate(file, identityToPem(identity))
  return identity
}

function deviceStore(): DeviceStore {
  const file = join(dataDir(), 'devices.json')
  return new DeviceStore({
    load: () => {
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as unknown
      } catch {
        return []
      }
    },
    save: (devices: StoredDevice[]) => writePrivate(file, JSON.stringify(devices))
  })
}

// --- addresses -------------------------------------------------------------------------------------------------------

const inRange = (ip: string, prefix: number[], bits: number): boolean => {
  const parts = ip.split('.').map(Number)
  let left = bits
  for (let i = 0; i < 4 && left > 0; i++) {
    const take = Math.min(8, left)
    const mask = (0xff << (8 - take)) & 0xff
    if (((parts[i] ?? 0) & mask) !== ((prefix[i] ?? 0) & mask)) return false
    left -= take
  }
  return true
}

let tailscaleName: { at: number; name: string | null } = { at: 0, name: null }

/** The Mac's MagicDNS name, read from the Tailscale CLI (only read, never configured). */
function refreshTailscaleName(): void {
  if (Date.now() - tailscaleName.at < 60_000) return
  tailscaleName = { ...tailscaleName, at: Date.now() }
  const cli = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale'].find((p) => existsSync(p))
  if (!cli) return
  execFile(cli, ['status', '--json'], { timeout: 3000 }, (error, stdout) => {
    if (error) return
    try {
      const name = (JSON.parse(stdout) as { Self?: { DNSName?: unknown } }).Self?.DNSName
      const next = typeof name === 'string' && name ? name.replace(/\.$/, '') : null
      if (next !== tailscaleName.name) {
        tailscaleName = { at: Date.now(), name: next }
        broadcastStatus()
      }
    } catch {
      // Not JSON: keep the IP.
    }
  })
}

function addresses(port: number): RemoteAddress[] {
  refreshTailscaleName()
  const out: RemoteAddress[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (inRange(a.address, [100, 64], 10)) {
        const host = tailscaleName.name ?? a.address
        out.push({ kind: 'tailscale', host, url: `ws://${a.address}:${port}` })
      } else if (inRange(a.address, [10], 8) || inRange(a.address, [172, 16], 12) || inRange(a.address, [192, 168], 16)) {
        out.push({ kind: 'lan', host: `${a.address}:${port}`, url: `ws://${a.address}:${port}` })
      }
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'tailscale' ? -1 : 1))
}

// --- status ----------------------------------------------------------------------------------------------------------

function status(withCode: boolean): RemoteStatus {
  const settings = getSettings().remote
  const listening = server?.listening === true && running !== null
  const list = listening ? addresses(running!.port) : []
  const online = server?.online() ?? new Set<string>()
  let pairing: RemoteStatus['pairing'] = null
  const offer = server && listening && (withCode || server.hasCode()) ? server.pairing() : null
  if (offer) pairing = { ...offer, link: pairingLink({ v: 1, name: macName, urls: list.map((a) => a.url), code: offer.code, key: identity!.publicKey }) }
  return {
    enabled: settings.enabled,
    port: settings.port,
    listening,
    ...(lastError ? { error: lastError } : {}),
    addresses: list,
    pairing,
    pairingLocked: listening && server?.pairingLocked === true,
    devices: (devices?.list() ?? []).map((d) => ({ id: d.id, name: d.name, pairedAt: d.pairedAt, lastSeenAt: d.lastSeenAt, online: online.has(d.id) }))
  }
}

function broadcastStatus(): void {
  const value = status(false)
  for (const win of appWindows()) if (!win.webContents.isDestroyed()) win.webContents.send(REMOTE_IPC.status, value)
}

// --- the window: forwarded commands ----------------------------------------------------------------------------------

const calls = new Map<string, { owner: WebContents; resolve: (result: RemoteResult) => void }>()

/**
 * 归档 runs the repository's archive script and records the worktree; an exit's preflight may ask GitHub; a send to a
 * session that has not started waits for its agent to come up.
 */
const SLOW_WINDOW_MS: Partial<Record<RemoteWindowCommand['type'], number>> = { archive: 120_000, exits: 30_000, ship: 30_000, send: 30_000, 'set-setting': 30_000 }

function askWindow(owner: WebContents | null, command: RemoteWindowCommand): Promise<RemoteResult> {
  if (!owner || owner.isDestroyed()) return Promise.resolve(remoteFail('Mac 上没有窗口打开这个会话'))
  const callId = randomBytes(12).toString('hex')
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      calls.delete(callId)
      resolve(remoteFail('Mac 上的 Wavi 没有及时响应'))
    }, SLOW_WINDOW_MS[command.type] ?? REMOTE_LIMITS.windowAnswerMs)
    calls.set(callId, {
      owner,
      resolve: (result) => {
        clearTimeout(timer)
        resolve(result)
      }
    })
    const request: RemoteWindowRequest = { callId, command }
    owner.send(REMOTE_IPC.request, request)
  })
}

// --- the phone's requests --------------------------------------------------------------------------------------------

const knownSession = (id: string): boolean => windowSessions.sessions.some((s) => s.id === id)
const notFound = remoteFail('会话不存在')

/** Claude's transcript before any hook named it: `<projects>/<cwd with every non-alphanumeric as ->/<id>.jsonl`. */
function feedSource(sessionId: string): FeedSource | null {
  const known = transcriptSource(sessionId)
  if (known) return known
  const folder = windowSessions.folders[sessionId]
  const session = windowSessions.sessions.find((s) => s.id === sessionId)
  if (!folder?.agentSession || session?.agent !== 'claude') return null
  const dirs = defaultAgentDataDirs()
  for (const root of dirs.claudeProjects) {
    const path = claudeTranscriptPath(join(root, folder.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${folder.agentSession}.jsonl`), dirs)
    if (path && existsSync(path)) return { agent: 'claude', path }
  }
  return null
}

const feed = new FeedHub({
  sourceOf: feedSource,
  push: (connectionId, event) => server?.connections().find((c) => c.id === connectionId)?.send(event)
})

async function visiblePrompts(): Promise<RemotePrompt[]> {
  const list = [...prompts.values()].filter((p) => knownSession(p.sessionId))
  return Promise.all(list.map(async (p) => ({ ...p, answerable: await promptHeld(p.id) })))
}

const phoneList = () => ({ projects: windowSessions.projects, sessions: windowSessions.sessions })

async function handle(connection: RemoteConnection, request: PhoneRequest): Promise<RemoteResult> {
  switch (request.type) {
    case 'snapshot':
      return { ok: true, data: { ...phoneList(), prompts: await visiblePrompts() } }
    case 'watch': {
      if (request.session && !knownSession(request.session)) return notFound
      feed.watch(connection.id, request.session)
      if (!request.session) return { ok: true }
      // The newest page is the phone's starting point: what is pushed from now on continues it.
      const page = await feed.page(request.session)
      return { ok: true, data: page ?? { items: [], start: 0, total: 0 } }
    }
    case 'feed': {
      if (!knownSession(request.session)) return notFound
      const page = await feed.page(request.session, request.before)
      return { ok: true, data: page ?? { items: [], start: 0, total: 0 } }
    }
    case 'send': {
      if (!knownSession(request.session)) return notFound
      let paths: string[]
      try {
        paths = await savePhotos(join(app.getPath('temp'), 'wavi', 'attachments'), request.photos)
      } catch (error) {
        return remoteFail(error instanceof PhotoError ? error.message : '照片没能保存')
      }
      // A session restored after a restart has no PTY (so no owner) until it is first shown; the window that lists it starts it.
      return askWindow(ownerOf(request.session) ?? mainWindow(), { type: 'send', session: request.session, text: request.text, paths })
    }
    case 'interrupt':
      return knownSession(request.session) ? askWindow(ownerOf(request.session), { type: 'interrupt', session: request.session }) : notFound
    case 'set-setting':
      return knownSession(request.session)
        ? askWindow(ownerOf(request.session), { type: 'set-setting', session: request.session, kind: request.kind, value: request.value })
        : notFound
    case 'permission': {
      const prompt = prompts.get(request.prompt)
      if (!prompt || prompt.kind !== 'permission') return remoteFail('已经在终端里处理了')
      return (await respondFromRemote(request.prompt, request.decision)) ? { ok: true } : remoteFail('已经在终端里处理了')
    }
    case 'answer': {
      const prompt = prompts.get(request.prompt)
      if (!prompt || prompt.kind !== 'question') return remoteFail('已经在终端里回答了')
      return (await answerFromRemote(request.prompt, request.answers)) ? { ok: true } : remoteFail('这个问题现在只能在终端里回答')
    }
    case 'new-session-info': {
      const root = windowSessions.roots[request.project]
      if (!root) return remoteFail('项目不存在')
      const [info, installed] = await Promise.all([newSessionInfo(root), detectAgents()])
      return { ok: true, data: { info, agents: Object.entries(installed).filter(([id, on]) => on && isCliAgent(id)).map(([id]) => id) } }
    }
    case 'new-session':
      if (!windowSessions.roots[request.project]) return remoteFail('项目不存在')
      return askWindow(mainWindow(), { type: 'new-session', project: request.project, workdir: request.workdir, agent: request.agent, ...pick(request) })
    case 'changes': {
      const folder = windowSessions.folders[request.session]
      if (!folder) return notFound
      const result = await changes(folder.cwd, folder.base)
      return result ? { ok: true, data: result } : remoteFail('不是 git 仓库')
    }
    case 'diff': {
      const folder = windowSessions.folders[request.session]
      if (!folder) return notFound
      let baseRef: string | undefined
      if (request.scope === 'committed') {
        baseRef = (await changes(folder.cwd, folder.base))?.baseRef ?? undefined
        if (!baseRef) return remoteFail('没有可对比的基线分支')
      }
      const text = await fileDiff({ root: folder.cwd, path: request.path, oldPath: request.oldPath, scope: request.scope, baseRef, untracked: request.untracked })
      return { ok: true, data: { text } }
    }
    // Exits and 归档 run in the main window, through Git · 变更's own code (PRD F16 / F15): it is the window whose session
    // list (with the runs' progress) the phone gets, and none of them needs the session's terminal to be open.
    case 'exits':
      return knownSession(request.session) ? askWindow(mainWindow(), { type: 'exits', session: request.session }) : notFound
    case 'ship':
      return knownSession(request.session) ? askWindow(mainWindow(), { type: 'ship', session: request.session, action: request.action }) : notFound
    case 'archive':
      return knownSession(request.session) ? askWindow(mainWindow(), { type: 'archive', session: request.session }) : notFound
  }
}

function pick(request: Extract<PhoneRequest, { type: 'new-session' }>): { base?: string; branch?: string; prompt?: string } {
  return {
    ...(request.base ? { base: request.base } : {}),
    ...(request.branch ? { branch: request.branch } : {}),
    ...(request.prompt ? { prompt: request.prompt } : {})
  }
}

// --- lifecycle -------------------------------------------------------------------------------------------------------

let identity: Identity | null = null
let devices: DeviceStore | null = null
let broadcastTimer: NodeJS.Timeout | null = null

function broadcastSessions(): void {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    server?.broadcast({ event: 'sessions', data: phoneList() })
  }, 250)
}

function broadcastPrompts(): void {
  if (!server) return
  void visiblePrompts().then((data) => server?.broadcast({ event: 'prompts', data }))
}

async function apply(): Promise<void> {
  const { enabled, port } = getSettings().remote
  if (server && running && (!enabled || running.port !== port)) {
    const old = server
    server = null
    running = null
    feed.stop()
    prompts.clear()
    await old.stop()
  }
  if (!enabled || server) {
    broadcastStatus()
    return
  }
  identity ??= loadIdentity()
  devices ??= deviceStore()
  const next = new RemoteServer({
    identity,
    devices,
    name: () => macName,
    urls: () => (running ? addresses(running.port).map((a) => a.url) : []),
    version: app.getVersion(),
    handle,
    onClose: (connection) => feed.drop(connection.id),
    onChange: broadcastStatus
  })
  try {
    await next.start(port)
    server = next
    running = { port }
    lastError = undefined
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    console.error('[remote] could not listen:', lastError)
  }
  broadcastStatus()
}

/** One start / stop at a time: a settings change during a start waits for it, then sees the settings as they are. */
let applying: Promise<void> = Promise.resolve()
function reapply(): void {
  applying = applying.then(apply, apply)
}

/** A prompt the phone can act on: a question, or a permission request that is held (an announced one never resolves here). */
async function track(prompt: PendingPrompt): Promise<void> {
  if (!server) return
  if (prompt.kind === 'permission' && !(await promptHeld(prompt.id))) return
  prompts.set(prompt.id, prompt)
  if (knownSession(prompt.sessionId)) broadcastPrompts()
}

/** `owner`: the window a session's PTY belongs to; `main`: where a new session opens. */
export function registerRemoteHandlers(owner: (sessionId: string) => WebContents | null, main: () => WebContents | null): void {
  ownerOf = owner
  mainWindow = main
  devices = deviceStore()
  execFile('/usr/sbin/scutil', ['--get', 'ComputerName'], { timeout: 2000 }, (error, stdout) => {
    if (!error && stdout.trim()) macName = stdout.trim().slice(0, 80)
  })
  setRemoteHooks(
    {
      prompt: (prompt) => void track(prompt),
      resolved: (resolution) => {
        if (prompts.delete(resolution.id)) broadcastPrompts()
      },
      activity: (sessionId) => feed.nudge(sessionId),
      held: () => broadcastPrompts()
    },
    // Hold permission requests only while a phone could answer them (the TUI dialog shows either way).
    () => (server?.connections().length ?? 0) > 0
  )
  ipcMain.handle(REMOTE_IPC.getStatus, () => status(true))
  ipcMain.handle(REMOTE_IPC.newCode, () => {
    server?.renewCode()
    return status(true)
  })
  ipcMain.on(REMOTE_IPC.closePairing, () => {
    server?.clearCode()
    broadcastStatus()
  })
  ipcMain.handle(REMOTE_IPC.revoke, (_event, deviceId: unknown) => {
    if (typeof deviceId !== 'string' || deviceId.length > 64) return status(false)
    if (server) server.revoke(deviceId)
    else devices?.remove(deviceId)
    broadcastStatus()
    return status(false)
  })
  ipcMain.on(REMOTE_IPC.sessions, (event, raw: unknown) => {
    if (event.sender !== mainWindow()) return
    const list = parseWindowSessions(raw)
    if (!list) {
      console.error('[remote] the window sent a session list that does not validate')
      return
    }
    windowSessions = list
    broadcastSessions()
    // A session that just started now names its transcript.
    feed.retry()
  })
  ipcMain.on(REMOTE_IPC.reply, (event, callId: unknown, result: unknown) => {
    if (typeof callId !== 'string' || callId.length > 64) return
    const call = calls.get(callId)
    if (!call || call.owner !== event.sender) return
    calls.delete(callId)
    call.resolve(parseRemoteResult(result) ?? remoteFail('Mac 上的 Wavi 给了看不懂的回答'))
  })
  onSettingsChange(reapply)
  reapply()
  app.on('will-quit', () => void server?.stop())
}
