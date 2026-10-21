// Which tests / lint / typecheck / build an agent's Bash call ran, and whether each passed (PRD F9 / F4 “这一轮跑过
// 哪些检查”). Pure and local: a command line and the tool result in, check runs out; no tokens, no processes.
//
// The shell is read only as far as it decides who owns the exit code: `&&` chains, `;` / `||` / `&`, pipes (a pipe hands
// the exit code to its last command unless `set -o pipefail`), `cd` (for the package.json a script lives in) and
// `sh -c '…'`. Wrappers (`npx`, `pnpm exec`, `uv run`, `python -m`, env assignments, `time`, …) are peeled off. Package
// scripts (`npm run check`) resolve through the package.json when there is one, so a script that runs typecheck + lint +
// test counts as all three; otherwise the script's name decides. When the exit code does not belong to the check (piped
// into `tail`, followed by `; echo`) or the agent gives none (Codex, PRD §6.7), the runner's own summary line decides,
// and when there is none the result is honestly unknown.
import type { CheckKind, CheckOutcome, CheckRun } from './turn-checks'

/** The tool result of one Bash call, as main reads it from PostToolUse / PostToolUseFailure. */
export interface BashResult {
  /** null when the agent does not report one (Codex 0.142.5) or the call failed without one (a timeout). */
  exitCode: number | null
  /** stdout + stderr (or the failure text), only its tail is read. */
  output: string
  /** The user interrupted the call: it finished neither way. */
  interrupted?: boolean
}

/** `package.json` scripts of a folder, if it has any; main reads (and caches) the file. */
export type ScriptsLookup = (dir: string) => Readonly<Record<string, string>> | undefined

/** Only the end of a long output carries a runner's summary. */
const OUTPUT_TAIL = 16_000
const MAX_COMMAND = 120
const MAX_SCRIPT_DEPTH = 3

// ---------------------------------------------------------------------------------------------
// Shell splitting
// ---------------------------------------------------------------------------------------------

type Op = '&&' | '||' | ';' | '|' | '&'

interface Segment {
  words: string[]
  /** The operator after this segment; null for the last one. */
  op: Op | null
}

/** Splits a command line into simple commands at top-level operators, honoring quotes and escapes. */
export function splitShell(command: string): Segment[] {
  const segments: Segment[] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  let quote: '"' | "'" | null = null
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSegment = (op: Op | null) => {
    endWord()
    if (words.length > 0 || op !== null) segments.push({ words, op })
    words = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string
    const next = command[i + 1]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && next !== undefined) {
        word += next
        i++
      } else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      inWord = true
      continue
    }
    if (c === '\\' && next !== undefined) {
      if (next !== '\n') {
        word += next
        inWord = true
      }
      i++
      continue
    }
    if (c === '#' && !inWord) {
      // A comment runs to the end of the line.
      while (i + 1 < command.length && command[i + 1] !== '\n') i++
      continue
    }
    if (c === ' ' || c === '\t') {
      endWord()
      continue
    }
    if (c === '\n') {
      endSegment(';')
      continue
    }
    if (c === '&') {
      // `2>&1`, `&>file`: part of a redirection, not an operator.
      if (word.endsWith('>') || word.endsWith('<') || next === '>') {
        word += c
        inWord = true
        continue
      }
      if (next === '&') {
        endSegment('&&')
        i++
      } else endSegment('&')
      continue
    }
    if (c === '|') {
      if (next === '|') {
        endSegment('||')
        i++
      } else {
        endSegment('|')
        if (next === '&') i++
      }
      continue
    }
    if (c === ';') {
      endSegment(';')
      continue
    }
    if ((c === '(' || c === ')' || c === '{' || c === '}') && !inWord) continue
    word += c
    inWord = true
  }
  endSegment(null)
  // Drop empty segments left by `;;`, trailing newlines and so on, keeping the operator of the last real one.
  const out: Segment[] = []
  for (const s of segments) {
    if (s.words.length === 0) {
      const last = out[out.length - 1]
      if (last && s.op !== null && last.op === ';') last.op = s.op
      continue
    }
    out.push(s)
  }
  const last = out[out.length - 1]
  if (last && (last.op === ';' || last.op === '&')) last.op = last.op === '&' ? '&' : null
  return out
}

