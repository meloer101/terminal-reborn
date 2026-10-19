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
  /** Empty uses the CLI's own model. */
  model: string
}

export interface AppSettings {
  version: 1
  appearance: AppearanceSettings
  ports: PortSettings
  review: ReviewSettings
}

export interface SettingsPatch {
  appearance?: Partial<AppearanceSettings>
  ports?: Partial<PortSettings>
  review?: Partial<ReviewSettings>
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
    model: ''
  }
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
  const model = typeof v.model === 'string' && (v.model === '' || REVIEW_MODEL.test(v.model)) ? v.model : d.model
  return {
    beforeMerge: typeof v.beforeMerge === 'boolean' ? v.beforeMerge : d.beforeMerge,
    beforePush: typeof v.beforePush === 'boolean' ? v.beforePush : d.beforePush,
    afterTurnWithCommits: typeof v.afterTurnWithCommits === 'boolean' ? v.afterTurnWithCommits : d.afterTurnWithCommits,
    mode: v.mode === 'agent-command' ? 'agent-command' : d.mode,
    rules: v.rules === 'custom' ? 'custom' : d.rules,
    customRules,
    model
  }
}

/** Any JSON value → valid settings. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return { version: 1, appearance: appearance(v.appearance), ports: ports(v.ports), review: review(v.review) }
}

/** Applies a (possibly untrusted) patch and re-sanitizes the result. */
export function applySettingsPatch(current: AppSettings, patch: unknown): AppSettings {
  const p = typeof patch === 'object' && patch !== null ? (patch as Record<string, unknown>) : {}
  const nextAppearance =
    typeof p.appearance === 'object' && p.appearance !== null ? { ...current.appearance, ...(p.appearance as object) } : current.appearance
  const nextPorts = typeof p.ports === 'object' && p.ports !== null ? { ...current.ports, ...(p.ports as object) } : current.ports
  const nextReview = typeof p.review === 'object' && p.review !== null ? { ...current.review, ...(p.review as object) } : current.review
  return sanitizeSettings({ ...current, appearance: nextAppearance, ports: nextPorts, review: nextReview })
}
