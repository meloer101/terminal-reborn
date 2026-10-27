// Risk markers (PRD F13 v1.78, Figma 29A): facts read off a unified diff with rules, no model — tests deleted or
// skipped, checks silenced, CI config, dependencies, migrations. Shown at checkpoint 1 and used by the auto-fix brake.

export type RiskKind = 'test-deleted' | 'test-skipped' | 'check-silenced' | 'ci-config' | 'dependencies' | 'migration'

export interface RiskMarker {
  kind: RiskKind
  path: string
  /** How many hits in that file (deleted test cases, added skips, …); 1 for a file-level marker. */
  count: number
  /** kind 'test-deleted': the whole test file was deleted (then `count` is the test cases it had, at least 1). */
  wholeFile?: boolean
}

const KIND_ORDER: RiskKind[] = ['test-deleted', 'test-skipped', 'check-silenced', 'ci-config', 'migration', 'dependencies']

// ── paths ───────────────────────────────────────────────────────────────────────────────────────────────────────

const TEST_FILE = [
  /(^|\/)(__tests__|tests?|e2e|spec)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_test\.go$/,
  /(^|\/)test_[^/]*\.py$/,
  /_test\.py$/
]

export function isTestFile(path: string): boolean {
  return TEST_FILE.some((re) => re.test(path))
}

const CI_PATHS = [
  /^\.github\/workflows\//,
  /(^|\/)\.gitlab-ci\.yml$/,
  /(^|\/)\.circleci\//,
  /(^|\/)azure-pipelines\.yml$/,
  /(^|\/)Jenkinsfile$/,
  /(^|\/)\.buildkite\//
]

const CHECK_CONFIG_PATHS = [
  /(^|\/)eslint\.config\.[^/]+$/,
  /(^|\/)\.eslintrc[^/]*$/,
  /(^|\/)jest\.config\.[^/]+$/,
  /(^|\/)vitest\.config\.[^/]+$/,
  /(^|\/)playwright\.config\.[^/]+$/,
  /(^|\/)tsconfig[^/]*\.json$/
]

/** A lint / type / test runner config, as opposed to a CI pipeline file. */
function isCheckConfig(path: string): boolean {
  return CHECK_CONFIG_PATHS.some((re) => re.test(path))
}

const DEPENDENCY_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'uv.lock',
  'Gemfile.lock',
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'Gemfile'
])

function isDependencyFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return DEPENDENCY_FILES.has(name) || /^requirements[^/]*\.txt$/.test(name)
}

function isMigration(path: string): boolean {
  if (isTestFile(path)) return false
  const dirs = path.split('/').slice(0, -1)
  if (dirs.some((d) => d === 'migrations' || d === 'migration' || d === 'migrate')) return true
  if (/(^|\/)alembic\/versions\//.test(path)) return true
  return /(^|\/)db\/.+\.sql$/.test(path)
}

/** Files whose lines are prose or generated, never code that skips or silences a check. */
function isInertContent(path: string): boolean {
  return /\.(md|mdx|markdown|txt|rst|snap)$/i.test(path) || /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|bun\.lock)$/.test(path)
}

// ── diff ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface FileDiff {
  path: string
  deleted: boolean
  added: string[]
  removed: string[]
}

