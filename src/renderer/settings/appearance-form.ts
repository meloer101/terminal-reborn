// Pure form ↔ settings mapping for the 外观 page.
import { LIMITS, type AppearanceSettings, type ThemePreference } from '@shared/settings'

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' }
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