const REDIRECT = /^\d*(>>?|<|&>>?|>&|<&)/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Words without env assignments in front and without redirections. */
function cleanWords(words: string[]): string[] {
  const out: string[] = []
  let start = true
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string
    if (start && ASSIGNMENT.test(w)) continue
    start = false
    const redirect = REDIRECT.exec(w)
    if (redirect) {
      // `> file`: the target is the next word.
      if (redirect[0] === w && !w.endsWith('&')) i++
      continue
    }
    out.push(w)
  }
  return out
}

const base = (word: string): string => word.slice(word.lastIndexOf('/') + 1)

// ---------------------------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------------------------

const PLAIN_WRAPPERS = new Set(['time', 'command', 'exec', 'nice', 'nohup', 'caffeinate', 'xvfb-run', 'stdbuf', 'unbuffer', 'dotenv', 'npx', 'pnpx', 'bunx', 'with-env'])

/** Strips `npx`, `pnpm exec`, `uv run`, `python -m`, `env A=b`, `timeout 60`, … off the front. */
function peel(words: string[]): string[] {
  let w = words
  for (let guard = 0; guard < 8 && w.length > 0; guard++) {
    const head = base(w[0] as string)
    const rest = w.slice(1)
    if (PLAIN_WRAPPERS.has(head)) {
      w = dropFlags(rest)
      continue
    }
    if (head === 'env') {
      let i = 0
      while (i < rest.length && ((rest[i] as string).startsWith('-') || ASSIGNMENT.test(rest[i] as string))) i++
      w = rest.slice(i)
      continue
    }
    if (head === 'timeout' || head === 'gtimeout') {
      const r = dropFlags(rest)
      w = r.slice(1)
      continue
    }
    if (head === 'dotenvx' && rest[0] === 'run') {
      const dash = rest.indexOf('--')
      w = dash >= 0 ? rest.slice(dash + 1) : rest.slice(1)
      continue
    }
    if ((head === 'pnpm' || head === 'yarn' || head === 'bun') && (rest[0] === 'exec' || rest[0] === 'dlx' || rest[0] === 'x')) {
      w = dropFlags(rest.slice(1))
      continue
    }
    if (head === 'npm' && (rest[0] === 'exec' || rest[0] === 'x')) {
      const r = dropFlags(rest.slice(1))
      w = r[0] === '--' ? r.slice(1) : r
      continue
    }
    if ((head === 'uv' || head === 'poetry' || head === 'pipenv' || head === 'hatch' || head === 'pdm' || head === 'rye') && rest[0] === 'run') {
      w = dropFlags(rest.slice(1))
      continue
    }
    if (head === 'bundle' && rest[0] === 'exec') {
      w = rest.slice(1)
      continue
    }
    if (/^python(\d(\.\d+)?)?$/.test(head) && rest[0] === '-m') {
      w = rest.slice(1)
      continue
    }
    break
  }
  return w
}

/** Leading flags (no values: wrappers here take none we need). */
function dropFlags(words: string[]): string[] {
  let i = 0
  while (i < words.length && (words[i] as string).startsWith('-') && words[i] !== '--') i++
  return words.slice(i)
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

interface Hit {
  kind: CheckKind
  /** No filter or path narrowed the run (only tracked for tests and lint, where reruns of one file are common). */
  full: boolean
}

/** Flags whose next word is a value, not a path (keeps `vitest run --reporter dot` a full run). */
const VALUE_FLAGS = new Set([
  '--reporter', '-c', '--config', '--project', '--dir', '--root', '--workers', '--maxWorkers', '-n', '--pool', '--environment',
  '--env', '--format', '-f', '--ext', '--cache-location', '--max-warnings', '--output-file', '-o', '--timeout', '-p',
  '--testTimeout', '--shard', '--retries', '--color', '--output-format', '--target', '-j', '--jobs', '--features',
  '--package', '--manifest-path', '-r', '--require', '--outputFile', '--coverage.reporter', '--tb', '--maxfail', '-x'
])
const FILTER_FLAGS = new Set(['-t', '--testNamePattern', '-k', '--grep', '-g', '-run', '--run', '--filter', '--only', '--testPathPattern', '--lf', '--last-failed', '--changed', '--onlyChanged', '-o', '--findRelatedTests', '--related'])

/** Whether the arguments after a check narrow it to some files or tests. */
function isFull(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === '--') continue
    const flag = a.split('=')[0] as string
    if (FILTER_FLAGS.has(flag)) return false
    if (a.startsWith('-')) {
      if (!a.includes('=') && VALUE_FLAGS.has(a)) i++
      continue
    }
    if (a === '.' || a === './') continue
    return false
  }
  return true
}