/** git quotes paths with special characters: `"a/\344\270\255.ts"`. */
function unquote(raw: string): string {
  if (!(raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))) return raw
  const bytes: number[] = []
  const encoder = new TextEncoder()
  const body = raw.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (ch !== '\\') {
      bytes.push(...encoder.encode(ch))
      continue
    }
    const next = body[i + 1] ?? ''
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1, i + 4))
    if (octal) {
      bytes.push(parseInt(octal[0], 8))
      i += 3
    } else {
      const map: Record<string, string> = { t: '\t', n: '\n', r: '\r', '"': '"', '\\': '\\' }
      bytes.push(...encoder.encode(map[next] ?? next))
      i += 1
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

const HEADER = /^diff --git (?:("a\/(?:[^"\\]|\\.)*")|a\/(.+?)) (?:("b\/(?:[^"\\]|\\.)*")|b\/(.+))$/

function stripPrefix(path: string, prefix: 'a/' | 'b/'): string {
  return path.startsWith(prefix) ? path.slice(2) : path
}

function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = []
  let current: (FileDiff & { oldPath: string; newPath: string | null; inHunk: boolean }) | null = null
  const flush = (): void => {
    if (!current) return
    const path = current.deleted ? current.oldPath : (current.newPath ?? current.oldPath)
    if (path) files.push({ path, deleted: current.deleted, added: current.added, removed: current.removed })
    current = null
  }
  for (const rawLine of diff.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.startsWith('diff --git ')) {
      flush()
      const m = HEADER.exec(line)
      const oldPath = m ? (m[1] ? unquote(m[1]).slice(2) : (m[2] ?? '')) : ''
      const newPath = m ? (m[3] ? unquote(m[3]).slice(2) : (m[4] ?? '')) : ''
      current = { path: '', deleted: false, added: [], removed: [], oldPath, newPath: newPath || null, inHunk: false }
      continue
    }
    if (!current) continue
    if (!current.inHunk) {
      if (line.startsWith('@@')) current.inHunk = true
      else if (line.startsWith('deleted file mode')) current.deleted = true
      else if (line.startsWith('rename from ')) current.oldPath = unquote(line.slice('rename from '.length))
      else if (line.startsWith('rename to ')) current.newPath = unquote(line.slice('rename to '.length))
      else if (line.startsWith('--- ')) {
        const p = unquote(line.slice(4).replace(/\t.*$/, ''))
        if (p !== '/dev/null') current.oldPath = stripPrefix(p, 'a/')
      } else if (line.startsWith('+++ ')) {
        const p = unquote(line.slice(4).replace(/\t.*$/, ''))
        if (p === '/dev/null') current.deleted = true
        else current.newPath = stripPrefix(p, 'b/')
      }
      continue
    }
    if (line.startsWith('+')) current.added.push(line.slice(1))
    else if (line.startsWith('-')) current.removed.push(line.slice(1))
  }
  flush()
  return files
}

// ── test cases ──────────────────────────────────────────────────────────────────────────────────────────────────

type Lang = 'js' | 'py' | 'go'

function langOf(path: string): Lang {
  if (/\.py$/.test(path)) return 'py'
  if (/\.go$/.test(path)) return 'go'
  return 'js'
}

const JS_CASE = /^\s*[xf]?(?:it|test|describe)(?:\.\w+)*\s*(?:\(|`)/
const PY_CASE = /^\s*(?:async\s+)?def\s+(test_\w*)\s*\(/
const GO_CASE = /^\s*func\s+(Test\w*)\s*\(/
const FIRST_LITERAL = /(['"`])((?:\\.|(?!\1).)*)\1/

/** The identity of the test case a line starts (its name), or null when the line starts none. */
function testCaseKey(line: string, lang: Lang): string | null {
  if (lang === 'py') return PY_CASE.exec(line)?.[1] ?? null
  if (lang === 'go') return GO_CASE.exec(line)?.[1] ?? null
  if (!JS_CASE.test(line)) return null
  const literal = FIRST_LITERAL.exec(line)
  return literal ? literal[2]! : line.trim()
}

function caseKeys(lines: string[], lang: Lang): string[] {
  const keys: string[] = []
  for (const line of lines) {
    const key = testCaseKey(line, lang)
    if (key !== null) keys.push(key)
  }
  return keys
}

/** Removed test cases the diff does not add back under the same name (a moved or re-indented test is not deleted). */
function deletedCases(file: FileDiff): number {
  const lang = langOf(file.path)
  const pool = new Map<string, number>()
  for (const key of caseKeys(file.added, lang)) pool.set(key, (pool.get(key) ?? 0) + 1)
  let lost = 0
  for (const key of caseKeys(file.removed, lang)) {
    const left = pool.get(key) ?? 0
    if (left > 0) pool.set(key, left - 1)
    else lost++
  }
  return lost
}

// ── skipped tests, silenced checks ──────────────────────────────────────────────────────────────────────────────

