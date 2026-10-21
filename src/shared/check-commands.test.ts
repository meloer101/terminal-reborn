import { describe, expect, it } from 'vitest'
import { checkKindsOf, checkRunsOf, kindOfName, outputVerdict, splitShell, type BashResult } from './check-commands'

const ok: BashResult = { exitCode: 0, output: '' }
const failed: BashResult = { exitCode: 1, output: '' }
const brief = (command: string, result: BashResult, dir = '/repo', scripts?: Parameters<typeof checkRunsOf>[4]) =>
  checkRunsOf(command, result, 1, dir, scripts).map((r) => `${r.kind}:${r.outcome}:${r.basis}${r.full ? '' : ':partial'}`)

describe('splitShell', () => {
  it('splits at top-level operators, honoring quotes, escapes and redirections', () => {
    expect(splitShell(`cd "/a b" && npm test 2>&1 | tail -n 20; echo 'x && y'`).map((s) => [s.words.join(' '), s.op])).toEqual([
      ['cd /a b', '&&'],
      ['npm test 2>&1', '|'],
      ['tail -n 20', ';'],
      ['echo x && y', null]
    ])
  })

  it('treats newlines as `;`, drops comments and blank lines', () => {
    expect(splitShell('# run it\nnpm run lint\n\nnpm test\n').map((s) => [s.words.join(' '), s.op])).toEqual([
      ['npm run lint', ';'],
      ['npm test', null]
    ])
  })
})

describe('checkKindsOf', () => {
  it.each([
    ['npm test', ['test']],
    ['npm t', ['test']],
    ['npm run test:unit -- --run', ['test']],
    ['pnpm lint', ['lint']],
    ['pnpm -C packages/web run typecheck', ['typecheck']],
    ['yarn build', ['build']],
    ['yarn workspace web test', ['test']],
    ['bun test', ['test']],
    ['bun run lint', ['lint']],
    ['npx vitest run src/a.test.ts', ['test']],
    ['./node_modules/.bin/vitest', ['test']],
    ['npx tsc --noEmit -p tsconfig.web.json', ['typecheck']],
    ['npx eslint .', ['lint']],
    ['npx prettier --check .', ['lint']],
    ['npx prettier --write .', []],
    ['CI=1 npx jest --ci', ['test']],
    ['pytest -q tests/test_api.py', ['test']],
    ['python -m pytest', ['test']],
    ['uv run pytest -x', ['test']],
    ['poetry run mypy src', ['typecheck']],
    ['ruff check .', ['lint']],
    ['ruff format --check', ['lint']],
    ['ruff format', []],
    ['go test ./...', ['test']],
    ['go vet ./...', ['lint']],
    ['go build ./cmd/server', ['build']],
    ['cargo test --workspace', ['test']],
    ['cargo clippy -- -D warnings', ['lint']],
    ['cargo check', ['typecheck']],
    ['cargo fmt --check', ['lint']],
    ['swift test', ['test']],
    ['xcodebuild -scheme App test', ['test']],
    ['make test', ['test']],
    ['make lint typecheck', ['lint', 'typecheck']],
    ['make', ['build']],
    ['turbo run lint test', ['lint', 'test']],
    ['npx nx run-many -t build,test', ['build', 'test']],
    ['npx playwright test e2e/a.spec.ts', ['test']],
    ['npx playwright install', []],
    ['timeout 120 npm test', ['test']],
    ['env NODE_ENV=test npm test', ['test']],
    ['time npx vite build', ['build']],
    ["bash -lc 'npm run lint && npm test'", ['lint', 'test']],
    ['npm run lint && npm run typecheck && npm test', ['lint', 'typecheck', 'test']],
    ['npm install', []],
    ['npm run dev', []],
    ['git commit -m "fix tests"', []],
    ['grep -rn test src', []],
    ['cat package.json | grep test', []],
    ['tsc --version', []],
    ['rg vitest', []]
  ])('%s', (command, kinds) => {
    expect(checkKindsOf(command)).toEqual(kinds)
  })

  it('expands package scripts through package.json, following cd', () => {
    const scripts = (dir: string) =>
      dir === '/repo/app'
        ? { check: 'npm run typecheck && npm run lint && vitest run', typecheck: 'tsc -b', lint: 'eslint .', verify: 'node scripts/verify.js' }
        : undefined
    expect(checkKindsOf('cd app && npm run check', '/repo', scripts)).toEqual(['typecheck', 'lint', 'test'])
    // A script that runs no check falls back to its name, which says nothing here.
    expect(checkKindsOf('npm run verify', '/repo/app', scripts)).toEqual([])
    // A script that calls itself does not loop.
    expect(checkKindsOf('npm run a', '/', () => ({ a: 'npm run a' }))).toEqual([])
  })

  it('names', () => {
    expect(['test:e2e', 'lint:css', 'typecheck', 'type-check', 'check:types', 'build:web', 'format:check', 'dev', 'start', 'check'].map(kindOfName)).toEqual([
      'test',
      'lint',
      'typecheck',
      'typecheck',
      'typecheck',
      'build',
      'lint',
      null,
      null,
      null
    ])
  })
})

