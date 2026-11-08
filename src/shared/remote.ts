// 手机远程 (PRD F22): what the phone and Wavi say to each other, what the window hands main about its sessions, and the
// validation main applies to everything the phone sends. Pure. The transport and its encryption are main's
// (src/main/remote); the phone app speaks the same messages inside them.
import { isCliAgent, type CliAgent } from './agents'
import type { PendingPrompt } from './agent-events'
import { isSettingKind, parseSessionSettings, settingValue, type SessionSettings, type SettingKind } from './session-settings'
import type { ChatItem } from './transcript-chat'
import type { AgentKind, SessionStatus } from './types'

export const REMOTE_IPC = {
  /** main → renderer: RemoteStatus whenever it changes. */
  status: 'remote:status',
  /** renderer → main (invoke): the current RemoteStatus. */
  getStatus: 'remote:get-status',
  /** renderer → main (invoke): a fresh pairing code. */
  newCode: 'remote:new-code',
  /** renderer → main (send): 设置 · 手机 closed, so its pairing code goes. */
  closePairing: 'remote:close-pairing',
  /** renderer → main (invoke, deviceId): forget a paired phone and close its connection. */
  revoke: 'remote:revoke',
  /** renderer → main (send): the window's sessions, whenever they change while a phone is connected. */
  sessions: 'remote:sessions',
  /** main → renderer: something the phone asked the window that owns a session to do (RemoteWindowRequest). */
  request: 'remote:request',
  /** renderer → main (send, callId, RemoteResult): the window's answer. */
  reply: 'remote:reply'
} as const

/** Default port of the phone server (设置 · 手机); one per Mac, the dev profile included. */
export const DEFAULT_REMOTE_PORT = 7429
/**
 * What the phone and the Mac speak: bumped when a change would break the other side, so a phone can say which of the
 * two needs updating (Figma 62, 「需要更新」) instead of failing in odd ways. A Mac without it in hello speaks 1.
 */
export const REMOTE_PROTOCOL = 1

export const REMOTE_LIMITS = {
  /** A pairing code is good for this long and this many wrong tries. */
  codeMs: 5 * 60_000,
  codeTries: 5,
  textChars: 32_000,
  photos: 6,
  photoBytes: 10 * 1024 * 1024,
  /** One WebSocket message, photos included (base64 adds a third). */
  frameBytes: 90 * 1024 * 1024,
  /** Feed items per page. */
  feedPage: 200,
  /** The window must answer a forwarded request within this. */
  windowAnswerMs: 8_000,
  answers: 8,
  answerChars: 2_000
} as const

/** Letters and digits nobody misreads (no 0/O, 1/I/L). */
export const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const PAIRING_CODE_LENGTH = 6

/** `4KX92Q` → `4KX-92Q`, how 设置 · 手机 shows it. */
export const formatPairingCode = (code: string): string => (code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code)

/** What the phone typed or scanned → the bare code; null when it cannot be one. */
export function normalizePairingCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.toUpperCase().replace(/[\s-]/g, '')
  if (code.length !== PAIRING_CODE_LENGTH) return null
  return [...code].every((c) => PAIRING_ALPHABET.includes(c)) ? code : null
}

export interface RemoteAddress {
  kind: 'tailscale' | 'lan'
  /** What 设置 · 手机 shows: a MagicDNS name or an IP. */
  host: string
  url: string
}

export interface RemoteDevice {
  id: string
  name: string
  pairedAt: number
  lastSeenAt: number | null
  online: boolean
}

export interface RemotePairing {
  code: string
  expiresAt: number
  /** What the QR code holds (`wavi://pair?d=…`). */
  link: string
}

/** 设置 · 手机 (Figma 45K). */
export interface RemoteStatus {
  enabled: boolean
  port: number
  /** The server is accepting connections. */
  listening: boolean
  /** Why it is not (port taken, …); English, for logs and the tooltip. */
  error?: string
  addresses: RemoteAddress[]
  pairing: RemotePairing | null
  /** Too many wrong codes were tried: no code until 换一个. */
  pairingLocked: boolean
  devices: RemoteDevice[]
}

/** What the QR code carries: where to connect, the one-time code and the Mac's public key (X25519, base64url). */
export interface PairingOffer {
  v: 1
  name: string
  urls: string[]
  code: string
  key: string
}

