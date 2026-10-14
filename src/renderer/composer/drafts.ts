// Per-session composer drafts. They live in memory and are saved with the workspace (main-owned
// `workspace.json`, see state/persistence.ts); a draft is deleted when its session is closed.
import type { SessionId } from '@shared/types'

export interface DraftStore {
  get(sessionId: SessionId): string
  /** Empty text removes the draft. */
  set(sessionId: SessionId, text: string): void
  /** Deletes the draft of a closed session. */
  remove(sessionId: SessionId): void
  /** All non-empty drafts (a copy), for saving. */
  snapshot(): Record<SessionId, string>
}

/** `onChange` runs after every real change (not for writes that leave a draft as it was). */
export function createDraftStore(initial: Readonly<Record<SessionId, string>> = {}, onChange?: () => void): DraftStore {
  const drafts = new Map<SessionId, string>(Object.entries(initial).filter(([, text]) => text.length > 0))

  return {
    get: (id) => drafts.get(id) ?? '',
    set(id, text) {
      if ((drafts.get(id) ?? '') === text) return
      if (text.length === 0) drafts.delete(id)
      else drafts.set(id, text)
      onChange?.()
    },
    remove(id) {
      if (drafts.delete(id)) onChange?.()
    },
    snapshot: () => Object.fromEntries(drafts)
  }
}