/** Skips that are unmistakable in any file. */
const SKIP_ANYWHERE = [
  /\b(?:it|test|describe|suite|context|specify)(?:\.\w+)*\.(?:skip|todo|only)\b/,
  /(?<![.\w])x(?:it|describe|test)\s*\(/,
  /(?<![.\w])f(?:it|describe)\s*\(/,
  /@pytest\.mark\.skip(?!if)\b/,
  /\bpytest\.skip\s*\(/,
  /@unittest\.skip(?!If|Unless)\w*\b/,
  /\b[tb]\.Skip(?:Now|f)?\s*\(/,
  /@(?:org\.junit\.(?:jupiter\.api\.)?)?Disabled\b/,
  /@(?:org\.junit\.)?Ignore\b/
]

/** Bare `.skip(` / `.todo(` / `.only(` only count in a test file (`this.skip()`, `it.each(...)(...).skip`). */
const SKIP_IN_TESTS = [/\.(?:skip|todo|only)\s*\(/]

const COMMENT_LINE = /^\s*(?:\/\/|#|\*|\/\*|--)/

const SILENCERS = [
  /\|\|\s*true\b/,
  /continue-on-error:\s*true\b/,
  /--passWithNoTests\b/,
  /eslint-disable/,
  /@ts-ignore\b/,
  /@ts-expect-error\b/,
  /#\s*noqa\b/,
  /#\s*type:\s*ignore\b/,
  /--no-verify\b/
]

/** Lines matching a rule, minus identical lines the diff removes (an edited line that keeps its marker is not new). */
function netHits(file: FileDiff, hit: (line: string) => boolean): number {
  const gone = new Map<string, number>()
  for (const line of file.removed) {
    if (!hit(line)) continue
    const key = line.trim()
    gone.set(key, (gone.get(key) ?? 0) + 1)
  }
  let count = 0
  for (const line of file.added) {
    if (!hit(line)) continue
    const key = line.trim()
    const left = gone.get(key) ?? 0
    if (left > 0) gone.set(key, left - 1)
    else count++
  }
  return count
}

function isSkipLine(line: string, inTestFile: boolean): boolean {
  if (COMMENT_LINE.test(line)) return false
  if (SKIP_ANYWHERE.some((re) => re.test(line))) return true
  return inTestFile && SKIP_IN_TESTS.some((re) => re.test(line))
}

function isSilencerLine(line: string): boolean {
  return SILENCERS.some((re) => re.test(line))
}

// ── markers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The markers of a unified diff (`git diff` output), one per kind and file. */
export function riskMarkers(diff: string): RiskMarker[] {
  const found = new Map<string, RiskMarker>()
  const add = (marker: RiskMarker): void => {
    const key = `${marker.kind}\0${marker.path}`
    const old = found.get(key)
    if (old) {
      old.count += marker.count
      if (marker.wholeFile) old.wholeFile = true
    } else found.set(key, marker)
  }
  for (const file of parseDiff(diff)) {
    const { path } = file
    const test = isTestFile(path)
    if (test) {
      if (file.deleted) {
        add({ kind: 'test-deleted', path, count: Math.max(1, caseKeys(file.removed, langOf(path)).length), wholeFile: true })
      } else {
        const lost = deletedCases(file)
        if (lost > 0) add({ kind: 'test-deleted', path, count: lost })
      }
    }
    if (!file.deleted && !isInertContent(path)) {
      const skipped = netHits(file, (line) => isSkipLine(line, test))
      if (skipped > 0) add({ kind: 'test-skipped', path, count: skipped })
      const silenced = netHits(file, isSilencerLine)
      if (silenced > 0) add({ kind: 'check-silenced', path, count: silenced })
    }
    if (CI_PATHS.some((re) => re.test(path)) || isCheckConfig(path)) add({ kind: 'ci-config', path, count: 1 })
    if (isMigration(path)) add({ kind: 'migration', path, count: 1 })
    if (isDependencyFile(path)) add({ kind: 'dependencies', path, count: 1 })
  }
  return [...found.values()].sort((a, b) => {
    const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    if (byKind !== 0) return byKind
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  })
}

/** One marker without its path, e.g. "删了 1 个测试" (the auto-fix brake's label uses it). */
export function riskPhrase(marker: RiskMarker): string {
  switch (marker.kind) {
    case 'test-deleted':
      return marker.wholeFile ? '删了测试文件' : `删了 ${marker.count} 个测试`
    case 'test-skipped':
      return `跳过了 ${marker.count} 个测试`
    case 'check-silenced':
      return `关掉了 ${marker.count} 处检查`
    case 'ci-config':
      return isCheckConfig(marker.path) ? '改了检查配置' : '改了 CI 配置'
    case 'migration':
      return '有数据库迁移'
    case 'dependencies':
      return '改了依赖'
  }
}

/** One marker as its row reads, e.g. "改了 CI 配置 · .github/workflows/ci.yml". */
export function riskLabel(marker: RiskMarker): string {
  return `${riskPhrase(marker)} · ${marker.path}`
}
