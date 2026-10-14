// Font catalog helpers for the settings window: turn the raw list of installed faces into the
// two menus (Latin monospace, CJK-capable). Pure; the DOM-dependent bits live in local-fonts.ts.

/** Always offered, even when the Local Font Access API is denied or the family is not installed. */
export const BUNDLED_LATIN_FONT = 'JetBrains Mono Variable'
export const DEFAULT_CJK_FONT = 'PingFang SC'

export const LATIN_SAMPLE = 'AaBb 0O1l'
export const CJK_SAMPLE = '中文字体'

export interface FontCatalog {
  latin: string[]
  cjk: string[]
}

const MONO_NAME =
  /mono|code|consol|courier|menlo|monaco|hack|fira|iosevka|cascadia|inconsolata|cousine|terminal|typewriter|meslo|nerd|berkeley|input|maple|commit|fantasque|victor|hasklig|anonymous|ibm 3270|\bpt mono\b|\bgeist\b/i

const CJK_NAME =
  /pingfang|hiragino|noto (sans|serif) (cjk|sc|tc|hk|jp|kr)|source han|思源|cjk|\b(sc|tc|hc|hk|jp|kr)\b|heiti|songti|kaiti|fangsong|yuanti|wenquanyi|microsoft ya ?hei|simsun|simhei|stheiti|stsong|stkaiti|stfangsong|lantinghei|libian|hannotate|hanzipen|weibei|xingkai|yapi|baoli|lisong|apple (sd )?gothic|nanum|malgun|meiryo|yu (gothic|mincho)|pmingliu|mingliu|dfkai|lihei|[黑宋楷圆體体]/i

/** Name-based guess: does this family look like a monospace face? */
export function looksMonospace(family: string): boolean {
  return MONO_NAME.test(family)
}

/** Name-based guess: is this family meant for CJK text? */
export function looksCjk(family: string): boolean {
  return CJK_NAME.test(family)
}

/** Drops hidden system faces (leading dot), blanks and duplicates; sorts case-insensitively. */
export function uniqueFamilies(families: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const raw of families) {
    const family = raw.trim()
    if (family === '' || family.startsWith('.')) continue
    seen.add(family)
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Splits installed families into the two menus. `isMonospace` is an optional measured check
 * (canvas) for families whose name gives no hint; the bundled and default families are always
 * present and pinned first.
 */
export function classifyFonts(families: readonly string[], isMonospace?: (family: string) => boolean): FontCatalog {
  const cjk: string[] = []
  const latin: string[] = []
  for (const family of uniqueFamilies(families)) {
    if (looksCjk(family)) cjk.push(family)
    else if (looksMonospace(family) || isMonospace?.(family) === true) latin.push(family)
  }
  return {
    latin: pinFirst(latin, BUNDLED_LATIN_FONT),
    cjk: pinFirst(cjk, DEFAULT_CJK_FONT)
  }
}

function pinFirst(list: readonly string[], pinned: string): string[] {
  return [pinned, ...list.filter((family) => family !== pinned)]
}

/** CSS font-family list that renders `family` first and always names an explicit fallback. */
export function cssFamily(family: string, fallback: string): string {
  return `"${family.replace(/["\\]/g, '')}", ${fallback}`
}

/** Makes sure the currently selected family is selectable even when it is not in the catalog. */
export function withCurrent(list: readonly string[], current: string): string[] {
  return list.includes(current) ? [...list] : [current, ...list]
}
