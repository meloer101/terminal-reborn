// Hex color helpers shared by main (theme import) and the renderer (terminal theme). Pure.
export type Rgb = [number, number, number]

export function parseHex(color: string): Rgb | null {
  const match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color.trim())
  if (!match?.[1]) return null
  const n = parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`
}

/** Mixes `amount` (0..1) of `toward` into `base`; returns `base` unchanged if either is not a hex color. */
export function mixHex(base: string, toward: string, amount: number): string {
  const a = parseHex(base)
  const b = parseHex(toward)
  if (!a || !b) return base
  return toHex([a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount])
}

/** Relative luminance (0–1, sRGB weights without gamma — enough to tell a dark surface from a light one). */
export function lightness(color: string): number | null {
  const rgb = parseHex(color)
  if (!rgb) return null
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
}

/** Anything that is not a hex color counts as dark, like the terminal's default. */
export function isDarkColor(color: string): boolean {
  const value = lightness(color)
  return value === null ? true : value < 0.5
}

/**
 * `#rgb`, `rgb`, `#rrggbb` or `rrggbb` → `#rrggbb` (lower case); null for anything else. With `alpha`, an 8-digit
 * `#rrggbbaa` is kept as it is (selection colors carry one).
 */
export function normalizeHex(value: unknown, options: { alpha?: boolean } = {}): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(text)) return `#${text[0]}${text[0]}${text[1]}${text[1]}${text[2]}${text[2]}`
  if (/^[0-9a-f]{6}$/.test(text)) return `#${text}`
  if (options.alpha && /^[0-9a-f]{8}$/.test(text)) return `#${text}`
  return null
}