const hit = (kind: CheckKind, args: string[] = []): Hit[] => [{ kind, full: kind === 'test' || kind === 'lint' ? isFull(args) : true }]

/** A package script, task or make target by its name alone (`test:unit`, `lint`, `typecheck`, `build:web`). */
export function kindOfName(name: string): CheckKind | null {
  const n = name.toLowerCase()
  if (/(^|[:_-])(typecheck|type-check|typecheck|types|tsc|check-types|check:types|typing|mypy|pyright)([:_-]|$)/.test(n) || /^type[-_]?check/.test(n)) return 'typecheck'
  if (/(^|[:_-])(lint|lints|eslint|stylelint|biome|clippy|ruff|flake8|pylint|format:check|fmt:check|check:format|check:lint|prettier:check|fmt-check|format-check)([:_-]|$)/.test(n) || /^lint/.test(n)) return 'lint'
  if (/(^|[:_-])(test|tests|spec|specs|e2e|unit|integration|vitest|jest|playwright|cypress|pytest|coverage)([:_-]|$)/.test(n) || /^test/.test(n)) return 'test'
  if (/^(build|compile|bundle|dist)([:_-]|$)/.test(n)) return 'build'
  return null
}

/** `make test`, `just lint`, `turbo run build`: each named target counts by its name. */
function namedTargets(names: string[]): Hit[] {
  const out: Hit[] = []
  for (const name of names) {
    if (name.startsWith('-') || name.includes('=')) continue
    const task = name.includes(':') && !/^(test|lint|build|check|type)/.test(name) ? (name.split(':').pop() as string) : name
    const kind = kindOfName(task)
    if (kind && !out.some((h) => h.kind === kind)) out.push({ kind, full: true })
  }
  return out
}

/** Subcommand → kind for tools whose first argument decides (`cargo test`, `go vet`, `ruff check`). */
const SUBCOMMANDS: Record<string, Record<string, CheckKind>> = {
  cargo: { test: 'test', nextest: 'test', clippy: 'lint', check: 'typecheck', build: 'build', b: 'build', t: 'test', c: 'typecheck' },
  go: { test: 'test', vet: 'lint', build: 'build' },
  swift: { test: 'test', build: 'build' },
  deno: { test: 'test', lint: 'lint', check: 'typecheck' },
  dotnet: { test: 'test', build: 'build' },
  mix: { test: 'test', credo: 'lint', dialyzer: 'typecheck', compile: 'build' },
  rake: { test: 'test', spec: 'test' },
  bazel: { test: 'test', build: 'build' },
  bazelisk: { test: 'test', build: 'build' },
  zig: { test: 'test' },
  mvn: { test: 'test', verify: 'test', compile: 'build', package: 'build', install: 'build' },
  mvnw: { test: 'test', verify: 'test', compile: 'build', package: 'build', install: 'build' },
  gradle: { test: 'test', check: 'test', build: 'build', assemble: 'build' },
  gradlew: { test: 'test', check: 'test', build: 'build', assemble: 'build' },
  ruff: { check: 'lint' },
  biome: { lint: 'lint', check: 'lint', ci: 'lint' },
  playwright: { test: 'test' },
  cypress: { run: 'test' },
  vite: { build: 'build' },
  vitest: { typecheck: 'typecheck' },
  next: { build: 'build', lint: 'lint' },
  nuxt: { build: 'build', typecheck: 'typecheck' },
  nuxi: { build: 'build', typecheck: 'typecheck' },
  astro: { build: 'build', check: 'typecheck' },
  'electron-vite': { build: 'build' },
  parcel: { build: 'build' },
  flutter: { test: 'test', analyze: 'lint', build: 'build' },
  dart: { test: 'test', analyze: 'lint' },
  srb: { tc: 'typecheck' },
  steep: { check: 'typecheck' },
  flow: { check: 'typecheck' },
  tox: {},
  xcodebuild: {}
}

