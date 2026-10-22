// Validation for every pty IPC payload. The renderer is not trusted to send well-formed data.
import type { PtySpawnOptions } from '@shared/ipc'
import type { AgentKind } from '@shared/types'
import { isSafeAgentSessionId } from '@shared/workspace-file'

const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

export const MAX_WRITE_CHARS = 16 * 1024 * 1024
const MAX_STRING = 32 * 1024
const MAX_ARGS = 256
const MAX_ENV = 256
const MAX_DIMENSION = 1000
const AGENT_KINDS: ReadonlySet<unknown> = new Set<AgentKind>(['claude', 'codex', 'shell'])

export function parseSessionId(value: unknown): string {
  if (typeof value !== 'string' || !SESSION_ID.test(value)) throw new Error('invalid session id')
  return value
}

export function parseWriteData(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_WRITE_CHARS) throw new Error('invalid write data')
  return value
}

export function parseSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_DIMENSION
  if (!valid(cols) || !valid(rows)) throw new Error('invalid terminal size')
  return { cols, rows }
}

export function parseAckCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('invalid ack count')
  return Math.floor(value)
}

function parseString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > MAX_STRING || value.includes('\0')) throw new Error(`invalid ${name}`)
  return value
}

export function parseSpawnOptions(raw: unknown): PtySpawnOptions {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid spawn options')
  const o = raw as Record<string, unknown>

  const sessionId = parseSessionId(o.sessionId)
  const cwd = parseString(o.cwd, 'cwd')
  const { cols, rows } = parseSize(o.cols, o.rows)
  const result: PtySpawnOptions = { sessionId, cwd, cols, rows }

  if (o.agent !== undefined) {
    if (!AGENT_KINDS.has(o.agent)) throw new Error('invalid agent')
    result.agent = o.agent as AgentKind
  }
  if (o.resumeAgentSessionId !== undefined) {
    if (!isSafeAgentSessionId(o.resumeAgentSessionId)) throw new Error('invalid resume id')
    result.resumeAgentSessionId = o.resumeAgentSessionId
  }
  if (o.command !== undefined) {
    const command = parseString(o.command, 'command')
    if (command.length === 0) throw new Error('invalid command')
    result.command = command
  }
  if (o.args !== undefined) {
    if (!Array.isArray(o.args) || o.args.length > MAX_ARGS) throw new Error('invalid args')
    result.args = o.args.map((arg) => parseString(arg, 'arg'))
  }
  if (o.resumeAgentSessionId !== undefined) {
    const id = parseString(o.resumeAgentSessionId, 'resume id')
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error('invalid resume id')
    result.resumeAgentSessionId = id
  }
  if (o.initialPrompt !== undefined) {
    if (result.agent === undefined || result.agent === 'shell') throw new Error('a first message needs an agent')
    result.initialPrompt = parseString(o.initialPrompt, 'first message')
  }
  if (o.model !== undefined) {
    const model = parseString(o.model, 'model')
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/[\]-]{0,79}$/.test(model)) throw new Error('invalid model')
    result.model = model
  }
  if (o.script !== undefined) {
    if (o.script !== 'setup' && o.script !== 'run') throw new Error('invalid script')
    if (result.command !== undefined) throw new Error('a script cannot be combined with a command')
    result.script = o.script
  }
  if (o.env !== undefined) {
    if (typeof o.env !== 'object' || o.env === null || Array.isArray(o.env)) throw new Error('invalid env')
    const entries = Object.entries(o.env as Record<string, unknown>)
    if (entries.length > MAX_ENV) throw new Error('invalid env')
    const env: Record<string, string> = {}
    for (const [key, value] of entries) {
      if (!ENV_KEY.test(key)) throw new Error('invalid env key')
      env[key] = parseString(value, 'env value')
    }
    result.env = env
  }
  return result
}
