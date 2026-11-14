// User settings (PRD §4 F7). Persisted by main in <userData>/settings.json; every window receives
// changes through TrApi.settings.onChange. Pure: sanitizing never throws, unknown/invalid values
// fall back to defaults so a hand-edited file can't break the app.
import { headlessAgent, type HeadlessAgent } from './agents'
import { normalizeHex } from './color'
import { DEFAULT_PORT_BASE, PORT_BASE_LIMITS } from './ports'
import { DEFAULT_REMOTE_PORT } from './remote'

export type ThemePreference = 'system' | 'dark' | 'light'

/**
 * 终端底色 (PRD F7 v1.71). `theme`: the terminal follows the app theme (white in light, near-black in dark).
 * `custom`: the terminal uses `color`; `color` is kept while the mode is `theme`, so switching back restores it.
 */
export interface TerminalBackground {
  mode: 'theme' | 'custom'
  /** `#rrggbb`. */
  color: string
}

/**
 * The colors of an imported Ghostty / iTerm theme (设置 · 外观 · 导入主题…), used while the 底色 is `custom`. The
 * background is the 底色 itself. `selection` may carry an alpha (`#rrggbbaa`); `ansi` holds the 16 ANSI colors.
 */
export interface TerminalColors {
  foreground: string
  cursor: string
  selection: string
  ansi: string[]
}

export const TERMINAL_ANSI_COUNT = 16

/**
 * 设置 · 外观 · 全屏背景 (PRD v1.97, Figma 38): the light field drawn behind the glass in full screen, where there is no
 * desktop behind the window for the Liquid Glass to show. Palettes from the author's 配图底托; colours in tokens.css.
 * `auto` takes 晴空 in light mode and 夜火 in dark.
 */
export const FULLSCREEN_BACKDROPS = ['sky', 'meadow', 'lake', 'dune', 'pine', 'dusk', 'coral', 'sunset', 'ember', 'plum'] as const
export type FullscreenBackdrop = 'auto' | (typeof FULLSCREEN_BACKDROPS)[number]

/** 对话宽度 (PRD F23 v1.127, Figma 51): the chat column's width; `full` fills the card. */
export const CHAT_WIDTHS = ['narrow', 'medium', 'wide', 'full'] as const
export type ChatWidth = (typeof CHAT_WIDTHS)[number]
export const CHAT_WEIGHTS = [300, 400, 500] as const
export type ChatWeight = (typeof CHAT_WEIGHTS)[number]

/** 设置 · 外观 · 对话 (PRD F23 v1.127, Figma 51D): how GUI sessions read. The terminal's own fonts stay apart. */
export interface ChatAppearance {
  width: ChatWidth
  /** Latin family first in the stack; '' is the system UI font. */
  latinFont: string
  /** CJK family after it. */
  cjkFont: string
  fontWeight: ChatWeight
  /** px */
  fontSize: number
  /** Opacity of the chat card over the window's glass, 0.2–1 (as terminalOpacity). */
  opacity: number
  /** The user's picture beside their messages: a 256² data URL (webp / png / jpeg), or '' for none. */
  avatar: string
}

/**
 * 窗口 · 材质 (PRD §5 v1.174, Figma 66′): 玻璃 shows the desktop through the window (macOS 26's Liquid Glass, vibrancy
 * before it: main/appearance.ts picks); 实色 (v1.139, Figma 57) is an opaque window in the softer solid palette.
 */
export type WindowMaterial = 'glass' | 'solid'

export interface AppearanceSettings {
  theme: ThemePreference
  fullscreenBackdrop: FullscreenBackdrop
  /** Latin monospace family for the terminal. */
  latinFont: string
  /** CJK family placed right after latinFont in the stack. */
  cjkFont: string
  /** Terminal font size, px. */
  fontSize: number
  /** Terminal line height as a multiple of fontSize (xterm semantics). */
  lineHeight: number
  ligatures: boolean
  // The terminal background is a plain color (PRD v1.71): the theme's own — white in light mode, near-black in
  // dark — or one the user picks or imports. Old gradient / image values (PRD v1.2) are dropped on load.
  terminalBackground: TerminalBackground
  /** Colors of an imported theme; null until one is imported. Applied while terminalBackground.mode is custom. */
  terminalColors: TerminalColors | null
  /** Opacity of the terminal surface over the background, 0.2–1. */
  terminalOpacity: number
  /** Terminal screen reader mode (VoiceOver reads the output). */
  screenReader: boolean
  /** GUI sessions (Figma 51D). */
  chat: ChatAppearance
  /** The window's base layer. */
  windowMaterial: WindowMaterial
  /** 窗口底层不透明度: the theme's color over the glass (the sidebar's), 0 (none) – 1. 实色 has none. */
  shellOpacity: number
}

