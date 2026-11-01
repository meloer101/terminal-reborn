// When the user last typed into each terminal, and whether they typed since their last Enter (PRD F21: Wavi types a
// report into a session without a native channel only when nobody is typing there and no draft may be in its input
// line). Only keyboard input counts: mouse and focus reports are the terminal's own. Wavi's own sends bypass this.
import type { SessionId } from '@shared/types'

const typing = new Map<SessionId, { at: number; draft: boolean }>()

/** Mouse reports (SGR and X10) and focus in / out: not the user typing. */
// eslint-disable-next-line no-control-regex
const NOT_TYPING = /^(?:\x1b\[<[\d;]+[Mm]|\x1b\[M[\s\S]{3}|\x1b\[[IO])+$/

/** The last Enter that submits: not Option+Enter (`ESC CR`) nor `\` + Enter, which the agents' TUIs take as a newline. */
function lastSubmit(data: string, before: string): number {
  for (let i = data.lastIndexOf('\r'); i >= 0; i = data.lastIndexOf('\r', i - 1)) {
    const prev = i > 0 ? data[i - 1] : before
    if (prev !== '\x1b' && prev !== '\\') return i
    if (i === 0) break
  }
  return -1
}

const lastChar = new Map<SessionId, string>()

export function noteInput(sessionId: SessionId, data: string, now = Date.now()): void {
  if (data === '' || NOT_TYPING.test(data)) return
  const last = lastSubmit(data, lastChar.get(sessionId) ?? '')
  lastChar.set(sessionId, data[data.length - 1]!)
  const after = last >= 0 ? data.slice(last + 1) : data
  // Ctrl+C / Ctrl+U clear the input line in the agents' TUIs; Esc sequences alone (arrows) leave it as it was.
  // eslint-disable-next-line no-control-regex
  const cleared = /[\x03\x15]/.test(after)
  // eslint-disable-next-line no-control-regex
  const printable = /[^\x00-\x1f\x7f]/.test(after.replace(/\x1b\[[\d;?]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b./g, ''))
  const before = typing.get(sessionId)?.draft ?? false
  const draft = cleared ? false : printable ? true : last >= 0 ? false : before
  typing.set(sessionId, { at: now, draft })
}

/** Wavi put text into the input line without Enter (插入路径, a slash command, attachments): a draft like the user's. */
export function noteInserted(sessionId: SessionId, now = Date.now()): void {
  typing.set(sessionId, { at: now, draft: true })
}

export function typingIn(sessionId: SessionId): { lastKeyAt: number | null; draft: boolean } {
  const t = typing.get(sessionId)
  return { lastKeyAt: t?.at ?? null, draft: t?.draft ?? false }
}

export function forgetTyping(sessionId: SessionId): void {
  typing.delete(sessionId)
  lastChar.delete(sessionId)
}
