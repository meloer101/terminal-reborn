// OSC 7501 “Program Status” (spec rev 0.4, superlogical.com/rex/docs/build/program-status): a program tells its
// terminal what it is doing — `ESC ] 7501 ; key=value : key=value … ST|BEL`. Wavi reads it for the agent CLIs that
// emit it (OpenCode 2, Pi ≥ 1.1, Grok Build, Crush, Goose), with no injection (ROADMAP 7). A program that queries first
// (`OSC 7501 ; ?`) reports only to a terminal that answers `OSC 7501 ; ?` before its DA1 reply arrives. Only the root
// record (no `id`) is read: child records are background tasks, not the session. Pure.

export type ProgramState = 'idle' | 'working' | 'done' | 'blocked' | 'error' | 'clear'

export interface ProgramStatus {
  state: ProgramState
  /** What `blocked` waits for. */
  kind?: 'permission' | 'question' | 'auth'
  /** The program's own name for itself. */
  app?: string
  /** A short human line (base64 on the wire), one line, at most MAX_MESSAGE code points. */
  message?: string
}

const STATES: ReadonlySet<string> = new Set<ProgramState>(['idle', 'working', 'done', 'blocked', 'error', 'clear'])
const KINDS: ReadonlySet<string> = new Set(['permission', 'question', 'auth'])
const MAX_PAYLOAD = 4096
const MAX_MESSAGE = 120

/** The payload of a status query (`OSC 7501 ; ?`): the program asks whether the terminal understands the protocol. */
export const PROGRAM_STATUS_QUERY = '?'

/** The terminal's answer to a query (spec: MUST reply `?`; without the lists the full sets are assumed). */
export const PROGRAM_STATUS_REPLY = '\x1b]7501;?\x1b\\'

function decodeBase64Utf8(value: string): string | null {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(value)) return null
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** One line, no control characters, at most MAX_MESSAGE code points; undefined when nothing is left. */
function cleanMessage(raw: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const line = raw.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  const chars = [...line]
  return chars.length > MAX_MESSAGE ? `${chars.slice(0, MAX_MESSAGE).join('')}…` : line
}

/** Parses a status report; null for the query, an unknown state or anything malformed (never throws). */
export function parseProgramStatus(payload: string): ProgramStatus | null {
  if (payload.length === 0 || payload.length > MAX_PAYLOAD || payload.startsWith(PROGRAM_STATUS_QUERY)) return null
  const fields = new Map<string, string>()
  for (const part of payload.split(':')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    // A repeated key takes the last value.
    if (key.length <= 16) fields.set(key, part.slice(eq + 1).trim())
  }
  // A child record (background task, subagent) is not the session's own state.
  if (fields.has('id')) return null
  const state = fields.get('state')
  if (!state || !STATES.has(state)) return null
  const status: ProgramStatus = { state: state as ProgramState }
  const kind = fields.get('kind')
  if (kind && KINDS.has(kind)) status.kind = kind as ProgramStatus['kind']
  const app = fields.get('app')
  if (app) {
    const name = cleanMessage(app)
    if (name) status.app = name.slice(0, 40)
  }
  const msg = fields.get('msg')
  if (msg) {
    const decoded = decodeBase64Utf8(msg)
    // Decoded text with any control character is discarded (spec), not cleaned.
    // eslint-disable-next-line no-control-regex
    const message = decoded === null || /[\u0000-\u001f\u007f-\u009f]/.test(decoded) ? undefined : cleanMessage(decoded)
    if (message) status.message = message
  }
  return status
}

const INTRO = '\x1b]7501;'

/**
 * Finds OSC 7501 sequences in a PTY output stream that arrives in chunks (a sequence may span chunks). Everything
 * else passes by untouched; this only watches. A sequence longer than the spec's 4096 bytes is dropped whole.
 */
export class ProgramStatusScanner {
  private pending = ''

  /** The queries and the reports (parsed root records) found in this chunk, in order. */
  feed(chunk: string): Array<{ type: 'query' } | { type: 'report'; status: ProgramStatus }> {
    const found: Array<{ type: 'query' } | { type: 'report'; status: ProgramStatus }> = []
    let text = this.pending + chunk
    this.pending = ''
    for (;;) {
      const start = text.indexOf(INTRO)
      if (start < 0) {
        // Keep a tail that could be the start of an introducer split across chunks.
        const keep = Math.min(text.length, INTRO.length - 1)
        for (let n = keep; n > 0; n--) {
          if (INTRO.startsWith(text.slice(text.length - n))) {
            this.pending = text.slice(text.length - n)
            break
          }
        }
        return found
      }
      const body = start + INTRO.length
      const bel = text.indexOf('\x07', body)
      const st = text.indexOf('\x1b\\', body)
      const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st)
      if (end < 0) {
        if (text.length - start <= MAX_PAYLOAD + INTRO.length) this.pending = text.slice(start)
        return found
      }
      const payload = text.slice(body, end)
      text = text.slice(end + (end === st ? 2 : 1))
      if (payload.length > MAX_PAYLOAD) continue
      if (payload.startsWith(PROGRAM_STATUS_QUERY)) {
        found.push({ type: 'query' })
        continue
      }
      const status = parseProgramStatus(payload)
      if (status) found.push({ type: 'report', status })
    }
  }
}