/** TR_PORT blocks (PRD F4 · 脚本与端口): worktree n gets `base + 10n` … `+ 9`. */
export interface PortSettings {
  base: number
  /** 设置 · Worktree · 端口 (PRD F17): a port that starts listening in the session on screen opens in the right panel's browser. */
  autoOpen: boolean
}

/** 设置 · 自动化 · 代码审阅 (PRD F13). Every switch starts off: a review spends the user's own quota. */
export interface ReviewSettings {
  /** Open the merge sheet → start a review. The checklist gains a line; the merge is not blocked. */
  beforeMerge: boolean
  /** Before Wavi pushes the base to origin. The push is not blocked. */
  beforePush: boolean
  /** A Stop hook, and this worktree gained a commit during the turn. */
  afterTurnWithCommits: boolean
  /** `builtin` parses a background process into comments. `agent-command` types `/code-review` or `/review` into the terminal. */
  mode: 'builtin' | 'agent-command'
  rules: 'default' | 'custom'
  customRules: string
  /** `other`: Claude sessions are reviewed by Codex and the other way round (PRD F13 v1.63). */
  reviewer: 'same' | 'other'
  /** Model for reviews Claude runs. Empty uses the CLI's own model. */
  model: string
  /** Model for reviews Codex runs. Empty uses the CLI's own model. */
  codexModel: string
}

/** 设置 · Worktree · 归档 (PRD F15). */
export interface ArchiveSettings {
  /** After a merge that kept the worktree, archive it. Off by default. */
  afterMerge: boolean
}

/** 设置 · 额度 · 提醒 (PRD F11, Figma 18D). On by default: it only notifies. */
export interface AlertSettings {
  /** A plan window crossed 75 % / 90 % / used up: one system notification each, per period. */
  usage: boolean
}

/**
 * 设置 · 自动化 · PR (PRD F16 v1.63). The two switches here are what a new PR starts with; each PR has its own in
 * Git · 变更. Both start off: they spend the user's quota and act on GitHub as the user.
 */
export interface PrSettings {
  /** 创建 PR 面板 ends the body with this turn's checks and Wavi's review. On by default; the user can delete it there. */
  evidence: boolean
  /** New PRs start with 自动修复 on. */
  autoFix: boolean
  /** New PRs start with 通过后合并 on. */
  mergeWhenGreen: boolean
  /** 自动修复 sends at most this many times per PR (1–5). */
  maxAutoFixes: number
  /** Bot logins whose review comments 自动修复 may send (besides the user's own). None by default. */
  bots: string[]
  /**
   * AI 写 in 创建 PR 面板 (v1.68): which CLI writes the commit message and the PR title / body — the session's own
   * agent, or always Claude / Codex — on the user's own login, in a separate headless run.
   */
  writer: 'session' | HeadlessAgent
  /** Model for Claude's runs; empty uses the CLI's own. Haiku by default: a commit message needs no big model. */
  writerClaudeModel: string
  /** Model for Codex's runs; empty uses the CLI's own (at low reasoning effort). */
  writerCodexModel: string
  /** Opening the sheet runs AI 写 at once. Off by default: it spends the user's quota. */
  writeOnOpen: boolean
}

/**
 * 设置 · 自动化 · 派活 (PRD F21 v1.66). An agent may start new sessions through Wavi's tools; each batch waits for the
 * user's 开始 unless `autoApprove` is on (off by default: it spends the user's quota).
 */
export interface DispatchSettings {
  /** Agents get Wavi's dispatch tools (takes effect for agents started from now on). */
  tools: boolean
  /** Start the sessions an agent asks for without the confirmation strip (the limits still apply). */
  autoApprove: boolean
}

