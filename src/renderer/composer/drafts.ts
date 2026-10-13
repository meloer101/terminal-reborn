// Per-session composer drafts, persisted so they survive session switches and restarts.
import type { SessionId } from '@shared/types'

export const DRAFTS_STORAGE_KEY = 'tr.composer.drafts.v1'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export interface DraftStore {
  get(sessionId: SessionId): string
  /** Empty text removes the draft. */
  set(sessionId: SessionId, text: string): void
}

function parse(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(value)) if (typeof v === 'string' && v.length > 0) out[k] = v
    return out
  } catch {
    return {}
  }
}

/** `storage` may be null (unavailable); drafts then live in memory only. */
export function createDraftStore(storage: StorageLike | null): DraftStore {
  let drafts: Record<string, string> | null = null

  function load(): Record<string, string> {
    if (drafts) return drafts
    let raw: string | null
    try {
      raw = storage?.getItem(DRAFTS_STORAGE_KEY) ?? null
    } catch {
      raw = null
    }
    drafts = parse(raw)
    return drafts
  }

  return {
    get: (id) => load()[id] ?? '',
    set(id, text) {
      const d = load()
      if (text.length === 0) delete d[id]
      else d[id] = text
      try {
        storage?.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(d))
      } catch {
        // Quota or privacy mode: keep the in-memory copy.
      }
    }
  }
}

export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}
