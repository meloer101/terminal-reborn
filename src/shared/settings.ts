// User settings (PRD §4 F7). Persisted by main in <userData>/settings.json; every window receives
// changes through TrApi.settings.onChange. Pure: sanitizing never throws, unknown/invalid values
// fall back to defaults so a hand-edited file can't break the app.

export type ThemePreference = 'system' | 'dark' | 'light'

export type BackgroundSetting =
  /** The theme's own terminal background. */
  | { kind: 'solid' }
  /** CSS linear-gradient between two hex colors. */
  | { kind: 'gradient'; from: string; to: string; angle: number }
  /** An image file behind the terminal, darkened/lightened by `dim` (0–1) for legibility. */
  | { kind: 'image'; path: string; dim: number }

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
  background: BackgroundSetting
  /** Opacity of the terminal surface over the background, 0.5–1. */
  terminalOpacity: number
  /** macOS sidebar vibrancy (blur) behind the sidebar. */
  sidebarVibrancy: boolean
}

export interface AppSettings {
  version: 1
  appearance: AppearanceSettings
}

export interface SettingsPatch {
  appearance?: Partial<AppearanceSettings>
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
    background: { kind: 'solid' },
    terminalOpacity: 1,
    sidebarVibrancy: false
  }
}

export const LIMITS = {
  fontSize: { min: 9, max: 28 },
  lineHeight: { min: 1, max: 2.2 },
  terminalOpacity: { min: 0.5, max: 1 },
  gradientAngle: { min: 0, max: 360 },
  imageDim: { min: 0, max: 0.9 },
  fontName: 120,
  path: 4096
} as const

const HEX = /^#[0-9a-f]{6}$/i

function num(value: unknown, fallback: number, range: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, value))
}

function str(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' || trimmed.length > max ? fallback : trimmed
}

function background(value: unknown): BackgroundSetting {
  if (typeof value !== 'object' || value === null) return { kind: 'solid' }
  const v = value as Record<string, unknown>
  if (v.kind === 'gradient' && typeof v.from === 'string' && HEX.test(v.from) && typeof v.to === 'string' && HEX.test(v.to)) {
    return { kind: 'gradient', from: v.from, to: v.to, angle: num(v.angle, 180, LIMITS.gradientAngle) }
  }
  if (v.kind === 'image' && typeof v.path === 'string' && v.path.startsWith('/') && v.path.length <= LIMITS.path) {
    return { kind: 'image', path: v.path, dim: num(v.dim, 0.4, LIMITS.imageDim) }
  }
  return { kind: 'solid' }
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
    background: background(v.background),
    terminalOpacity: Math.round(num(v.terminalOpacity, d.terminalOpacity, LIMITS.terminalOpacity) * 100) / 100,
    sidebarVibrancy: typeof v.sidebarVibrancy === 'boolean' ? v.sidebarVibrancy : d.sidebarVibrancy
  }
}

/** Any JSON value → valid settings. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return { version: 1, appearance: appearance(v.appearance) }
}

/** Applies a (possibly untrusted) patch and re-sanitizes the result. */
export function applySettingsPatch(current: AppSettings, patch: unknown): AppSettings {
  const p = typeof patch === 'object' && patch !== null ? (patch as Record<string, unknown>) : {}
  const nextAppearance =
    typeof p.appearance === 'object' && p.appearance !== null ? { ...current.appearance, ...(p.appearance as object) } : current.appearance
  return sanitizeSettings({ ...current, appearance: nextAppearance })
}