/** 设置 · 自动化 · 定时任务 (PRD F24). */
export interface ScheduleSettings {
  /** 全部暂停: nothing runs or catches up; on again, every task starts from its next time. */
  paused: boolean
  /** Wavi 关着时也运行: after ⌘Q the pty daemon opens Wavi in the background when a task is due. */
  whileClosed: boolean
  /** 登录时在后台打开 Wavi (a macOS login item). */
  openAtLogin: boolean
  /** 让 agent 建定时任务: `wavi schedule`, each one confirmed by the user. */
  agents: boolean
}

/** 设置 · 手机 (PRD F22). Off until the user turns it on: while on, Wavi listens on `port` for paired phones. */
export interface RemoteSettings {
  enabled: boolean
  port: number
  /** Push 等你处理 / 做完 / 出错 to the paired phones. */
  push: boolean
}

export interface AppSettings {
  version: 1
  appearance: AppearanceSettings
  ports: PortSettings
  review: ReviewSettings
  archive: ArchiveSettings
  alerts: AlertSettings
  pr: PrSettings
  dispatch: DispatchSettings
  remote: RemoteSettings
  schedules: ScheduleSettings
}

/** An appearance patch; its nested object (chat) merges one level deeper. */
export type AppearancePatch = Partial<Omit<AppearanceSettings, 'chat'>> & {
  chat?: Partial<ChatAppearance>
}

export interface SettingsPatch {
  appearance?: AppearancePatch
  ports?: Partial<PortSettings>
  review?: Partial<ReviewSettings>
  archive?: Partial<ArchiveSettings>
  alerts?: Partial<AlertSettings>
  pr?: Partial<PrSettings>
  dispatch?: Partial<DispatchSettings>
  remote?: Partial<RemoteSettings>
  schedules?: Partial<ScheduleSettings>
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  appearance: {
    theme: 'system',
    fullscreenBackdrop: 'auto',
    latinFont: 'JetBrains Mono Variable',
    cjkFont: 'PingFang SC',
    fontSize: 13,
    // xterm multiplies the font's own line height: 1 is what a normal terminal shows. Taller rows stretch
    // block-drawn art such as the Claude Code logo.
    lineHeight: 1,
    ligatures: false,
    terminalBackground: { mode: 'theme', color: '#0a0a0a' },
    terminalColors: null,
    terminalOpacity: 1,
    screenReader: false,
    chat: { width: 'narrow', latinFont: '', cjkFont: 'PingFang SC', fontWeight: 400, fontSize: 14, opacity: 1, avatar: '' },
    windowMaterial: 'glass',
    // A light theme tint (PRD §5 v1.174, Figma 66′): untinted Liquid Glass leaves the sidebar's secondary text faint on a bright desktop.
    shellOpacity: 0.3
  },
  ports: { base: DEFAULT_PORT_BASE, autoOpen: true },
  review: {
    beforeMerge: false,
    beforePush: false,
    afterTurnWithCommits: false,
    mode: 'builtin',
    rules: 'default',
    customRules: '',
    reviewer: 'same',
    model: '',
    codexModel: ''
  },
  archive: { afterMerge: false },
  alerts: { usage: true },
  pr: {
    evidence: true,
    autoFix: false,
    mergeWhenGreen: false,
    maxAutoFixes: 3,
    bots: [],
    writer: 'session',
    writerClaudeModel: 'haiku',
    writerCodexModel: '',
    writeOnOpen: false
  },
  dispatch: { tools: true, autoApprove: false },
  remote: { enabled: false, port: DEFAULT_REMOTE_PORT, push: true },
  schedules: { paused: false, whileClosed: true, openAtLogin: false, agents: true }
}

const MAX_REVIEW_RULES = 8000
const REVIEW_MODEL = /^[A-Za-z0-9._:@/-]{1,64}$/

export const LIMITS = {
  fontSize: { min: 9, max: 28 },
  lineHeight: { min: 1, max: 2.2 },
  terminalOpacity: { min: 0.2, max: 1 },
  fontName: 120,
  chatFontSize: { min: 12, max: 18 },
  chatOpacity: { min: 0.2, max: 1 },
  shellOpacity: { min: 0, max: 1 },
  /** A 256² webp is ~10–40 KB; the cap keeps a stray big image out of settings.json. */
  avatar: 400_000
} as const

