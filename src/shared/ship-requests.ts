// Validation of what the renderer sends to the ship handlers (src/shared/ship.ts): main trusts none of it. Pure.
import { MAX_MERGE_MESSAGE, MERGE_METHODS, multiLine, type MergeMethod } from './git-merge'
import { MAX_SHIP_FILES, parsePrTarget } from './pull-requests'
import type { DiffSinceRequest, HandoffRequest, ShipMainRequest } from './ship'
import { HANDOFF_FILES, type HandoffKind } from './ship-handoff'

const MAX_PATH = 4096
/** A full or abbreviated commit id; the diff and the reset resolve it and require it to be an ancestor of HEAD. */
const SINCE = /^[0-9a-f]{7,40}$/i

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A path as `git status` prints it: relative, no `.` / `..` segments, no NUL. */
function isRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_PATH || value.includes('\0') || value.startsWith('/')) return false
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

export function parseHandoffRequest(raw: unknown): HandoffRequest | null {
  const target = parsePrTarget(raw)
  if (!target || !isRecord(raw)) return null
  if (typeof raw.kind !== 'string' || !Object.prototype.hasOwnProperty.call(HANDOFF_FILES, raw.kind)) return null
  return { ...target, kind: raw.kind as HandoffKind }
}

export function parseDiffSinceRequest(raw: unknown): DiffSinceRequest | null {
  const target = parsePrTarget(raw)
  if (!target || !isRecord(raw)) return null
  if (typeof raw.since !== 'string' || !SINCE.test(raw.since)) return null
  return { ...target, since: raw.since.toLowerCase() }
}

/**
 * 合并到 main 并推送: the message is cleaned like a commit message (newlines kept) and capped; with paths it must not be
 * empty (it is the commit's message). An empty `paths` list means nothing to commit, as null does.
 */
export function parseShipMainRequest(raw: unknown): ShipMainRequest | null {
  const target = parsePrTarget(raw)
  if (!target || !isRecord(raw)) return null
  if (typeof raw.message !== 'string' || raw.message.length > MAX_MERGE_MESSAGE) return null
  if (typeof raw.method !== 'string' || !(MERGE_METHODS as readonly string[]).includes(raw.method)) return null
  let paths: string[] | null = null
  if (raw.paths !== null && raw.paths !== undefined) {
    if (!Array.isArray(raw.paths) || raw.paths.length > MAX_SHIP_FILES || !raw.paths.every(isRelativePath)) return null
    if (raw.paths.length > 0) paths = [...new Set(raw.paths as string[])]
  }
  const message = multiLine(raw.message)
  if (paths && !message) return null
  return { ...target, message, method: raw.method as MergeMethod, paths }
}