/** Tools that are one kind of check whatever their arguments. */
const DIRECT: Record<string, CheckKind> = {
  vitest: 'test', jest: 'test', mocha: 'test', ava: 'test', tap: 'test', jasmine: 'test', karma: 'test', pytest: 'test', 'py.test': 'test',
  tox: 'test', nox: 'test', unittest: 'test', nose2: 'test', rspec: 'test', phpunit: 'test', pest: 'test', ctest: 'test', 'web-test-runner': 'test',
  wtr: 'test', uvu: 'test', tsd: 'typecheck',
  eslint: 'lint', oxlint: 'lint', stylelint: 'lint', flake8: 'lint', pylint: 'lint', pyflakes: 'lint', pycodestyle: 'lint', rubocop: 'lint',
  standardrb: 'lint', 'golangci-lint': 'lint', staticcheck: 'lint', swiftlint: 'lint', shellcheck: 'lint', markdownlint: 'lint',
  'markdownlint-cli2': 'lint', ktlint: 'lint', detekt: 'lint', hadolint: 'lint', actionlint: 'lint', xo: 'lint', standard: 'lint', clippy: 'lint',
  tsc: 'typecheck', tsgo: 'typecheck', 'vue-tsc': 'typecheck', 'svelte-check': 'typecheck', mypy: 'typecheck', dmypy: 'typecheck', pyright: 'typecheck',
  basedpyright: 'typecheck', pytype: 'typecheck', ty: 'typecheck',
  webpack: 'build', rollup: 'build', tsup: 'build', unbuild: 'build', 'electron-builder': 'build', ninja: 'build', rspack: 'build', rsbuild: 'build'
}

/** Arguments that only print help or a version: not a check. */
const NOT_A_RUN = new Set(['--version', '-v', '-V', '--help', '-h', '--init', '--watch', 'init', 'help', 'version'])

/** Package-manager subcommands that are not a script name (`pnpm install`, `yarn add`, …). */
const PM_BUILTINS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'why', 'list', 'ls', 'outdated', 'publish', 'pack',
  'store', 'create', 'init', 'link', 'unlink', 'rebuild', 'prune', 'audit', 'config', 'env', 'import', 'fetch', 'patch', 'deploy', 'setup', 'root',
  'bin', 'licenses', 'server', 'info', 'view', 'show', 'cache', 'version', 'login', 'logout', 'whoami', 'help', 'start', 'dedupe', 'exec', 'dlx',
  'x', 'node', 'set', 'plugin', 'workspaces', 'pm', 'doctor', 'explain', 'search', 'owner', 'access', 'team', 'token', 'profile', 'star', 'docs',
  'repo', 'bugs', 'edit', 'explore', 'fund', 'hook', 'query', 'sbom', 'shrinkwrap', 'stop', 'restart', 'completion', 'prefix', 'global'
])
const PM_VALUE_FLAGS = new Set(['--prefix', '-C', '--dir', '--cwd', '-w', '--workspace', '--filter', '-F'])

interface Context {
  dir: string
  scripts?: ScriptsLookup
  depth: number
  /** package.json scripts being expanded, against cycles. */
  seen: Set<string>
}

