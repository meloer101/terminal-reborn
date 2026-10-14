// Pure form ↔ settings mapping for the 外观 page.
import { LIMITS, type AppearanceSettings, type BackgroundSetting, type ThemePreference } from '@shared/settings'

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' }
]

export type BackgroundKind = BackgroundSetting['kind']
export type GradientBackground = Extract<BackgroundSetting, { kind: 'gradient' }>
export type ImageBackground = Extract<BackgroundSetting, { kind: 'image' }>

export const BACKGROUND_OPTIONS: ReadonlyArray<{ value: BackgroundKind; label: string }> = [
  { value: 'solid', label: '纯色' },
  { value: 'gradient', label: '渐变' },
  { value: 'image', label: '图片' }
]

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28]

/** Font size menu: the presets within LIMITS plus the current value if it is not a preset. */
export function fontSizeOptions(current: number): number[] {
  const sizes = FONT_SIZES.filter((size) => size >= LIMITS.fontSize.min && size <= LIMITS.fontSize.max)
  return sizes.includes(current) ? sizes : [...sizes, current].sort((a, b) => a - b)
}

/** "Variable" is an implementation detail of the bundled family; hide it from the UI. */
export function displayFamily(family: string): string {
  return family.replace(/\s+Variable$/i, '')
}

/** Caption under the preview: "JetBrains Mono 13 · PingFang SC · 行高 1.40". */
export function previewCaption(a: Pick<AppearanceSettings, 'latinFont' | 'cjkFont' | 'fontSize' | 'lineHeight'>): string {
  return `${displayFamily(a.latinFont)} ${a.fontSize} · ${displayFamily(a.cjkFont)} · 行高 ${a.lineHeight.toFixed(2)}`
}

export function formatLineHeight(value: number): string {
  return value.toFixed(2)
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatDegrees(value: number): string {
  return `${Math.round(value)}°`
}

export const DEFAULT_GRADIENT = { from: '#1f1f1f', to: '#050505', angle: 160 } as const
export const DEFAULT_IMAGE_DIM = 0.4

/**
 * The background to store when switching modes, or null when nothing should change yet
 * (an image background needs a file first). `remembered` restores the last values of a mode.
 */
export function backgroundForKind(
  kind: BackgroundKind,
  current: BackgroundSetting,
  remembered: { gradient?: GradientBackground; image?: ImageBackground } = {}
): BackgroundSetting | null {
  if (kind === current.kind) return current
  if (kind === 'solid') return { kind: 'solid' }
  if (kind === 'gradient') return remembered.gradient ?? { kind: 'gradient', ...DEFAULT_GRADIENT }
  return remembered.image ?? null
}

/** CSS `background` for the gradient preview chip. */
export function gradientCss(bg: GradientBackground): string {
  return `linear-gradient(${Math.round(bg.angle)}deg, ${bg.from}, ${bg.to})`
}

/** Last path segment, for showing the chosen image. */
export function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}