export function pairingLink(offer: PairingOffer): string {
  return `wavi://pair?d=${base64url(JSON.stringify(offer))}`
}

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------------------------------------------------------------------------------------------
// Sessions as the phone sees them
// ---------------------------------------------------------------------------------------------

export interface RemoteProject {
  id: string
  name: string
}

/** An exit of Git · 变更 as the phone shows it (Figma 45I; PRD F16): the window works out which apply and what blocks them. */
export interface RemoteExit {
  /** `open-pr`: the branch's PR is open and there is nothing to send; the phone opens `url`. */
  kind: 'main' | 'pr' | 'push-pr' | 'open-pr'
  label: string
  /** Why it cannot run now (UI copy), or null. */
  blocker: string | null
  url?: string
}

/** What 45I's bottom shows for a session's worktree. */
export interface RemoteExits {
  /** Null when there is nothing to ship (merged already, or no work yet). */
  primary: RemoteExit | null
  secondary: RemoteExit | null
  /** The branch's PR, for the PR line. */
  pr: { number: number; state: string; url: string } | null
  base: string | null
  /** The base has branch protection on GitHub; null when unknown. */
  baseProtected: boolean | null
  /** 归档 (PRD F15): why it cannot run now, or null. */
  archive: { blocker: string | null }
}

export type RemoteStepState = 'pending' | 'working' | 'done' | 'failed'
export type RemoteShipField = 'commit' | 'title' | 'body' | 'draft'

/** An exit in progress (Figma 45J), from the window's Ship block state (PRD F16 v1.78). */
export interface RemoteShip {
  kind: 'main' | 'pr' | 'push-pr'
  title: string
  /** Who writes the text (Claude / Codex / …). */
  agent: string
  /** writing: the agent writes; glance: the text waits for a last look; running: Wavi's own steps. */
  stage: 'writing' | 'glance' | 'running'
  steps: { id: string; label: string; state: RemoteStepState; note?: string }[]
  texts: { commit: string; title: string; body: string; draft: boolean }
  /** The glance's editable fields, top to bottom. */
  fields: RemoteShipField[]
  submitLabel: string
  submitBlocker: string | null
  error: { step: string; message: string; output?: string; conflicts: boolean; pushRefused: boolean } | null
}

/** What the phone may do to an exit (the Ship block's buttons). */
export type RemoteShipAction =
  | { do: 'start'; exit: 'main' | 'pr' | 'push-pr' }
  | { do: 'edit'; texts: Partial<RemoteShip['texts']> }
  | { do: 'submit' | 'retry' | 'cancel' | 'conflicts' | 'switch-pr' }

/** One row of the phone's session list (Figma 45B). */
export interface RemoteSession {
  id: string
  projectId: string
  title: string
  agent: AgentKind
  status: SessionStatus
  /** 当前动作, or what the session waits for. */
  action?: string
  /** Epoch ms the status began (已等 2m). */
  since?: number
  activity: number
  branch?: string
  model?: string
  /** One line of the last reply. */
  reply?: string
  /** An exit of its worktree in progress (45J). */
  ship?: RemoteShip
  /** How the last exit ended (`已合并到 main 并推送 · a41c9e2`). */
  shipNotice?: string
  /** Model, effort and permission for this session (Figma 64B–64F). */
  settings?: SessionSettings
}

export interface RemoteSessionList {
  projects: RemoteProject[]
  sessions: RemoteSession[]
}

/** Where a session runs, for main only (git and the transcript read it; the phone never sees local paths). */
export interface RemoteSessionFolder {
  cwd: string
  base?: string
  /** The agent's own conversation id: finds the transcript before any hook named it (a session the daemon kept). */
  agentSession?: string
}

/** What the window sends main: the list plus, for main only, each session's folder and each project's root. */
export interface RemoteWindowSessions extends RemoteSessionList {
  folders: Record<string, RemoteSessionFolder>
  roots: Record<string, string>
}

// ---------------------------------------------------------------------------------------------
// Phone → Wavi
// ---------------------------------------------------------------------------------------------

export interface RemotePhoto {
  name: string
  /** base64 of the file as the phone has it (HEIC, JPEG, PNG …); main sniffs the type. */
  data: string
}

