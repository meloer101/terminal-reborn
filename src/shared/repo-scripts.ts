// A repository's own scripts (PRD F4 · 脚本与端口): `.tr/settings.toml`, committed with the code, names a `setup`
// script (run in the visible terminal of every new worktree before the agent starts), a `run` script (the session
// header's Run button), an optional `test` script (the merge sheet, before 合并) and an `archive` script (F15).
// Pure: parsing, validation, what an approval covers, the app-owned store of approvals and port blocks. Unknown
// keys are ignored so the file can grow.
import { parse, TomlError } from 'smol-toml'

/** Relative to the worktree's top level. */
export const REPO_SETTINGS_FILE = '.tr/settings.toml'
/** Bigger files are not read at all. */
export const MAX_SETTINGS_BYTES = 64 * 1024
export const MAX_SCRIPT_CHARS = 16 * 1024
const MAX_SCRIPT_LINES = 200

/** The original three. An approval of a file with no `test` key is hashed from these alone, so adding `test` to the
 * parser does not make every existing approval ask again. */
export const SCRIPT_NAMES = ['setup', 'run', 'archive'] as const
const READ_SCRIPTS = [...SCRIPT_NAMES, 'test'] as const
export type ScriptName = (typeof READ_SCRIPTS)[number]
/** Scripts a terminal spawn may run. `test` is captured outside the PTY (see CapturedScript). */
export type RunnableScript = 'setup' | 'run'
/** A script main runs itself and keeps the output of, instead of handing it to a terminal (`archive`: PRD F15). */
export type CapturedScript = 'test' | 'archive'

/** Each present script is non-empty shell text (an array in the file is joined with newlines). */
export type RepoScripts = Partial<Record<ScriptName, string>>

export interface RepoSettings {
  scripts: RepoScripts
  /** What was wrong with the file, as UI copy; the parts that were fine still count. */
  problems: string[]
}

function scriptValue(name: ScriptName, value: unknown, problems: string[]): string | undefined {
  let text: string
  if (typeof value === 'string') text = value
  else if (Array.isArray(value) && value.length <= MAX_SCRIPT_LINES && value.every((line) => typeof line === 'string')) text = value.join('\n')
  else {
    problems.push(`scripts.${name} 应该是字符串或字符串数组`)
    return undefined
  }
  if (text.includes('\0')) {
    problems.push(`scripts.${name} 含有不能用的字符`)
    return undefined
  }
  if (text.length > MAX_SCRIPT_CHARS) {
    problems.push(`scripts.${name} 太长（最多 ${MAX_SCRIPT_CHARS} 个字符）`)
    return undefined
  }
  return text.trim() === '' ? undefined : text.trim()
}

/**
 * `.tr/settings.toml` → the scripts it names. Only `[scripts]` `setup` / `run` / `archive` / `test` are read, each a
 * string or an array of strings; anything else in the file is ignored. Never throws: a file that is not TOML has no
 * scripts.
 */
export function parseRepoSettings(text: string): RepoSettings {
  let root: unknown
  try {
    root = parse(text)
  } catch (error) {
    if (error instanceof TomlError) {
      const reason = error.message.split('\n')[0]?.replace(/^Invalid TOML document:\s*/, '') ?? ''
      return { scripts: {}, problems: [`${REPO_SETTINGS_FILE} 第 ${error.line} 行格式不对${reason ? `（${reason}）` : ''}`] }
    }
    return { scripts: {}, problems: [`${REPO_SETTINGS_FILE} 不是有效的 TOML`] }
  }
  const problems: string[] = []
  const table = (root as Record<string, unknown>).scripts
  if (table === undefined) return { scripts: {}, problems }
  if (typeof table !== 'object' || table === null || Array.isArray(table) || table instanceof Date) {
    return { scripts: {}, problems: ['scripts 应该是一个表（[scripts]）'] }
  }
  const scripts: RepoScripts = {}
  for (const name of READ_SCRIPTS) {
    const value = (table as Record<string, unknown>)[name]
    if (value === undefined) continue
    const script = scriptValue(name, value, problems)
    if (script !== undefined) scripts[name] = script
  }
  return { scripts, problems }
}