const AVATAR = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/

const percent = (value: number): number => Math.round(value * 100) / 100

function chat(value: unknown): ChatAppearance {
  const d = DEFAULT_SETTINGS.appearance.chat
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const latin = typeof v.latinFont === 'string' && v.latinFont.trim().length <= LIMITS.fontName ? v.latinFont.trim() : d.latinFont
  return {
    width: (CHAT_WIDTHS as readonly unknown[]).includes(v.width) ? (v.width as ChatWidth) : d.width,
    latinFont: latin,
    cjkFont: str(v.cjkFont, d.cjkFont, LIMITS.fontName),
    fontWeight: (CHAT_WEIGHTS as readonly unknown[]).includes(v.fontWeight) ? (v.fontWeight as ChatWeight) : d.fontWeight,
    fontSize: Math.round(num(v.fontSize, d.fontSize, LIMITS.chatFontSize)),
    opacity: percent(num(v.opacity, d.opacity, LIMITS.chatOpacity)),
    avatar: typeof v.avatar === 'string' && v.avatar.length <= LIMITS.avatar && (v.avatar === '' || AVATAR.test(v.avatar)) ? v.avatar : d.avatar
  }
}

/** 'liquid' and 'frosted' are what windowMaterial was called before v1.174; any other value is 玻璃 unless it is 'solid'. */
const windowMaterial = (value: unknown): WindowMaterial => (value === 'solid' ? 'solid' : 'glass')

/**
 * Before v1.174 there was one value per material ({ liquid, frosted }): the one of the material that was chosen carries
 * over. 实色 had no glass chosen, so the liquid one does, which was the default look.
 */
function shellOpacity(value: unknown, legacyMaterial: unknown): number {
  const picked = isRecord(value) ? (legacyMaterial === 'frosted' ? value.frosted : value.liquid) : value
  return percent(num(picked, DEFAULT_SETTINGS.appearance.shellOpacity, LIMITS.shellOpacity))
}

function num(value: unknown, fallback: number, range: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, value))
}

function str(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' || trimmed.length > max ? fallback : trimmed
}

function terminalBackground(value: unknown): TerminalBackground {
  const d = DEFAULT_SETTINGS.appearance.terminalBackground
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return { mode: v.mode === 'custom' ? 'custom' : d.mode, color: normalizeHex(v.color) ?? d.color }
}

/** All or nothing: one bad color drops the whole imported set, so a half-read theme never reaches the terminal. */
function terminalColors(value: unknown): TerminalColors | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const foreground = normalizeHex(v.foreground)
  const cursor = normalizeHex(v.cursor)
  const selection = normalizeHex(v.selection, { alpha: true })
  if (!foreground || !cursor || !selection || !Array.isArray(v.ansi) || v.ansi.length !== TERMINAL_ANSI_COUNT) return null
  const ansi = v.ansi.map((color) => normalizeHex(color))
  if (ansi.some((color) => color === null)) return null
  return { foreground, cursor, selection, ansi: ansi as string[] }
}

function appearance(value: unknown): AppearanceSettings {
  const d = DEFAULT_SETTINGS.appearance
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    theme: v.theme === 'dark' || v.theme === 'light' || v.theme === 'system' ? v.theme : d.theme,
    fullscreenBackdrop:
      v.fullscreenBackdrop === 'auto' || (FULLSCREEN_BACKDROPS as readonly unknown[]).includes(v.fullscreenBackdrop)
        ? (v.fullscreenBackdrop as FullscreenBackdrop)
        : d.fullscreenBackdrop,
    latinFont: str(v.latinFont, d.latinFont, LIMITS.fontName),
    cjkFont: str(v.cjkFont, d.cjkFont, LIMITS.fontName),
    fontSize: Math.round(num(v.fontSize, d.fontSize, LIMITS.fontSize)),
    lineHeight: Math.round(num(v.lineHeight, d.lineHeight, LIMITS.lineHeight) * 100) / 100,
    ligatures: typeof v.ligatures === 'boolean' ? v.ligatures : d.ligatures,
    terminalBackground: terminalBackground(v.terminalBackground),
    terminalColors: terminalColors(v.terminalColors),
    terminalOpacity: Math.round(num(v.terminalOpacity, d.terminalOpacity, LIMITS.terminalOpacity) * 100) / 100,
    screenReader: typeof v.screenReader === 'boolean' ? v.screenReader : d.screenReader,
    chat: chat(v.chat),
    windowMaterial: windowMaterial(v.windowMaterial),
    shellOpacity: shellOpacity(v.shellOpacity, v.windowMaterial)
  }
}

