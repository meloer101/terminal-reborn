// Agent hook payloads cut down to what Wavi reads (PRD §6.8). A PostToolUse `tool_response` can be a whole file (Read)
// or megabytes of Bash output, and `tool_input` a whole file (Write, Edit's old/new text); relayed whole they hold up
// every terminal's output on the daemon socket. Only `tool_input` / `tool_response` are touched: every other field is
// small and read by name somewhere (session ids, transcript paths, prompts, replies).
import { isTodoTool } from './todo-progress'

/** Long enough for an attempt's plan (MAX_ATTEMPT_PROMPT in ./attempt-groups) and every one-line summary. */
export const INPUT_HEAD_CHARS = 20_000
/** A Bash call's checks read the last 16 000 chars of its output (src/main/hooks/normalize.ts). */
export const RESPONSE_TAIL_CHARS = 16_000
/** Codex puts `Exit code: N` first in a shell result. */
export const RESPONSE_HEAD_CHARS = 2_000
/** Nothing reads a non-todo response's lists (Glob's `filenames`, …); a few items keep their shape. */
export const RESPONSE_ARRAY_ITEMS = 100

const TAIL_OF_INPUT_CHARS = 2_000
/** The marker is at most this long, so a clipped string is never clipped again. */
const MARKER_SLACK = 32

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * `head` + a marker + `tail` of a long string. The marker carries the original length, so two different long inputs
 * that share their ends still key as different tool calls (src/shared/tool-call.ts).
 */
export function clipText(text: string, head: number, tail: number): string {
  if (text.length <= head + tail + MARKER_SLACK) return text
  return `${text.slice(0, head)}…[${text.length} chars]…${text.slice(text.length - tail)}`
}

function clipDeep(value: unknown, head: number, tail: number, maxItems: number): unknown {
  if (typeof value === 'string') return clipText(value, head, tail)
  if (Array.isArray(value)) return value.slice(0, maxItems).map((item) => clipDeep(item, head, tail, maxItems))
  if (isRec(value)) {
    const out: Rec = {}
    for (const [key, item] of Object.entries(value)) out[key] = clipDeep(item, head, tail, maxItems)
    return out
  }
  return value
}

/** The `*** … File:` lines of an apply_patch body: all Codex's mapping reads (normalize.ts parsePatchFiles). */
function patchHeaders(patch: string): string {
  return patch
    .split('\n')
    .filter((line) => line.startsWith('*** '))
    .join('\n')
}

function trimInput(tool: string, input: unknown): unknown {
  if (isTodoTool(tool)) return input
  if (tool === 'apply_patch') {
    if (typeof input === 'string') return patchHeaders(input)
    if (isRec(input) && typeof input.command === 'string') return { ...input, command: patchHeaders(input.command) }
  }
  return clipDeep(input, INPUT_HEAD_CHARS, TAIL_OF_INPUT_CHARS, Number.POSITIVE_INFINITY)
}

function trimResponse(tool: string, response: unknown): unknown {
  if (isTodoTool(tool)) return response
  return clipDeep(response, RESPONSE_HEAD_CHARS, RESPONSE_TAIL_CHARS, RESPONSE_ARRAY_ITEMS)
}

/**
 * The payload with its tool input and response clipped. Pure and idempotent: the daemon trims before relaying and
 * normalize trims again for payloads that reached the app's own hook socket. A tool call's PreToolUse,
 * PermissionRequest and PostToolUse share one input, so they still trim to the same input and the same call key.
 * Todo tools are kept whole: their input and response are the session's todo list.
 */
export function trimHookPayload(payload: unknown): unknown {
  if (!isRec(payload)) return payload
  const tool = typeof payload.tool_name === 'string' ? payload.tool_name : ''
  let out = payload
  const set = (key: string, value: unknown): void => {
    if (out === payload) out = { ...payload }
    out[key] = value
  }
  if ('tool_input' in payload) set('tool_input', trimInput(tool, payload.tool_input))
  if ('tool_response' in payload) set('tool_response', trimResponse(tool, payload.tool_response))
  // Gemini's permission Notification names the call under `details` (tool_input, or args).
  const details = payload.details
  if (isRec(details) && ('tool_input' in details || 'args' in details)) {
    const name = typeof details.tool_name === 'string' ? details.tool_name : typeof details.name === 'string' ? details.name : ''
    const trimmed: Rec = { ...details }
    if ('tool_input' in details) trimmed.tool_input = trimInput(name, details.tool_input)
    if ('args' in details) trimmed.args = trimInput(name, details.args)
    set('details', trimmed)
  }
  return out
}