export function hasScripts(scripts: RepoScripts): boolean {
  return READ_SCRIPTS.some((name) => scripts[name] !== undefined)
}

/**
 * What an approval covers, in a fixed order. Approving once covers every script together; changing any of them (not
 * other keys, comments or formatting) asks again. Main hashes this.
 *
 * `test` is appended only when the file defines it. Repos approved before `test` existed, and repos with no test,
 * keep the three-name payload, so they are not asked again just because the parser learned a new key.
 */
export function approvalInput(scripts: RepoScripts): string {
  const entries: [ScriptName, string | null][] = SCRIPT_NAMES.map((name) => [name, scripts[name] ?? null])
  if (scripts.test !== undefined) entries.push(['test', scripts.test])
  return JSON.stringify(entries)
}

const DETAIL_SCRIPT_CHARS = 600

/** The confirmation sheet's text: every command the approval lets run, each shortened if very long. */
const SCRIPT_WHEN: Partial<Record<ScriptName, string>> = { archive: '（归档时）', test: '（合并前）' }

export function approvalDetail(scripts: RepoScripts): string {
  const blocks = READ_SCRIPTS.filter((name) => scripts[name] !== undefined).map((name) => {
    const text = scripts[name]!
    const shown = text.length > DETAIL_SCRIPT_CHARS ? `${text.slice(0, DETAIL_SCRIPT_CHARS)}…` : text
    return `${name}${SCRIPT_WHEN[name] ?? ''}：\n${shown}`
  })
  return `${blocks.join('\n\n')}\n\n这些命令来自仓库里的 ${REPO_SETTINGS_FILE}，会在 worktree 里运行。内容改变后会再问一次。`
}

// --- the store main keeps in <userData>/repo-scripts.json --------------------------------------------------------

export interface RepoScriptsStore {
  version: 1
  /**
   * Repository key (its git common dir) → hashes of approved scripts, newest first. Several, so worktrees on branches
   * with different scripts do not ask again each time.
   */
  approvals: Record<string, string[]>
  /** Worktree folder → port block index. */
  ports: Record<string, number>
}

const MAX_KEY = 4096
const HASH = /^[0-9a-f]{64}$/
/** Approved versions remembered per repository. */
export const MAX_APPROVALS = 20

/** `hash` first, then the older approvals, at most MAX_APPROVALS. */
export function withApproval(approved: readonly string[] | undefined, hash: string): string[] {
  return [hash, ...(approved ?? []).filter((h) => h !== hash)].slice(0, MAX_APPROVALS)
}

/** Any JSON value → a valid store (bad entries dropped, duplicate port blocks keep the first). */
export function sanitizeRepoScriptsStore(raw: unknown): RepoScriptsStore {
  const v = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const entries = (value: unknown): [string, unknown][] =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.entries(value) : []
  const isKey = (key: string) => key.startsWith('/') && key.length <= MAX_KEY && !key.includes('\0')
  const approvals: Record<string, string[]> = {}
  for (const [key, hashes] of entries(v.approvals)) {
    if (!isKey(key) || !Array.isArray(hashes)) continue
    const valid = [...new Set(hashes.filter((h): h is string => typeof h === 'string' && HASH.test(h)))].slice(0, MAX_APPROVALS)
    if (valid.length > 0) approvals[key] = valid
  }
  const ports: Record<string, number> = {}
  const used = new Set<number>()
  for (const [key, index] of entries(v.ports)) {
    if (!isKey(key) || !Number.isInteger(index) || (index as number) < 0 || used.has(index as number)) continue
    ports[key] = index as number
    used.add(index as number)
  }
  return { version: 1, approvals, ports }
}