export type PhoneCommand =
  | { type: 'snapshot' }
  /** The phone opened a session (null: left it): answers with the newest page; what is appended is pushed after it. */
  | { type: 'watch'; session: string | null }
  /** A page of the session's conversation, oldest first, ending before item `before` (the newest page without it). */
  | { type: 'feed'; session: string; before?: number }
  | { type: 'send'; session: string; text: string; photos: RemotePhoto[] }
  | { type: 'interrupt'; session: string }
  | { type: 'permission'; prompt: string; decision: 'allow-once' | 'allow-always' | 'deny' }
  /** AskUserQuestion: question text → the chosen label (or what the user wrote). */
  | { type: 'answer'; prompt: string; answers: Record<string, string> }
  | { type: 'new-session-info'; project: string }
  | { type: 'new-session'; project: string; workdir: 'worktree' | 'current'; agent: CliAgent; base?: string; branch?: string; prompt?: string }
  | { type: 'changes'; session: string }
  /** One file of `changes`: its unified diff (Git · 变更's own groups, PRD F5). */
  | { type: 'diff'; session: string; path: string; scope: 'uncommitted' | 'committed'; oldPath?: string; untracked?: boolean }
  /** Git · 变更's exits for the session's worktree (RemoteExits). */
  | { type: 'exits'; session: string }
  | { type: 'ship'; session: string; action: RemoteShipAction }
  /** 归档 the session's worktree (PRD F15). */
  | { type: 'archive'; session: string }
  /** Set the session's model, effort or permission, for this session only (Figma 64B–64D). */
  | { type: 'set-setting'; session: string; kind: SettingKind; value: string }

export type PhoneRequest = PhoneCommand & { id: number }

const record = (raw: unknown): Record<string, unknown> | null => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null)
const ID = /^[A-Za-z0-9_-]{1,128}$/
const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const cleanText = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max && !v.includes('\0') ? v : null)
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/
/** A path inside the worktree, as git prints it. */
const relPath = (v: unknown): string | null => {
  const path = cleanText(v, 4096)
  return path && !path.startsWith('/') && !path.split('/').includes('..') ? path : null
}

function photos(raw: unknown): RemotePhoto[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > REMOTE_LIMITS.photos) return null
  const out: RemotePhoto[] = []
  for (const item of raw) {
    const p = record(item)
    const name = cleanText(p?.name, 200)
    if (!p || name === null || typeof p.data !== 'string' || p.data.length === 0) return null
    if (p.data.length > Math.ceil(REMOTE_LIMITS.photoBytes / 3) * 4 || !BASE64.test(p.data)) return null
    out.push({ name, data: p.data })
  }
  return out
}

const SHIP_TEXT = { commit: 20_000, title: 500, body: 60_000 } as const

function shipAction(raw: unknown): RemoteShipAction | null {
  const a = record(raw)
  if (!a) return null
  switch (a.do) {
    case 'start':
      return a.exit === 'main' || a.exit === 'pr' || a.exit === 'push-pr' ? { do: 'start', exit: a.exit } : null
    case 'edit': {
      const t = record(a.texts)
      if (!t) return null
      const texts: Partial<RemoteShip['texts']> = {}
      for (const key of ['commit', 'title', 'body'] as const) {
        if (t[key] === undefined) continue
        const value = cleanText(t[key], SHIP_TEXT[key])
        if (value === null) return null
        texts[key] = value
      }
      if (t.draft !== undefined) {
        if (typeof t.draft !== 'boolean') return null
        texts.draft = t.draft
      }
      return Object.keys(texts).length > 0 ? { do: 'edit', texts } : null
    }
    case 'submit':
    case 'retry':
    case 'cancel':
    case 'conflicts':
    case 'switch-pr':
      return { do: a.do }
    default:
      return null
  }
}

function answers(raw: unknown): Record<string, string> | null {
  const a = record(raw)
  if (!a) return null
  const entries = Object.entries(a)
  if (entries.length === 0 || entries.length > REMOTE_LIMITS.answers) return null
  const out: Record<string, string> = {}
  for (const [question, answer] of entries) {
    const q = cleanText(question, REMOTE_LIMITS.answerChars)
    const v = cleanText(answer, REMOTE_LIMITS.answerChars)
    if (!q || v === null || v.trim() === '') return null
    out[q] = v
  }
  return out
}

