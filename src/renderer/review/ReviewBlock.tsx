// The review result at the top of Git · 变更 (PRD F13 v1.78, Figma 29B2): who reviewed how many files, the
// reviewer's one-paragraph conclusion, the findings one per line (tick to send, click to jump), 重审 and 发给 <agent>.
import type { SessionId } from '@shared/types'

export function ReviewBlock({ sessionId, root }: { sessionId: SessionId; root: string }) {
  void sessionId
  void root
  return null
}
