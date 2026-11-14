// Per-type file icons for the 文件 tree (PRD F17, Figma 72A / 72A′): exact file name → longest compound extension →
// extension; no match keeps the tree's plain lucide File. Folders are not looked up. Data: file-icons.data.ts.
import { ICON_BY_EXT, ICON_BY_NAME, ICON_SVG, LIGHT_ICON } from './file-icons.data'

export type IconTheme = 'dark' | 'light'

export function fileIcon(name: string, theme: IconTheme = 'dark'): string | undefined {
  const lower = name.toLowerCase()
  let icon = ICON_BY_NAME[lower]
  // "a.test.ts" tries "test.ts" then "ts"; a leading dot is part of the name, not an extension.
  for (let dot = lower.indexOf('.', 1); !icon && dot >= 0; dot = lower.indexOf('.', dot + 1)) {
    icon = ICON_BY_EXT[lower.slice(dot + 1)]
  }
  if (!icon) return undefined
  return theme === 'light' ? (LIGHT_ICON[icon] ?? icon) : icon
}

const urls = new Map<string, string>()

/** The icon as an <img> source; colours are baked into the SVG, so it needs no CSS. */
export function fileIconUrl(icon: string): string {
  let url = urls.get(icon)
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ICON_SVG[icon] ?? '')}`
    urls.set(icon, url)
  }
  return url
}
