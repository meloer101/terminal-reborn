// Pure form ↔ settings mapping for the 外观 page.
import { CHAT_WEIGHTS, LIMITS, type AppearanceSettings, type ChatAppearance, type ChatWeight, type ChatWidth, type ThemePreference, type WindowMaterial } from '@shared/settings'

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' }
]

export const BACKGROUND_OPTIONS: ReadonlyArray<{ value: AppearanceSettings['terminalBackground']['mode']; label: string }> = [
  { value: 'theme', label: '跟随主题' },
  { value: 'custom', label: '自定义' }
]

/** Whether two appearance values are the same; the object-valued ones (底色, imported colors) compare by content. */
export function sameAppearanceValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

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

// --- 对话 and 窗口 · 材质 (PRD F23 v1.127, Figma 51D) ------------------------------------------------------------------

export const CHAT_WIDTH_OPTIONS: ReadonlyArray<{ value: ChatWidth; label: string }> = [
  { value: 'narrow', label: '窄' },
  { value: 'medium', label: '中' },
  { value: 'wide', label: '宽' },
  { value: 'full', label: '铺满' }
]

const WEIGHT_NAMES: Record<ChatWeight, string> = { 300: '细', 400: '常规', 500: '中等' }
export const CHAT_WEIGHT_OPTIONS: ReadonlyArray<{ value: `${ChatWeight}`; label: string }> = CHAT_WEIGHTS.map((weight) => ({
  value: `${weight}` as const,
  label: WEIGHT_NAMES[weight]
}))

export const CHAT_SIZE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = Array.from(
  { length: LIMITS.chatFontSize.max - LIMITS.chatFontSize.min + 1 },
  (_, i) => String(LIMITS.chatFontSize.min + i)
).map((size) => ({ value: size, label: size }))

const MATERIAL_OPTIONS: ReadonlyArray<{ value: WindowMaterial; label: string }> = [
  { value: 'liquid', label: '液态玻璃' },
  { value: 'frosted', label: '磨砂玻璃' },
  { value: 'solid', label: '实色' }
]

/** 材质 (Figma 57C): Liquid Glass only where the window has it (macOS 26). */
export const materialOptions = (liquidGlass: boolean): ReadonlyArray<{ value: WindowMaterial; label: string }> =>
  liquidGlass ? MATERIAL_OPTIONS : MATERIAL_OPTIONS.filter((o) => o.value !== 'liquid')

/** 对话's English font menu: the system UI font first ('' in settings), then the proportional families. */
export const SYSTEM_UI_FONT = '跟随系统'

export function chatPreviewCaption(c: Pick<ChatAppearance, 'latinFont' | 'cjkFont' | 'fontSize' | 'fontWeight'>): string {
  return `${c.latinFont ? displayFamily(c.latinFont) : SYSTEM_UI_FONT} ${c.fontSize} · ${displayFamily(c.cjkFont)} · ${WEIGHT_NAMES[c.fontWeight]}`
}