describe('checkRunsOf', () => {
  it('takes the outcome from the exit code when the check ends the command', () => {
    expect(brief('npm test', ok)).toEqual(['test:pass:exit'])
    expect(brief('cd web && npm test', failed)).toEqual(['test:fail:exit'])
  })

  it('passes a whole `&&` chain on 0 and fails it on non-zero unless a runner summary says it passed', () => {
    expect(brief('npm run lint && npm test', ok)).toEqual(['lint:pass:exit', 'test:pass:exit'])
    expect(brief('npm run lint && npm test', failed)).toEqual(['lint:fail:exit', 'test:fail:exit'])
    expect(brief('npm test && npm run lint', { exitCode: 1, output: ' Test Files  3 passed (3)\n      Tests  12 passed (12)\n\n✖ 2 problems (2 errors, 0 warnings)\n' })).toEqual([
      'test:pass:output',
      'lint:fail:exit'
    ])
  })

  it('reads the output when a pipe or a later command owns the exit code', () => {
    const vitestFail = ' Test Files  1 failed | 2 passed (3)\n      Tests  1 failed | 11 passed (12)\n'
    expect(brief('npm test 2>&1 | tail -n 20', { exitCode: 0, output: vitestFail })).toEqual(['test:fail:output'])
    expect(brief('npm test 2>&1 | tail -n 20', ok)).toEqual(['test:unknown:none'])
    expect(brief('set -o pipefail; npm test | tail', failed)).toEqual(['test:fail:exit'])
    expect(brief('npm test; echo done', { exitCode: 0, output: '      Tests  12 passed (12)\ndone\n' })).toEqual(['test:pass:output'])
    expect(brief('npm test || true', ok)).toEqual(['test:unknown:none'])
    expect(brief('npm test &', ok)).toEqual(['test:unknown:none'])
  })

  it('has no exit code for Codex: the summary decides, else unknown', () => {
    expect(brief('pytest', { exitCode: null, output: '===== 2 failed, 10 passed in 0.52s =====\n' })).toEqual(['test:fail:output'])
    expect(brief('pytest', { exitCode: null, output: '===== 12 passed in 0.52s =====\n' })).toEqual(['test:pass:output'])
    expect(brief('./scripts/check.sh && npx tsc --noEmit', { exitCode: null, output: '' })).toEqual(['typecheck:unknown:none'])
  })

  it('leaves an interrupted run unknown', () => {
    expect(brief('npm test', { exitCode: 0, output: '', interrupted: true })).toEqual(['test:unknown:none'])
  })

  it('marks filtered and one-file runs partial', () => {
    expect(brief('npx vitest run src/a.test.ts', ok)).toEqual(['test:pass:exit:partial'])
    expect(brief('npx vitest run -t "login"', ok)).toEqual(['test:pass:exit:partial'])
    expect(brief('npx vitest run --reporter dot', ok)).toEqual(['test:pass:exit'])
    expect(brief('npm test -- src/a', ok)).toEqual(['test:pass:exit:partial'])
    expect(brief('npx eslint src/a.ts', ok)).toEqual(['lint:pass:exit:partial'])
    expect(brief('npx tsc -p tsconfig.web.json', ok)).toEqual(['typecheck:pass:exit'])
  })

  it('shows the command without env or redirections, one line, and caps its length', () => {
    const [run] = checkRunsOf('CI=1 npm test 2>&1', ok, 1)
    expect(run?.command).toBe('npm test')
    const [long] = checkRunsOf(`npx vitest run ${'x/'.repeat(100)}a.test.ts`, ok, 1)
    expect(long?.command.length).toBe(120)
  })
})

describe('outputVerdict', () => {
  it.each([
    ['test', ' Test Files  1 failed | 2 passed (3)\n      Tests  1 failed | 11 passed (12)', 'fail'],
    ['test', ' Test Files  3 passed (3)\n      Tests  12 passed (12)', 'pass'],
    ['test', 'Tests:       2 failed, 30 passed, 32 total', 'fail'],
    ['test', 'Tests:       32 passed, 32 total', 'pass'],
    ['test', '========= 1 failed, 3 passed in 0.12s =========', 'fail'],
    ['test', '========= 4 passed in 0.12s =========', 'pass'],
    ['test', '--- FAIL: TestLogin (0.00s)\nFAIL\nFAIL\texample.com/api\t0.01s', 'fail'],
    ['test', 'ok  \texample.com/api\t0.011s', 'pass'],
    ['test', 'test result: FAILED. 3 passed; 1 failed', 'fail'],
    ['test', 'test result: ok. 4 passed; 0 failed', 'pass'],
    ['test', '  2 failed\n    [chromium] › a.spec.ts:3:1 › login\n  10 passed (12.3s)', 'fail'],
    ['test', '  12 passed (8.1s)', 'pass'],
    ['typecheck', "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.", 'fail'],
    ['typecheck', 'Found 2 errors in 1 file (checked 10 source files)', 'fail'],
    ['typecheck', 'Success: no issues found in 10 source files', 'pass'],
    ['typecheck', '0 errors, 0 warnings, 0 informations', 'pass'],
    ['lint', '✖ 3 problems (2 errors, 1 warning)', 'fail'],
    ['lint', 'All checks passed!', 'pass'],
    ['lint', 'Found 4 errors.\n[*] 3 fixable with the `--fix` option.', 'fail'],
    ['lint', '[warn] Code style issues found in 2 files. Run Prettier with --write to fix.', 'fail'],
    ['build', '✓ built in 1.32s', 'pass'],
    ['build', 'error during build:\nRollupError: Could not resolve "./x"', 'fail'],
    ['test', 'some unrelated output', undefined],
    ['lint', '\u001b[32m✓\u001b[0m All checks passed!', 'pass']
  ] as const)('%s: %s', (kind, output, verdict) => {
    expect(outputVerdict(kind, output)).toBe(verdict)
  })

  it('lets the later summary win when the output has a rerun in it', () => {
    const rerun = `      Tests  1 failed | 11 passed (12)\n${' ✓ src/a.test.ts (3 tests) 4ms\n'.repeat(80)}      Tests  12 passed (12)\n`
    expect(outputVerdict('test', rerun)).toBe('pass')
  })
})