function ports(value: unknown): PortSettings {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    base: Math.round(num(v.base, DEFAULT_PORT_BASE, PORT_BASE_LIMITS)),
    autoOpen: typeof v.autoOpen === 'boolean' ? v.autoOpen : DEFAULT_SETTINGS.ports.autoOpen
  }
}

function review(value: unknown): ReviewSettings {
  const d = DEFAULT_SETTINGS.review
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const customRules = typeof v.customRules === 'string' ? v.customRules.slice(0, MAX_REVIEW_RULES) : d.customRules
  let model = typeof v.model === 'string' && (v.model === '' || REVIEW_MODEL.test(v.model)) ? v.model : d.model
  let codexModel = typeof v.codexModel === 'string' && (v.codexModel === '' || REVIEW_MODEL.test(v.codexModel)) ? v.codexModel : d.codexModel
  // Before v1.63 one model served whichever CLI reviewed: an OpenAI model name moves to Codex.
  if (!('codexModel' in v) && /^(gpt|o\d|codex)/i.test(model)) {
    codexModel = model
    model = ''
  }
  return {
    beforeMerge: typeof v.beforeMerge === 'boolean' ? v.beforeMerge : d.beforeMerge,
    beforePush: typeof v.beforePush === 'boolean' ? v.beforePush : d.beforePush,
    afterTurnWithCommits: typeof v.afterTurnWithCommits === 'boolean' ? v.afterTurnWithCommits : d.afterTurnWithCommits,
    mode: v.mode === 'agent-command' ? 'agent-command' : d.mode,
    rules: v.rules === 'custom' ? 'custom' : d.rules,
    customRules,
    reviewer: v.reviewer === 'other' ? 'other' : d.reviewer,
    model,
    codexModel
  }
}