/** A decrypted message from the phone → a request, or null when anything about it is off. */
export function parsePhoneRequest(raw: unknown): PhoneRequest | null {
  const v = record(raw)
  if (!v || typeof v.id !== 'number' || !Number.isSafeInteger(v.id) || v.id < 0) return null
  const id = v.id
  switch (v.type) {
    case 'snapshot':
      return { id, type: 'snapshot' }
    case 'watch':
      return v.session === null ? { id, type: 'watch', session: null } : isId(v.session) ? { id, type: 'watch', session: v.session } : null
    case 'feed': {
      if (!isId(v.session)) return null
      if (v.before === undefined) return { id, type: 'feed', session: v.session }
      return typeof v.before === 'number' && Number.isSafeInteger(v.before) && v.before >= 0 ? { id, type: 'feed', session: v.session, before: v.before } : null
    }
    case 'send': {
      const text = cleanText(v.text ?? '', REMOTE_LIMITS.textChars)
      const list = photos(v.photos)
      if (!isId(v.session) || text === null || !list || (text.trim() === '' && list.length === 0)) return null
      return { id, type: 'send', session: v.session, text, photos: list }
    }
    case 'interrupt':
      return isId(v.session) ? { id, type: 'interrupt', session: v.session } : null
    case 'set-setting': {
      const value = settingValue(v.value)
      return isId(v.session) && isSettingKind(v.kind) && value !== null ? { id, type: 'set-setting', session: v.session, kind: v.kind, value } : null
    }
    case 'permission':
      if (!isId(v.prompt) || (v.decision !== 'allow-once' && v.decision !== 'allow-always' && v.decision !== 'deny')) return null
      return { id, type: 'permission', prompt: v.prompt, decision: v.decision }
    case 'answer': {
      const a = answers(v.answers)
      return isId(v.prompt) && a ? { id, type: 'answer', prompt: v.prompt, answers: a } : null
    }
    case 'new-session-info':
      return isId(v.project) ? { id, type: 'new-session-info', project: v.project } : null
    case 'new-session': {
      if (!isId(v.project) || (v.workdir !== 'worktree' && v.workdir !== 'current') || !isCliAgent(v.agent)) return null
      if (v.base !== undefined && (typeof v.base !== 'string' || !BRANCH.test(v.base))) return null
      if (v.branch !== undefined && (typeof v.branch !== 'string' || !BRANCH.test(v.branch))) return null
      const prompt = v.prompt === undefined ? undefined : cleanText(v.prompt, REMOTE_LIMITS.textChars)
      if (prompt === null) return null
      return {
        id,
        type: 'new-session',
        project: v.project,
        workdir: v.workdir,
        agent: v.agent,
        ...(typeof v.base === 'string' ? { base: v.base } : {}),
        ...(typeof v.branch === 'string' ? { branch: v.branch } : {}),
        ...(prompt && prompt.trim() ? { prompt } : {})
      }
    }
    case 'changes':
      return isId(v.session) ? { id, type: 'changes', session: v.session } : null
    case 'diff': {
      const path = relPath(v.path)
      const oldPath = v.oldPath === undefined ? undefined : relPath(v.oldPath)
      if (!isId(v.session) || !path || oldPath === null || (v.scope !== 'uncommitted' && v.scope !== 'committed')) return null
      if (v.untracked !== undefined && typeof v.untracked !== 'boolean') return null
      return { id, type: 'diff', session: v.session, path, scope: v.scope, ...(oldPath ? { oldPath } : {}), ...(v.untracked === true ? { untracked: true } : {}) }
    }
    case 'exits':
      return isId(v.session) ? { id, type: 'exits', session: v.session } : null
    case 'ship': {
      const action = shipAction(v.action)
      return isId(v.session) && action ? { id, type: 'ship', session: v.session, action } : null
    }
    case 'archive':
      return isId(v.session) ? { id, type: 'archive', session: v.session } : null
    default:
      return null
  }
}

// ---------------------------------------------------------------------------------------------
// Wavi → phone
// ---------------------------------------------------------------------------------------------

export type RemoteResult = { ok: true; data?: unknown } | { ok: false; error: string }

export type PhoneResponse = { re: number } & RemoteResult

/** A prompt as the phone gets it: `answerable` while an answer from the phone would reach the agent (its request is held). */
export type RemotePrompt = PendingPrompt & { answerable: boolean }

export type PhoneEvent =
  /** `urls`: where this Mac can be reached now (its LAN address may have changed since pairing). */
  | { event: 'hello'; data: { name: string; version: string; protocol: number; urls?: string[] } }
  | { event: 'sessions'; data: RemoteSessionList }
  | { event: 'prompts'; data: RemotePrompt[] }
  /** New or changed items at the end of a watched session's feed; `reset` replaces what the phone has. */
  | { event: 'feed'; data: { session: string; items: ChatItem[]; start: number; reset?: boolean } }

