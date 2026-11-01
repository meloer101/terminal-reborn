// Electron glue for dispatch (PRD F21): the `wavi` command on every agent's PATH, its requests relayed to the window
// that owns the calling session, and messages delivered into a session through its agent's own channel (§6.14).
import { app, ipcMain, type WebContents } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { shellQuote } from '@shared/agent-launch'
import { DISPATCH_IPC, parseDeliverRequest, reportChannelOf, systemPromptArgs, WAVI_SYSTEM_PROMPT, type DeliverResult, type DispatchAgent } from '@shared/dispatch'
import { executableOnPath, userLoginPath } from '../agents-installed'
import { setDispatchHookHandler } from '../hooks'
import { getSettings } from '../settings'
import { DispatchBroker } from './broker'
import { codexQueue, PiInbox, writeInbox } from './deliver'
import { parseInbox, WaviRequests } from './requests'

let ownerOf: (sessionId: string) => WebContents | null = () => null

const broker = new DispatchBroker<WebContents>({
  ownerOf: (sessionId) => ownerOf(sessionId),
  send: (owner, request) => {
    if (!owner.isDestroyed()) owner.send(DISPATCH_IPC.request, request)
  }
})

const piInbox = new PiInbox()

let requests: WaviRequests | null = null
let binDir: string | null = null
let wrapper: string | null = null

/** A random secret per profile, kept across runs, that the per-session tokens are derived from. */
function profileSecret(dir: string): string {
  const file = join(dir, 'secret')
  try {
    const kept = readFileSync(file, 'utf8').trim()
    if (/^[a-f0-9]{64}$/.test(kept)) return kept
  } catch {
    // Made below.
  }
  const secret = randomBytes(32).toString('hex')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(file, secret, { mode: 0o600 })
  chmodSync(file, 0o600)
  return secret
}

/**
 * `<userData>/bin/wavi`: Wavi's own binary run as Node on out/main/wavi-cli.js — the same paths in dev, in the linked
 * app and packaged. (Re)written when missing or different; the folder holds nothing else, so putting it first on PATH
 * shadows nothing of the user's.
 */
function writeWrapper(dir: string): string {
  const path = join(dir, 'wavi')
  const content = [
    '#!/bin/sh',
    "# Wavi's dispatch command (PRD F21), written by Wavi for its own sessions.",
    `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(process.execPath)} ${shellQuote(join(__dirname, 'wavi-cli.js'))} "$@"`,
    ''
  ].join('\n')
  let current = ''
  try {
    current = readFileSync(path, 'utf8')
  } catch {
    // Written below.
  }
  if (current !== content) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(path, content, { mode: 0o700 })
  }
  chmodSync(path, 0o700)
  return path
}

/**
 * `/private/tmp/wavi-<uid>-<profile>`: writable from Codex's default sandbox (§6.14 v1.104), one per Wavi profile. A
 * folder of that name someone else owns (made first by another user) is not used: a fresh name of our own instead.
 */
function requestsRoot(userData: string): string {
  const profile = createHash('sha256').update(userData).digest('hex').slice(0, 10)
  const base = process.platform === 'darwin' ? '/private/tmp' : app.getPath('temp')
  const uid = process.getuid?.() ?? 0
  const root = join(base, `wavi-${uid}-${profile}`)
  try {
    if (lstatSync(root).uid !== uid || !lstatSync(root).isDirectory()) return `${root}-${randomBytes(6).toString('hex')}`
  } catch {
    // Not there yet: ours to make.
  }
  return root
}

export interface DispatchLaunch {
  /** WAVI_DIR / WAVI_TOKEN / WAVI_BIN for the PTY. */
  env: Record<string, string>
  /** Put first on PATH inside the login shell's script (PRD F21 注入: the user's rc files would push it back otherwise). */
  pathPrefix: string
  /** The one-line system prompt for this launch, for the CLIs that take one; none for a dispatched session (its brief says it). */
  extraArgs: string[]
}

/** What an agent launch adds for dispatch; null when the user turned it off (设置 · 自动化 · 派活) or it is not ready. */
export async function dispatchLaunchFor(sessionId: string, agent: DispatchAgent, options: { child: boolean }): Promise<DispatchLaunch | null> {
  if (!getSettings().dispatch.tools || !requests || !binDir || !wrapper) return null
  const session = await requests.ensureSession(sessionId).catch((error: unknown) => {
    console.error('[dispatch] could not make the session folder:', error)
    return null
  })
  if (!session) return null
  return {
    env: { WAVI_DIR: session.dir, WAVI_TOKEN: session.token, WAVI_BIN: wrapper },
    pathPrefix: binDir,
    extraArgs: options.child ? [] : (systemPromptArgs(agent, WAVI_SYSTEM_PROMPT) ?? [])
  }
}

async function deliver(raw: unknown, sender: WebContents): Promise<DeliverResult> {
  const request = parseDeliverRequest(raw)
  if (!request || ownerOf(request.sessionId) !== sender) return 'failed'
  switch (reportChannelOf(request.agent)) {
    case 'claude-inbox': {
      const inbox = broker.inboxOf(request.sessionId)
      if (!inbox) return 'no-channel'
      return (await writeInbox(inbox, request.text)) ? 'delivered' : 'failed'
    }
    case 'codex-queue': {
      if (!request.agentSessionId) return 'no-channel'
      const path = await userLoginPath()
      const codex = path ? executableOnPath(path, 'codex') : null
      if (!path || !codex) return 'no-channel'
      return (await codexQueue(codex, path, request.agentSessionId, request.text)) ? 'delivered' : 'failed'
    }
    case 'pi-extension':
      return piInbox.put(request.sessionId, request.text) ? 'delivered' : 'no-channel'
    default:
      return 'no-channel'
  }
}

/** `owner`: the window a session's PTY belongs to (any agent, hooks or not). */
export function registerDispatchHandlers(owner: (sessionId: string) => WebContents | null): void {
  ownerOf = owner
  const userData = app.getPath('userData')
  try {
    binDir = join(userData, 'bin')
    wrapper = writeWrapper(binDir)
    requests = new WaviRequests({ root: requestsRoot(userData), secret: profileSecret(join(userData, 'dispatch')), handle: (call) => broker.call(call) })
    void requests.start().catch((error: unknown) => {
      console.error('[dispatch] could not watch the wavi requests:', error)
      requests = null
    })
  } catch (error) {
    console.error('[dispatch] could not set up wavi:', error)
    requests = null
  }
  setDispatchHookHandler(async (request) => {
    if (request.event === 'WaviInbox') {
      const inbox = parseInbox(request.payload)
      if (inbox) broker.setInbox(request.sessionId, inbox)
    }
    if (request.event === 'WaviMessages' && request.agent === 'pi') return JSON.stringify({ messages: piInbox.take(request.sessionId) })
    return ''
  })
  ipcMain.on(DISPATCH_IPC.reply, (event, callId: unknown, result: unknown) => {
    if (typeof callId === 'string' && callId.length <= 64) broker.answer(event.sender, callId, result)
  })
  ipcMain.handle(DISPATCH_IPC.deliver, (event, raw: unknown) => deliver(raw, event.sender))
  app.on('will-quit', () => requests?.stop())
}
