// Editing an earlier message of a Claude GUI session (PRD F23 编辑, Figma 54C): Claude is restarted with
// `--resume <session> --resume-session-at <uuid>`, which keeps the conversation up to that message and appends the new
// one under it in the same JSONL (measured on 2.1.318: the cut turns stay in the file, the new prompt's `parentUuid`
// points back at the kept message). So the transcript is a tree, and only its current branch is the conversation.
// Pure.

type Row = Record<string, unknown> | null

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** A prompt the user typed: a `user` line whose content is text, not a tool result or a line Claude added itself. */
function isPrompt(row: Row): boolean {
  if (!row || row.type !== 'user' || row.isMeta === true || row.isSidechain === true) return false
  const content = (row.message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string') return true
  return Array.isArray(content) && !content.some((c) => (c as { type?: unknown } | null)?.type === 'tool_result')
}

/**
 * Which lines are on the current branch. A prompt whose parent already had a child starts a new branch there: what
 * hangs under the earlier child (written before this prompt) was cut by an edit and is left out. Lines without a uuid
 * stay.
 */
export function currentBranch(rows: readonly Row[]): boolean[] {
  const keep = rows.map(() => true)
  const firstChild = new Map<string, number>()
  rows.forEach((row, i) => {
    const parent = str(row?.parentUuid)
    if (parent !== undefined) {
      const earlier = firstChild.get(parent)
      if (earlier === undefined) firstChild.set(parent, i)
      else if (isPrompt(row)) {
        // Drop the earlier child and everything below it, up to this prompt.
        const cut = new Set([str(rows[earlier]?.uuid)!])
        for (let j = earlier; j < i; j++) {
          const r = rows[j]
          const id = str(r?.uuid)
          if (id === undefined) continue
          if (j === earlier || cut.has(str(r?.parentUuid) ?? '')) {
            cut.add(id)
            keep[j] = false
            firstChild.delete(id)
          }
        }
        firstChild.set(parent, i)
      }
    }
  })
  return keep
}

/**
 * Where to resume to edit the prompt `messageId`: the last message before it on its branch (`--resume-session-at`),
 * null when it is the conversation's first message (a new conversation), undefined when it is not a prompt here or
 * its chain runs into lines that were not read (a transcript longer than history reads): never a new conversation by
 * mistake.
 */
export function resumePointOf(rows: readonly Row[], messageId: string): string | null | undefined {
  const keep = currentBranch(rows)
  const byId = new Map<string, Record<string, unknown>>()
  rows.forEach((row, i) => {
    const id = str(row?.uuid)
    if (row && id !== undefined && keep[i]) byId.set(id, row)
  })
  const target = byId.get(messageId)
  if (!target || !isPrompt(target)) return undefined
  for (let at = str(target.parentUuid); at !== undefined; ) {
    const row = byId.get(at)
    if (!row) return undefined
    if (row.type === 'user' || row.type === 'assistant') return at
    at = str(row.parentUuid)
  }
  return null
}