export const remoteFail = (error: string): RemoteResult => ({ ok: false, error })

/** A window's answer to a forwarded request → a result (anything else reads as a failure). */
export function parseRemoteResult(raw: unknown): RemoteResult | null {
  const v = record(raw)
  if (!v) return null
  if (v.ok === true) return v.data === undefined ? { ok: true } : { ok: true, data: v.data }
  if (v.ok === false && typeof v.error === 'string') return { ok: false, error: v.error.slice(0, 500) }
  return null
}

// ---------------------------------------------------------------------------------------------
// main → window
// ---------------------------------------------------------------------------------------------

/** What main asks the window that owns a session (or any window, for a new session) to do for the phone. */
export type RemoteWindowCommand =
  /** Photos are files main already wrote (HEIC turned into JPEG). */
  | { type: 'send'; session: string; text: string; paths: string[] }
  | { type: 'interrupt'; session: string }
  | { type: 'new-session'; project: string; workdir: 'worktree' | 'current'; agent: CliAgent; base?: string; branch?: string; prompt?: string }
  | { type: 'exits'; session: string }
  | { type: 'ship'; session: string; action: RemoteShipAction }
  | { type: 'archive'; session: string }
  | { type: 'set-setting'; session: string; kind: SettingKind; value: string }
  /** The phone opened the session: it counts as shown, so a restored one starts (its 会话设置 come from the agent). */
  | { type: 'open'; session: string }

export interface RemoteWindowRequest {
  callId: string
  command: RemoteWindowCommand
}

const STATUSES: ReadonlySet<unknown> = new Set<SessionStatus>(['running', 'needs_you', 'done_unread', 'idle', 'error', 'exited'])
const optText = (v: unknown, max: number): string | undefined | null => (v === undefined ? undefined : cleanText(v, max))
const optTime = (v: unknown): number | undefined | null => (v === undefined ? undefined : typeof v === 'number' && Number.isFinite(v) ? v : null)

const STEP_STATES: ReadonlySet<unknown> = new Set<RemoteStepState>(['pending', 'working', 'done', 'failed'])
const SHIP_FIELDS: ReadonlySet<unknown> = new Set<RemoteShipField>(['commit', 'title', 'body', 'draft'])

/** The window's exit in progress; null when it does not validate. */
function windowShip(raw: unknown): RemoteShip | null {
  const v = record(raw)
  const t = record(v?.texts)
  if (!v || !t || (v.kind !== 'main' && v.kind !== 'pr' && v.kind !== 'push-pr') || (v.stage !== 'writing' && v.stage !== 'glance' && v.stage !== 'running')) return null
  const title = cleanText(v.title, 300)
  const agent = cleanText(v.agent, 100)
  const submitLabel = cleanText(v.submitLabel, 100)
  const submitBlocker = v.submitBlocker === null ? null : cleanText(v.submitBlocker, 300)
  if (title === null || agent === null || submitLabel === null || (submitBlocker === null && v.submitBlocker !== null)) return null
  if (!Array.isArray(v.steps) || v.steps.length > 12 || !Array.isArray(v.fields) || !v.fields.every((f) => SHIP_FIELDS.has(f))) return null
  const steps: RemoteShip['steps'] = []
  for (const raw of v.steps) {
    const step = record(raw)
    const label = cleanText(step?.label, 300)
    const note = step?.note === undefined ? undefined : cleanText(step.note, 300)
    if (!step || typeof step.id !== 'string' || label === null || !STEP_STATES.has(step.state) || note === null) return null
    steps.push({ id: step.id.slice(0, 20), label, state: step.state as RemoteStepState, ...(note ? { note } : {}) })
  }
  const commit = cleanText(t.commit, SHIP_TEXT.commit)
  const shipTitle = cleanText(t.title, SHIP_TEXT.title)
  const body = cleanText(t.body, SHIP_TEXT.body)
  if (commit === null || shipTitle === null || body === null || typeof t.draft !== 'boolean') return null
  let error: RemoteShip['error'] = null
  if (v.error !== null) {
    const e = record(v.error)
    const message = cleanText(e?.message, 2000)
    const output = e?.output === undefined ? undefined : cleanText(e.output, 8000)
    if (!e || typeof e.step !== 'string' || message === null || output === null) return null
    error = { step: e.step.slice(0, 20), message, ...(output ? { output } : {}), conflicts: e.conflicts === true, pushRefused: e.pushRefused === true }
  }
  return { kind: v.kind, title, agent, stage: v.stage, steps, texts: { commit, title: shipTitle, body, draft: t.draft }, fields: v.fields as RemoteShipField[], submitLabel, submitBlocker, error }
}