/** A package-manager call: which script it runs, in which folder, with which extra arguments. */
function packageScript(words: string[], dir: string): { script: string; dir: string; args: string[] } | null {
  const pm = base(words[0] as string)
  if (pm !== 'npm' && pm !== 'pnpm' && pm !== 'yarn' && pm !== 'bun') return null
  let i = 1
  let where = dir
  while (i < words.length && (words[i] as string).startsWith('-')) {
    const flag = words[i] as string
    const [name, value] = flag.split('=', 2) as [string, string | undefined]
    if (PM_VALUE_FLAGS.has(name)) {
      const v = value ?? words[i + 1]
      if ((name === '--prefix' || name === '-C' || name === '--dir' || name === '--cwd') && v) where = joinDir(dir, v)
      if (value === undefined) i++
    }
    i++
  }
  let sub = words[i]
  if (sub === undefined) return null
  if (pm === 'yarn' && sub === 'workspace') {
    i += 2
    sub = words[i]
    if (sub === undefined) return null
  }
  if (sub === 'test' || sub === 't' || sub === 'tst') return { script: 'test', dir: where, args: words.slice(i + 1) }
  if (sub === 'run' || sub === 'run-script' || sub === 'rum' || sub === 'urn') {
    let j = i + 1
    while (j < words.length && (words[j] as string).startsWith('-')) j++
    const script = words[j]
    return script === undefined ? null : { script, dir: where, args: words.slice(j + 1) }
  }
  if (pm === 'npm' || PM_BUILTINS.has(sub)) return null
  // `pnpm lint`, `yarn typecheck`, `bun build`: shorthands for run (bun's own test / build are handled as tools).
  return { script: sub, dir: where, args: words.slice(i + 1) }
}

function joinDir(dir: string, path: string): string {
  if (path.startsWith('/')) return path.replace(/\/+$/, '') || '/'
  if (path.startsWith('~')) return path
  const parts = dir.split('/').filter(Boolean)
  for (const p of path.split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..') parts.pop()
    else parts.push(p)
  }
  return `/${parts.join('/')}`
}

