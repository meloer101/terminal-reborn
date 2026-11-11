// What the user asked of the agent in a worktree's session, for the built-in review (PRD F13): the reviewer checks the
// change against it. CLI sessions: the prompts the agent's hooks report (the same list 同任务多解 offers, see
// attempts/sources.ts, read in background.ts). GUI sessions have no hooks; their chat feed holds the user's messages.
import { looksLikeReport } from '@shared/dispatch'
import type { ReviewRequest } from '@shared/background-review'
import type { ChatItem } from '@shared/transcript-chat'

/** The user's messages in a GUI feed, oldest first; Wavi's own reports and notices are not the user's words. */
export function guiUserTexts(items: readonly ChatItem[]): string[] {
  const texts: string[] = []
  for (const item of items) {
    const text = item.kind === 'user' ? item.text.trim() : ''
    if (text && !looksLikeReport(text)) texts.push(text)
  }
  return texts
}

export function withAsked(request: ReviewRequest, asked: readonly string[]): ReviewRequest {
  return asked.length > 0 ? { ...request, asked: [...asked] } : request
}