function windowSession(raw: unknown): RemoteSession | null {
  const s = record(raw)
  if (!s || !isId(s.id) || !isId(s.projectId) || !STATUSES.has(s.status) || (s.agent !== 'shell' && !isCliAgent(s.agent))) return null
  const title = cleanText(s.title, 500)
  const activity = optTime(s.activity)
  const fields = { action: optText(s.action, 500), since: optTime(s.since), branch: optText(s.branch, 300), model: optText(s.model, 100), reply: optText(s.reply, 1000) }
  if (title === null || activity === undefined || activity === null || Object.values(fields).some((f) => f === null)) return null
  const out: RemoteSession = { id: s.id, projectId: s.projectId, title, agent: s.agent as AgentKind, status: s.status as SessionStatus, activity }
  for (const [k, f] of Object.entries(fields)) if (f !== undefined) (out as unknown as Record<string, unknown>)[k] = f
  if (s.ship !== undefined) {
    const ship = windowShip(s.ship)
    if (!ship) return null
    out.ship = ship
  }
  const notice = optText(s.shipNotice, 300)
  if (notice === null) return null
  if (notice) out.shipNotice = notice
  // Settings that do not validate are left off; the session still shows.
  const settings = s.settings === undefined ? null : parseSessionSettings(s.settings)
  if (settings) out.settings = settings
  return out
}

/**
 * The window's session list (IPC from the renderer): validated field by field like anything else main receives. An
 * entry that does not validate is left out (a session whose folder is not an absolute path), not the whole list.
 */
export function parseWindowSessions(raw: unknown): RemoteWindowSessions | null {
  const v = record(raw)
  const folders = record(v?.folders)
  if (!v || !Array.isArray(v.projects) || !Array.isArray(v.sessions) || !folders) return null
  if (v.projects.length > 500 || v.sessions.length > 2000) return null
  const projects: RemoteProject[] = []
  for (const p of v.projects) {
    const r = record(p)
    const name = cleanText(r?.name, 300)
    if (r && isId(r.id) && name !== null) projects.push({ id: r.id, name })
  }
  const out: RemoteWindowSessions['folders'] = {}
  for (const [id, f] of Object.entries(folders)) {
    const r = record(f)
    const cwd = absolute(r?.cwd)
    if (!isId(id) || !r || !cwd) continue
    const base = optText(r.base, 300)
    const agentSession = r.agentSession === undefined ? undefined : isId(r.agentSession) ? r.agentSession : null
    if (base === null || agentSession === null) continue
    out[id] = { cwd, ...(base ? { base } : {}), ...(agentSession ? { agentSession } : {}) }
  }
  // A session main cannot place is no use to the phone (no transcript, no git).
  const sessions = v.sessions.map(windowSession).filter((s): s is RemoteSession => s !== null && out[s.id] !== undefined)
  const roots: Record<string, string> = {}
  for (const [id, root] of Object.entries(record(v.roots) ?? {})) {
    const path = absolute(root)
    if (isId(id) && path) roots[id] = path
  }
  return { projects, sessions, folders: out, roots }
}

function absolute(v: unknown): string | null {
  const path = cleanText(v, 4096)
  return path && path.startsWith('/') && !path.split('/').includes('..') ? path : null
}

/** `window.tr.remote` (PRD F22). */
export interface RemoteApi {
  /** 设置 · 手机 is open: the status, with a pairing code (made now when there is none). */
  status(): Promise<RemoteStatus>
  /** 换一个. */
  newCode(): Promise<RemoteStatus>
  /** 设置 · 手机 closed: the pairing code stops working. */
  closePairing(): void
  revoke(deviceId: string): Promise<RemoteStatus>
  onStatus(listener: (status: RemoteStatus) => void): () => void
  /** The window's sessions, sent whenever they change while 允许手机连接 is on. */
  publishSessions(list: RemoteWindowSessions): void
  onRequest(listener: (request: RemoteWindowRequest) => void): () => void
  reply(callId: string, result: RemoteResult): void
}
