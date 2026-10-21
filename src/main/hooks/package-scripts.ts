// `scripts` of a folder's package.json, so `npm run check` counts as the typecheck + lint + test it runs (PRD F9 / F4
// “这一轮跑过哪些检查”). Read-only, small and cached by mtime; a folder without one (or with a broken one) has none.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ScriptsLookup } from '@shared/check-commands'

const MAX_BYTES = 1_000_000
const MAX_CACHED = 64

type Scripts = Readonly<Record<string, string>>

export function packageScriptsReader(): ScriptsLookup {
  const cache = new Map<string, { mtimeMs: number; scripts: Scripts | undefined }>()
  return (dir) => {
    if (!dir.startsWith('/')) return undefined
    const file = join(dir, 'package.json')
    let mtimeMs: number
    try {
      const stat = statSync(file)
      if (!stat.isFile() || stat.size > MAX_BYTES) return undefined
      mtimeMs = stat.mtimeMs
    } catch {
      return undefined
    }
    const held = cache.get(file)
    if (held && held.mtimeMs === mtimeMs) return held.scripts
    const scripts = parseScripts(file)
    cache.delete(file)
    cache.set(file, { mtimeMs, scripts })
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string)
    return scripts
  }
}

function parseScripts(file: string): Scripts | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const scripts = typeof parsed === 'object' && parsed !== null ? (parsed as { scripts?: unknown }).scripts : undefined
    if (typeof scripts !== 'object' || scripts === null) return undefined
    return Object.fromEntries(Object.entries(scripts).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    return undefined
  }
}
