import { describe, expect, it } from 'vitest'
import { approvalDetail, approvalInput, MAX_APPROVALS, MAX_SCRIPT_CHARS, parseRepoSettings, sanitizeRepoScriptsStore, withApproval } from './repo-scripts'

describe('parseRepoSettings', () => {
  it('reads setup, run and archive from [scripts]', () => {
    const parsed = parseRepoSettings(`
# committed with the repository
[scripts]
setup = "npm ci"
run = "npm run dev -- --port $TR_PORT"
archive = 'docker compose down'
`)
    expect(parsed).toEqual({
      scripts: { setup: 'npm ci', run: 'npm run dev -- --port $TR_PORT', archive: 'docker compose down' },
      problems: []
    })
  })

  it('joins an array of commands with newlines and keeps multi-line strings', () => {
    const parsed = parseRepoSettings(`[scripts]
setup = ["npm ci", "cp .env.example .env"]
run = """
npm run build
npm start
"""`)
    expect(parsed.scripts.setup).toBe('npm ci\ncp .env.example .env')
    expect(parsed.scripts.run).toBe('npm run build\nnpm start')
  })

  it('ignores unknown keys and tables, and blank scripts', () => {
    const parsed = parseRepoSettings(`
version = 3
released = 1979-05-27T07:32:00Z
[scripts]
setup = "  "
lint = "eslint ."
run = "make dev"
[scripts.env]
FOO = 1
[other]
x = [1, 2]
`)
    expect(parsed).toEqual({ scripts: { run: 'make dev' }, problems: [] })
  })

  it('has no scripts without a [scripts] table or for an empty file', () => {
    expect(parseRepoSettings('')).toEqual({ scripts: {}, problems: [] })
    expect(parseRepoSettings('title = "x"')).toEqual({ scripts: {}, problems: [] })
  })

  it('reports a TOML syntax error with its line and runs nothing', () => {
    const parsed = parseRepoSettings('[scripts]\nsetup = "npm ci\n')
    expect(parsed.scripts).toEqual({})
    expect(parsed.problems).toHaveLength(1)
    expect(parsed.problems[0]).toMatch(/^\.tr\/settings\.toml 第 2 行格式不对/)
  })

  it('drops scripts of the wrong type or size and keeps the rest', () => {
    const parsed = parseRepoSettings(`[scripts]
setup = 42
run = ["ok", 1]
archive = "${'x'.repeat(MAX_SCRIPT_CHARS + 1)}"
`)
    expect(parsed.scripts).toEqual({})
    expect(parsed.problems).toEqual([
      'scripts.setup 应该是字符串或字符串数组',
      'scripts.run 应该是字符串或字符串数组',
      `scripts.archive 太长（最多 ${MAX_SCRIPT_CHARS} 个字符）`
    ])
    expect(parseRepoSettings('scripts = "npm ci"').problems).toEqual(['scripts 应该是一个表（[scripts]）'])
    expect(parseRepoSettings('[scripts]\nsetup = "a\\u0000b"').problems).toEqual(['scripts.setup 含有不能用的字符'])
  })
})

describe('approvals', () => {
  it('cover every script in a fixed order, and nothing else', () => {
    const a = approvalInput({ setup: 'npm ci', run: 'npm run dev' })
    expect(approvalInput({ run: 'npm run dev', setup: 'npm ci' })).toBe(a)
    expect(approvalInput({ setup: 'npm ci', run: 'npm run dev', archive: 'true' })).not.toBe(a)
    expect(approvalInput({ setup: 'npm ci', run: 'npm run dev ' })).not.toBe(a)
    // A script cannot pass for another one.
    expect(approvalInput({ run: 'npm ci' })).not.toBe(approvalInput({ setup: 'npm ci' }))
  })

  it('show every command the approval lets run', () => {
    const detail = approvalDetail({ setup: 'npm ci', run: 'npm run dev', archive: 'make clean' })
    expect(detail).toContain('setup：\nnpm ci')
    expect(detail).toContain('run：\nnpm run dev')
    expect(detail).toContain('archive（归档时）：\nmake clean')
    expect(detail).toContain('.tr/settings.toml')
    expect(approvalDetail({ setup: 'x'.repeat(2000) })).toContain(`${'x'.repeat(600)}…`)
  })
})

describe('withApproval', () => {
  it('puts the newest first and remembers a bounded number', () => {
    const h = (n: number) => n.toString(16).padStart(64, '0')
    expect(withApproval(undefined, h(1))).toEqual([h(1)])
    expect(withApproval([h(1), h(2)], h(2))).toEqual([h(2), h(1)])
    let list: string[] = []
    for (let n = 0; n < MAX_APPROVALS + 5; n++) list = withApproval(list, h(n))
    expect(list).toHaveLength(MAX_APPROVALS)
    expect(list[0]).toBe(h(MAX_APPROVALS + 4))
  })
})

describe('sanitizeRepoScriptsStore', () => {
  it('keeps valid approvals and port blocks, drops the rest', () => {
    const hash = 'a'.repeat(64)
    expect(
      sanitizeRepoScriptsStore({
        approvals: { '/r/.git': [hash, 'nope', hash], relative: [hash], '/bad': ['nope'], '/str': hash },
        ports: { '/w/a': 0, '/w/b': 0, '/w/c': 2, '/w/d': -1, '/w/e': 1.5, x: 3 }
      })
    ).toEqual({ version: 1, approvals: { '/r/.git': [hash] }, ports: { '/w/a': 0, '/w/c': 2 } })
    expect(sanitizeRepoScriptsStore(null)).toEqual({ version: 1, approvals: {}, ports: {} })
    expect(sanitizeRepoScriptsStore([1])).toEqual({ version: 1, approvals: {}, ports: {} })
  })
})