/** Any JSON value → valid settings. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const a = typeof v.archive === 'object' && v.archive !== null ? (v.archive as Record<string, unknown>) : {}
  const al = typeof v.alerts === 'object' && v.alerts !== null ? (v.alerts as Record<string, unknown>) : {}
  const dp = typeof v.dispatch === 'object' && v.dispatch !== null ? (v.dispatch as Record<string, unknown>) : {}
  const rm = typeof v.remote === 'object' && v.remote !== null ? (v.remote as Record<string, unknown>) : {}
  const sc = typeof v.schedules === 'object' && v.schedules !== null ? (v.schedules as Record<string, unknown>) : {}
  const sd = DEFAULT_SETTINGS.schedules
  return {
    version: 1,
    appearance: appearance(v.appearance),
    ports: ports(v.ports),
    review: review(v.review),
    archive: { afterMerge: typeof a.afterMerge === 'boolean' ? a.afterMerge : DEFAULT_SETTINGS.archive.afterMerge },
    alerts: { usage: typeof al.usage === 'boolean' ? al.usage : DEFAULT_SETTINGS.alerts.usage },
    pr: prSettings(v.pr),
    dispatch: {
      tools: typeof dp.tools === 'boolean' ? dp.tools : DEFAULT_SETTINGS.dispatch.tools,
      autoApprove: typeof dp.autoApprove === 'boolean' ? dp.autoApprove : DEFAULT_SETTINGS.dispatch.autoApprove
    },
    remote: {
      enabled: typeof rm.enabled === 'boolean' ? rm.enabled : DEFAULT_SETTINGS.remote.enabled,
      port: typeof rm.port === 'number' && Number.isInteger(rm.port) && rm.port >= 1024 && rm.port <= 65535 ? rm.port : DEFAULT_SETTINGS.remote.port,
      push: typeof rm.push === 'boolean' ? rm.push : DEFAULT_SETTINGS.remote.push
    },
    schedules: {
      paused: typeof sc.paused === 'boolean' ? sc.paused : sd.paused,
      whileClosed: typeof sc.whileClosed === 'boolean' ? sc.whileClosed : sd.whileClosed,
      openAtLogin: typeof sc.openAtLogin === 'boolean' ? sc.openAtLogin : sd.openAtLogin,
      agents: typeof sc.agents === 'boolean' ? sc.agents : sd.agents
    }
  }
}

const BOT_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$/

function prSettings(value: unknown): PrSettings {
  const d = DEFAULT_SETTINGS.pr
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const bots = Array.isArray(v.bots) ? [...new Set(v.bots.filter((b): b is string => typeof b === 'string' && BOT_LOGIN.test(b)))].slice(0, 20) : d.bots
  return {
    evidence: typeof v.evidence === 'boolean' ? v.evidence : d.evidence,
    autoFix: typeof v.autoFix === 'boolean' ? v.autoFix : d.autoFix,
    mergeWhenGreen: typeof v.mergeWhenGreen === 'boolean' ? v.mergeWhenGreen : d.mergeWhenGreen,
    maxAutoFixes: Math.round(num(v.maxAutoFixes, d.maxAutoFixes, { min: 1, max: 5 })),
    bots,
    writer: headlessAgent(v.writer) ?? d.writer,
    writerClaudeModel: typeof v.writerClaudeModel === 'string' && (v.writerClaudeModel === '' || REVIEW_MODEL.test(v.writerClaudeModel)) ? v.writerClaudeModel : d.writerClaudeModel,
    writerCodexModel: typeof v.writerCodexModel === 'string' && (v.writerCodexModel === '' || REVIEW_MODEL.test(v.writerCodexModel)) ? v.writerCodexModel : d.writerCodexModel,
    writeOnOpen: typeof v.writeOnOpen === 'boolean' ? v.writeOnOpen : d.writeOnOpen
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function mergeAppearance(current: AppearanceSettings, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...current,
    ...patch,
    chat: isRecord(patch.chat) ? { ...current.chat, ...patch.chat } : current.chat
  }
}

/** Applies a (possibly untrusted) patch and re-sanitizes the result. */
export function applySettingsPatch(current: AppSettings, patch: unknown): AppSettings {
  const p = typeof patch === 'object' && patch !== null ? (patch as Record<string, unknown>) : {}
  const nextAppearance = typeof p.appearance === 'object' && p.appearance !== null ? mergeAppearance(current.appearance, p.appearance as Record<string, unknown>) : current.appearance
  const nextPorts = typeof p.ports === 'object' && p.ports !== null ? { ...current.ports, ...(p.ports as object) } : current.ports
  const nextReview = typeof p.review === 'object' && p.review !== null ? { ...current.review, ...(p.review as object) } : current.review
  const nextArchive = typeof p.archive === 'object' && p.archive !== null ? { ...current.archive, ...(p.archive as object) } : current.archive
  const nextAlerts = typeof p.alerts === 'object' && p.alerts !== null ? { ...current.alerts, ...(p.alerts as object) } : current.alerts
  const nextPr = typeof p.pr === 'object' && p.pr !== null ? { ...current.pr, ...(p.pr as object) } : current.pr
  const nextDispatch = typeof p.dispatch === 'object' && p.dispatch !== null ? { ...current.dispatch, ...(p.dispatch as object) } : current.dispatch
  const nextRemote = typeof p.remote === 'object' && p.remote !== null ? { ...current.remote, ...(p.remote as object) } : current.remote
  const nextSchedules = typeof p.schedules === 'object' && p.schedules !== null ? { ...current.schedules, ...(p.schedules as object) } : current.schedules
  return sanitizeSettings({
    ...current,
    appearance: nextAppearance,
    ports: nextPorts,
    review: nextReview,
    archive: nextArchive,
    alerts: nextAlerts,
    pr: nextPr,
    dispatch: nextDispatch,
    remote: nextRemote,
    schedules: nextSchedules
  })
}
