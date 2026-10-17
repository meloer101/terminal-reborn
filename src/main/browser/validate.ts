// Renderer payloads for the built-in browser (PRD F17), checked before main acts on them. No Electron imports.
import { isAbsolute } from 'node:path'
import { isAllowedUrl, MAX_URL_LENGTH, type BrowserBounds } from '@shared/browser'

const MAX_PATH = 4096
const MAX_SIDE = 16_384

/** A worktree key: an absolute path. Throws otherwise. */
export function parseWorktree(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH || value.includes('\0') || !isAbsolute(value)) {
    throw new Error('invalid worktree')
  }
  return value
}

/** An http(s) URL to load. Throws for any other scheme. */
export function parseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH || !isAllowedUrl(value)) throw new Error('invalid url')
  return new URL(value).href
}

/** Integer window coordinates; sizes clamped to [0, MAX_SIDE]. Throws when not finite numbers. */
export function parseBounds(value: unknown): BrowserBounds {
  if (typeof value !== 'object' || value === null) throw new Error('invalid bounds')
  const o = value as Record<string, unknown>
  const n = (key: string): number => {
    const v = o[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('invalid bounds')
    return Math.round(v)
  }
  const clamp = (v: number) => Math.min(MAX_SIDE, Math.max(0, v))
  return { x: clamp(n('x')), y: clamp(n('y')), width: clamp(n('width')), height: clamp(n('height')) }
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('invalid flag')
  return value
}
