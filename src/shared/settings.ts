// User settings (PRD §4 F7). Persisted by main in <userData>/settings.json; every window receives
// changes through TrApi.settings.onChange. Pure: sanitizing never throws, unknown/invalid values
// fall back to defaults so a hand-edited file can't break the app.
import { DEFAULT_PORT_BASE, PORT_BASE_LIMITS } from './ports'

export type ThemePreference = 'system' | 'dark' | 'light'

export interface AppearanceSettings {
  theme: ThemePreference
  /** Latin monospace family for the terminal. */
  latinFont: string
  /** CJK family placed right after latinFont in the stack. */
  cjkFont: string
  /** Terminal font size, px. */
  fontSize: number
  /** Terminal line height as a multiple of fontSize (xterm semantics). */
  lineHeight: number
  ligatures: boolean
  // No background setting (PRD v1.2): the terminal always uses the theme's own color — white in light
  // mode, near-black in dark — like a normal terminal. Old gradient / image values are dropped on load.
  /** Opacity of the terminal surface over the background, 0.5–1. */
  terminalOpacity: number
  /** macOS sidebar vibrancy (blur) behind the sidebar. */
  sidebarVibrancy: boolean
  /** Terminal screen reader mode (VoiceOver reads the output). */
  screenReader: boolean
}

/** TR_PORT blocks (PRD F4 · 脚本与端口): worktree n gets `base + 10n` … `+ 9`. */
export interface PortSettings {
  base: number
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

/** 设置 · 自动化 · 额度提醒 (PRD F11, Figma 18D). On by default: it only notifies. */
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
}

/**
 * 设置 · 自动化 · 派活 (PRD F21 v1.66). An agent may start new sessions through Wavi's tools; each batch waits for the
 * user's 开始 unless `autoApprove` is on (off by default: it spends the user's quota).
 */
export interface DispatchSettings {
  /** Agents get Wavi's dispatch tools (takes effect for agents started from now on). */
  tools: boolean
  /** Start the sessions an agent asks for without the confirmation panel (the limits still apply). */
  autoApprove: boolean
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
}

export interface SettingsPatch {
  appearance?: Partial<AppearanceSettings>
  ports?: Partial<PortSettings>
  review?: Partial<ReviewSettings>
  archive?: Partial<ArchiveSettings>
  alerts?: Partial<AlertSettings>
  pr?: Partial<PrSettings>
  dispatch?: Partial<DispatchSettings>
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  appearance: {
    theme: 'system',
    latinFont: 'JetBrains Mono Variable',
    cjkFont: 'PingFang SC',
    fontSize: 13,
    // xterm multiplies the font's own line height: 1 is what a normal terminal shows. Taller rows stretch
    // block-drawn art such as the Claude Code logo.
    lineHeight: 1,
    ligatures: false,
    terminalOpacity: 1,
    sidebarVibrancy: false,
    screenReader: false
  },
  ports: { base: DEFAULT_PORT_BASE },
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
  pr: { evidence: true, autoFix: false, mergeWhenGreen: false, maxAutoFixes: 3, bots: [] },
  dispatch: { tools: true, autoApprove: false }
}

const MAX_REVIEW_RULES = 8000
const REVIEW_MODEL = /^[A-Za-z0-9._:@/-]{1,64}$/

export const LIMITS = {
  fontSize: { min: 9, max: 28 },
  lineHeight: { min: 1, max: 2.2 },
  terminalOpacity: { min: 0.5, max: 1 },
  fontName: 120
} as const

function num(value: unknown, fallback: number, range: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, value))
}

function str(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' || trimmed.length > max ? fallback : trimmed
}

function appearance(value: unknown): AppearanceSettings {
  const d = DEFAULT_SETTINGS.appearance
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    theme: v.theme === 'dark' || v.theme === 'light' || v.theme === 'system' ? v.theme : d.theme,
    latinFont: str(v.latinFont, d.latinFont, LIMITS.fontName),
    cjkFont: str(v.cjkFont, d.cjkFont, LIMITS.fontName),
    fontSize: Math.round(num(v.fontSize, d.fontSize, LIMITS.fontSize)),
    lineHeight: Math.round(num(v.lineHeight, d.lineHeight, LIMITS.lineHeight) * 100) / 100,
    ligatures: typeof v.ligatures === 'boolean' ? v.ligatures : d.ligatures,
    terminalOpacity: Math.round(num(v.terminalOpacity, d.terminalOpacity, LIMITS.terminalOpacity) * 100) / 100,
    sidebarVibrancy: typeof v.sidebarVibrancy === 'boolean' ? v.sidebarVibrancy : d.sidebarVibrancy,
    screenReader: typeof v.screenReader === 'boolean' ? v.screenReader : d.screenReader
  }
}

function ports(value: unknown): PortSettings {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return { base: Math.round(num(v.base, DEFAULT_PORT_BASE, PORT_BASE_LIMITS)) }
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
    bots
  }
}

/** Applies a (possibly untrusted) patch and re-sanitizes the result. */
export function applySettingsPatch(current: AppSettings, patch: unknown): AppSettings {
  const p = typeof patch === 'object' && patch !== null ? (patch as Record<string, unknown>) : {}
  const nextAppearance =
    typeof p.appearance === 'object' && p.appearance !== null ? { ...current.appearance, ...(p.appearance as object) } : current.appearance
  const nextPorts = typeof p.ports === 'object' && p.ports !== null ? { ...current.ports, ...(p.ports as object) } : current.ports
  const nextReview = typeof p.review === 'object' && p.review !== null ? { ...current.review, ...(p.review as object) } : current.review
  const nextArchive = typeof p.archive === 'object' && p.archive !== null ? { ...current.archive, ...(p.archive as object) } : current.archive
  const nextAlerts = typeof p.alerts === 'object' && p.alerts !== null ? { ...current.alerts, ...(p.alerts as object) } : current.alerts
  const nextPr = typeof p.pr === 'object' && p.pr !== null ? { ...current.pr, ...(p.pr as object) } : current.pr
  const nextDispatch = typeof p.dispatch === 'object' && p.dispatch !== null ? { ...current.dispatch, ...(p.dispatch as object) } : current.dispatch
  return sanitizeSettings({
    ...current,
    appearance: nextAppearance,
    ports: nextPorts,
    review: nextReview,
    archive: nextArchive,
    alerts: nextAlerts,
    pr: nextPr,
    dispatch: nextDispatch
  })
}