/** What one simple command (already split, cleaned) checks. */
function classifyWords(raw: string[], ctx: Context): Hit[] {
  const words = peel(raw)
  const head = words[0]
  if (head === undefined) return []
  const name = base(head)
  const rest = words.slice(1)
  if (rest.some((a) => NOT_A_RUN.has(a)) && !(name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun')) return []

  // `sh -c 'npm test'`
  if ((name === 'sh' || name === 'bash' || name === 'zsh') && (rest[0] === '-c' || rest[0] === '-lc' || rest[0] === '-ic' || rest[0] === '-ec') && rest[1]) {
    return ctx.depth < MAX_SCRIPT_DEPTH ? hitsOf(rest[1], { ...ctx, depth: ctx.depth + 1 }) : []
  }

  // bun's own runner and bundler.
  if (name === 'bun' && rest[0] === 'test') return hit('test', rest.slice(1))
  if (name === 'bun' && rest[0] === 'build') return hit('build')

  const script = packageScript(words, ctx.dir)
  if (script) {
    const body = ctx.scripts?.(script.dir)?.[script.script]
    const key = `${script.dir}#${script.script}`
    if (body !== undefined && ctx.depth < MAX_SCRIPT_DEPTH && !ctx.seen.has(key)) {
      const inner = hitsOf(body, { ...ctx, dir: script.dir, depth: ctx.depth + 1, seen: new Set([...ctx.seen, key]) })
      if (inner.length > 0) {
        const full = isFull(script.args)
        return inner.map((h) => ({ kind: h.kind, full: h.full && full }))
      }
    }
    const kind = kindOfName(script.script)
    return kind ? hit(kind, script.args) : []
  }

  if (name === 'make' || name === 'gmake' || name === 'just' || name === 'task' || name === 'mise') {
    const targets = (name === 'mise' ? (rest[0] === 'run' || rest[0] === 'r' ? rest.slice(1) : []) : rest).filter((a) => !a.startsWith('-'))
    if (targets.length === 0) return name === 'make' || name === 'gmake' ? hit('build') : []
    return namedTargets(targets.map((t) => (t === 'check' ? 'test' : t === 'all' ? 'build' : t)))
  }
  if (name === 'turbo' || name === 'lerna' || name === 'nx' || name === 'moon') {
    const r = rest[0] === 'run' || rest[0] === 'run-many' ? rest.slice(1) : rest
    const tasks: string[] = []
    for (let i = 0; i < r.length; i++) {
      const a = r[i] as string
      if (a === '-t' || a === '--target' || a === '--targets') {
        tasks.push(...(r[i + 1] ?? '').split(','))
        i++
      } else if (!a.startsWith('-')) tasks.push(a)
    }
    return namedTargets(tasks)
  }
  if (name === 'xcodebuild') {
    const actions = rest.filter((a) => /^[a-z-]+$/.test(a))
    if (actions.includes('test') || actions.includes('test-without-building')) return hit('test')
    if (actions.includes('analyze')) return hit('lint')
    if (rest.includes('-showsdks') || rest.includes('-list') || rest.includes('-version')) return []
    return hit('build')
  }
  if (name === 'prettier') return rest.some((a) => a === '--check' || a === '-c' || a === '--list-different' || a === '-l') ? hit('lint', rest) : []
  if (name === 'black' || name === 'isort') return rest.some((a) => a === '--check' || a === '--check-only' || a === '-c') ? hit('lint', rest) : []
  if (name === 'gofmt') return rest.includes('-l') || rest.includes('-d') ? hit('lint', rest) : []
  if (name === 'swiftformat') return rest.includes('--lint') ? hit('lint', rest) : []
  if (name === 'cargo' && rest[0] === 'fmt') return rest.includes('--check') ? hit('lint') : []
  if (name === 'ruff' && rest[0] === 'format') return rest.includes('--check') ? hit('lint', rest.slice(1)) : []
  if (name === 'deno' && rest[0] === 'fmt') return rest.includes('--check') ? hit('lint') : []
  if (name === 'mix' && rest[0] === 'format') return rest.includes('--check-formatted') ? hit('lint') : []
  if (name === 'esbuild') return rest.includes('--bundle') ? hit('build') : []
  if (name === 'cmake') return rest.includes('--build') ? hit('build') : []
  if ((name === 'zig' || name === 'bazel' || name === 'bazelisk') && rest[0] === 'build') {
    if (name === 'zig' && rest[1] === 'test') return hit('test')
    return hit('build')
  }
  if (name === 'flow' && rest.length === 0) return hit('typecheck')

  const sub = SUBCOMMANDS[name]
  const first = rest[0]
  if (sub && first !== undefined && sub[first]) return hit(sub[first] as CheckKind, rest.slice(1))
  if (name === 'vitest') return first === 'bench' || first === 'list' ? [] : hit('test', first === 'run' || first === 'watch' ? rest.slice(1) : rest)
  if (name === 'jest' || name === 'mocha') return hit('test', rest)
  const direct = DIRECT[name]
  if (direct) return hit(direct, rest)
  // `./gradlew test`, `./mvnw verify`
  if ((name === 'gradlew' || name === 'mvnw') && first !== undefined) {
    const tasks = namedTargets(rest)
    return tasks
  }
  return []
}

/** The checks a whole command line runs (no outcome), in order; mostly for tests. */
function hitsOf(command: string, ctx: Context): Hit[] {
  const out: Hit[] = []
  let dir = ctx.dir
  for (const segment of splitShell(command)) {
    const words = cleanWords(segment.words)
    if (words[0] === 'cd' && words[1]) {
      if (segment.op === '&&' || segment.op === ';' || segment.op === null) dir = joinDir(dir, words[1])
      continue
    }
    for (const h of classifyWords(words, { ...ctx, dir })) if (!out.some((o) => o.kind === h.kind)) out.push(h)
  }
  return out
}

/** The kinds of check a command line runs, in order (each once). */
export function checkKindsOf(command: string, dir = '/', scripts?: ScriptsLookup): CheckKind[] {
  return hitsOf(command, { dir, ...(scripts ? { scripts } : {}), depth: 0, seen: new Set() }).map((h) => h.kind)
}

// ---------------------------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------------------------

type Verdict = 'pass' | 'fail' | undefined

/** The last line matching any of the patterns, as an index into the text (-1 when none). */
function lastIndex(text: string, pattern: RegExp): number {
  let index = -1
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  for (const m of text.matchAll(re)) index = m.index
  return index
}

/** How close a failure marker before a success marker must be to belong to the same summary (playwright lists failures first). */
const SAME_SUMMARY = 2_000

/** A failure in the last summary fails it; a success marker well after the last failure is a rerun that passed. */
function verdictFrom(text: string, fail: RegExp[], pass: RegExp[]): Verdict {
  const f = Math.max(...fail.map((p) => lastIndex(text, p)))
  const p = Math.max(...pass.map((q) => lastIndex(text, q)))
  if (f < 0 && p < 0) return undefined
  return f >= 0 && (f > p || p - f < SAME_SUMMARY) ? 'fail' : 'pass'
}

const TEST_FAIL = [
  /^\s*Tests?\s+(\d+\s+)?failed\b|^\s*(Test Files|Tests)\s+\d+ failed/m, // vitest
  /^Tests:\s+.*\b[1-9]\d* failed/m, // jest
  /^=+ .*\b[1-9]\d* (failed|errors?)\b.* in [\d.]+s/m, // pytest
  /^FAIL\b/m, // go test, jest file lines
  /test result: FAILED/, // cargo
  /^\s*[1-9]\d* failed\b/m, // playwright
  /^FAILED \(/m, // unittest
  /^\s*[1-9]\d* (failing|examples?, [1-9]\d* failures?)/m, // mocha, rspec
  /\b[1-9]\d* examples?, [1-9]\d* failures?/,
  /Command failed with exit code [1-9]|npm ERR! (code ELIFECYCLE|Test failed)|ELIFECYCLE/ // a script runner gave up
]
const TEST_PASS = [
  /^\s*Tests\s+\d+ passed(?! .*failed)/m, // vitest (no failed on the line)
  /^Tests:\s+(?!.*failed).*\d+ passed/m, // jest
  /^=+ (?!.*(failed|error)).*\b\d+ passed\b.* in [\d.]+s/m, // pytest
  /^ok\s+\S+\s+[\d.]+s/m, // go test
  /test result: ok\./, // cargo
  /^\s*\d+ passed \(/m, // playwright
  /^OK( \(|$)/m, // unittest
  /^\s*\d+ passing\b(?![\s\S]*\d+ failing)/m, // mocha
  /\b\d+ examples?, 0 failures/ // rspec
]
const TYPE_FAIL = [/error TS\d+:/, /^Found [1-9]\d* errors?\b/m, /^Found [1-9]\d* errors? in \d+ files?/m, /\b[1-9]\d* errors?, \d+ warnings?/, /svelte-check found [1-9]\d* errors?/, /^error(\[E\d+\])?:/m]
const TYPE_PASS = [/^Success: no issues found/m, /\b0 errors?, \d+ warnings?/, /svelte-check found 0 errors/, /^Found 0 errors/m, /^\s*Finished .* target\(s\) in/m]
const LINT_FAIL = [/✖ [1-9]\d* problems? \([1-9]\d* errors?/, /^Found [1-9]\d* errors?\b/m, /^error(\[\w+\])?:/m, /Code style issues found/, /^[1-9]\d* issues?:/m, /would reformat|Would reformat/, /^\S+:\d+:\d+: [A-Z]+\d+ /m]
const LINT_PASS = [/All checks passed!/, /All matched files use Prettier code style!/, /^\s*0 issues\.?$/m, /^\s*Finished .* target\(s\) in/m, /^Checked \d+ files? in .*\. No fixes applied\./m]
const BUILD_FAIL = [/error during build/i, /Failed to compile/, /compiled with [1-9]\d* errors?/, /^error(\[E\d+\])?:/m, /Build failed/i, /\*\* BUILD FAILED \*\*/, /error TS\d+:/]
const BUILD_PASS = [/✓ built in /, /Compiled successfully/, /compiled successfully/, /^\s*Finished .* target\(s\) in/m, /\*\* BUILD SUCCEEDED \*\*/, /Build succeeded/i]

/** What a runner's own summary says about a kind of check, if anything. */
export function outputVerdict(kind: CheckKind, output: string): Verdict {
  // eslint-disable-next-line no-control-regex
  const text = output.slice(-OUTPUT_TAIL).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  switch (kind) {
    case 'test':
      return verdictFrom(text, TEST_FAIL, TEST_PASS)
    case 'typecheck':
      return verdictFrom(text, TYPE_FAIL, TYPE_PASS)
    case 'lint':
      return verdictFrom(text, LINT_FAIL, LINT_PASS)
    case 'build':
      return verdictFrom(text, BUILD_FAIL, BUILD_PASS)
  }
}

/** One simple command as shown and as the identity of a check: one line, no env or redirections, at most 120 chars. */
function commandText(words: string[]): string {
  const text = words.map((w) => (/[\s"'$`\\]/.test(w) ? `'${w}'` : w)).join(' ')
  return text.length > MAX_COMMAND ? `${text.slice(0, MAX_COMMAND - 1)}…` : text
}

/**
 * The checks one Bash call ran and how each came out. `dir` is the agent's working folder (the hook payload's `cwd`).
 * The exit code belongs to a check when the check ends its pipeline (or pipefail is on) and only `&&` follows that
 * pipeline: a failing link stops an `&&` chain, so 0 means every check in it passed. A non-zero code fails a lone check
 * and, with several, each one whose own summary does not say it passed (the shell does not say which link stopped the
 * chain). A check the code does not belong to (`npm test | tail`, `npm test; echo done`) or a call without a code
 * (Codex) is read from the runner's summary, and is unknown when there is none.
 */
export function checkRunsOf(command: string, result: BashResult, at: number, dir = '/', scripts?: ScriptsLookup): CheckRun[] {
  const segments = splitShell(command)
  const pipefail = /\bpipefail\b/.test(command)
  // Pipelines: runs of segments joined by `|`, each with the operator after it.
  const pipelines: Array<{ segments: Segment[]; op: Op | null }> = []
  let current: Segment[] = []
  for (const segment of segments) {
    current.push(segment)
    if (segment.op !== '|') {
      pipelines.push({ segments: current, op: segment.op })
      current = []
    }
  }
  if (current.length > 0) pipelines.push({ segments: current, op: null })

  const found: Array<{ hit: Hit; command: string; owns: boolean }> = []
  let cwd = dir
  pipelines.forEach((pipeline, p) => {
    const chained = pipeline.op !== '&' && pipelines.slice(p).every((q, k) => k === pipelines.length - p - 1 || q.op === '&&')
    pipeline.segments.forEach((segment, s) => {
      const words = cleanWords(segment.words)
      if (words[0] === 'cd' && words[1]) {
        cwd = joinDir(cwd, words[1])
        return
      }
      const hits = classifyWords(words, { dir: cwd, ...(scripts ? { scripts } : {}), depth: 0, seen: new Set() })
      const owns = chained && (s === pipeline.segments.length - 1 || pipefail)
      for (const h of hits) found.push({ hit: h, command: commandText(peelEnv(words)), owns })
    })
  })
  if (found.length === 0) return []
  const owners = found.filter((f) => f.owns).length
  return found.map(({ hit: h, command: text, owns }): CheckRun => {
    const run = (outcome: CheckOutcome, basis: CheckRun['basis']): CheckRun => ({ kind: h.kind, command: text, outcome, basis, full: h.full, at })
    if (result.interrupted) return run('unknown', 'none')
    const verdict = outputVerdict(h.kind, result.output)
    if (owns && result.exitCode !== null) {
      if (result.exitCode === 0) return run('pass', 'exit')
      return owners > 1 && verdict === 'pass' ? run('pass', 'output') : run('fail', 'exit')
    }
    return verdict ? run(verdict, 'output') : run('unknown', 'none')
  })
}

/** `env A=b cmd` shows as `cmd`. */
function peelEnv(words: string[]): string[] {
  if (words[0] !== 'env') return words
  let i = 1
  while (i < words.length && ((words[i] as string).startsWith('-') || ASSIGNMENT.test(words[i] as string))) i++
  return words.slice(i)
}
