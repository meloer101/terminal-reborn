import { describe, expect, it } from 'vitest'
import { isTestFile, riskLabel, riskMarkers, riskPhrase, type RiskMarker } from './risk-markers'

/** A modified file's diff: `-` / `+` / ` ` prefixed lines in one hunk. */
function modified(path: string, ...lines: string[]): string {
  return [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`, '@@ -1,9 +1,9 @@', ...lines, ''].join('\n')
}

function deleted(path: string, ...removed: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    'deleted file mode 100644',
    'index 1111111..0000000',
    `--- a/${path}`,
    '+++ /dev/null',
    `@@ -1,${removed.length} +0,0 @@`,
    ...removed.map((l) => `-${l}`),
    ''
  ].join('\n')
}

function created(path: string, ...added: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    'index 0000000..2222222',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${added.length} @@`,
    ...added.map((l) => `+${l}`),
    ''
  ].join('\n')
}

function renamed(from: string, to: string, ...lines: string[]): string {
  return [
    `diff --git a/${from} b/${to}`,
    'similarity index 90%',
    `rename from ${from}`,
    `rename to ${to}`,
    ...(lines.length ? ['index 1111111..2222222 100644', `--- a/${from}`, `+++ b/${to}`, '@@ -1,3 +1,3 @@', ...lines] : []),
    ''
  ].join('\n')
}

function kinds(diff: string): string[] {
  return riskMarkers(diff).map((m) => `${m.kind}:${m.path}:${m.count}`)
}

describe('isTestFile', () => {
  it.each([
    ['src/foo.test.ts', true],
    ['src/foo.spec.tsx', true],
    ['src/foo.test.mjs', true],
    ['src/__tests__/foo.ts', true],
    ['tests/foo.py', true],
    ['test/foo.js', true],
    ['e2e/smoke.ts', true],
    ['spec/models/user_spec.rb', true],
    ['pkg/foo_test.go', true],
    ['app/test_models.py', true],
    ['app/models_test.py', true],
    ['src/foo.ts', false],
    ['src/latest/foo.ts', false],
    ['src/contest.ts', false],
    ['src/testing-utils.ts', false],
    ['docs/test.md', false]
  ])('%s → %s', (path, expected) => {
    expect(isTestFile(path)).toBe(expected)
  })
})

describe('test-deleted', () => {
  it('counts the cases of a deleted test file and marks it whole-file', () => {
    const diff = deleted('src/a.test.ts', "describe('a', () => {", "  it('one', () => {", '  })', "  it('two', () => {", '  })', '})')
    expect(riskMarkers(diff)).toEqual([{ kind: 'test-deleted', path: 'src/a.test.ts', count: 3, wholeFile: true }])
  })

  it('counts a deleted test file with no recognisable case as 1', () => {
    expect(riskMarkers(deleted('tests/helpers.ts', 'export const x = 1'))).toEqual([
      { kind: 'test-deleted', path: 'tests/helpers.ts', count: 1, wholeFile: true }
    ])
  })

  it('does not flag a deleted non-test file', () => {
    expect(riskMarkers(deleted('src/a.ts', "it('looks like a test', () => {"))).toEqual([])
  })

  it('counts removed it / test / describe / it.each lines in a test file', () => {
    const diff = modified(
      'src/a.test.ts',
      " import { it } from 'vitest'",
      "-it('one', () => {",
      '-  expect(1).toBe(1)',
      '-})',
      "-  test('two', async () => {",
      "-  it.each([1, 2])('three %i', (n) => {",
      "-describe('group', () => {"
    )
    expect(riskMarkers(diff)).toEqual([{ kind: 'test-deleted', path: 'src/a.test.ts', count: 4 }])
  })

  it('does not count a test that is moved or re-indented in the same file', () => {
    const diff = modified('src/a.test.ts', "-it('one', () => {", '-  expect(1).toBe(1)', '-})', "+  it('one', () => {", '+    expect(1).toBe(1)', '+  })')
    expect(riskMarkers(diff)).toEqual([])
  })

  it('does not count a test whose body line changed but whose name stayed', () => {
    const diff = modified('src/a.test.ts', "-it('one', () => {", "+it('one', async () => {")
    expect(riskMarkers(diff)).toEqual([])
  })

  it('counts a renamed test as deleted (the old name is gone)', () => {
    const diff = modified('src/a.test.ts', "-it('one', () => {", "+it('uno', () => {")
    expect(riskMarkers(diff)).toEqual([{ kind: 'test-deleted', path: 'src/a.test.ts', count: 1 }])
  })

  it('subtracts per occurrence: two removed, one re-added', () => {
    const diff = modified('src/a.test.ts', "-it('same', () => {", "-it('same', () => {", "+it('same', () => {")
    expect(riskMarkers(diff)).toEqual([{ kind: 'test-deleted', path: 'src/a.test.ts', count: 1 }])
  })

  it('reads python and go cases', () => {
    expect(riskMarkers(modified('tests/test_a.py', '-def test_one():', '-    assert 1', '-async def test_two():', '-def helper():'))).toEqual([
      { kind: 'test-deleted', path: 'tests/test_a.py', count: 2 }
    ])
    expect(riskMarkers(modified('pkg/a_test.go', '-func TestOne(t *testing.T) {', '-func helper() {', '-func TestTwo(t *testing.T) {'))).toEqual([
      { kind: 'test-deleted', path: 'pkg/a_test.go', count: 2 }
    ])
  })

  it('ignores removed lines that merely look like tests outside test files', () => {
    expect(riskMarkers(modified('src/a.ts', "-it('x', () => {", "-describe('y', () => {"))).toEqual([])
  })

  it('ignores removed lines in a test file that are not case starts', () => {
    expect(riskMarkers(modified('src/a.test.ts', '-  expect(item(1)).toBe(2)', '-const test = 1', '-testing(1)', '-  // it() was here'))).toEqual([])
  })

  it('does not flag a test file that was only renamed', () => {
    expect(riskMarkers(renamed('src/a.test.ts', 'src/b.test.ts'))).toEqual([])
  })

  it('does not flag a renamed test file whose cases are unchanged', () => {
    expect(riskMarkers(renamed('src/a.test.ts', 'src/b.test.ts', " it('one', () => {", "-  expect(1).toBe(1)", '+  expect(2).toBe(2)'))).toEqual([])
  })

  it('flags cases removed while a test file is renamed, under the new path', () => {
    expect(riskMarkers(renamed('src/a.test.ts', 'src/b.test.ts', "-it('one', () => {", " })"))).toEqual([
      { kind: 'test-deleted', path: 'src/b.test.ts', count: 1 }
    ])
  })

  it('does not flag a test file that was added', () => {
    expect(riskMarkers(created('src/a.test.ts', "it('one', () => {", '})'))).toEqual([])
  })
})

describe('test-skipped', () => {
  it.each([
    ["it.skip('x', () => {})"],
    ["describe.skip('x', () => {})"],
    ["test.todo('x')"],
    ["it.only('x', () => {})"],
    ["describe.only('x', () => {})"],
    ["xit('x', () => {})"],
    ["xdescribe('x', () => {})"],
    ["xtest('x', () => {})"],
    ["fit('x', () => {})"],
    ["  test.skip('x', async () => {"],
    ["  this.skip()"],
    ["test.concurrent.skip('x', () => {})"]
  ])('flags %s in a test file', (line) => {
    expect(kinds(modified('src/a.test.ts', `+${line}`))).toEqual(['test-skipped:src/a.test.ts:1'])
  })

  it.each([
    ['@pytest.mark.skip(reason="x")'],
    ['    pytest.skip("later")'],
    ['@unittest.skip("x")'],
    ['    t.Skip("later")'],
    ['    t.SkipNow()'],
    ['@Disabled'],
    ['@Ignore("flaky")']
  ])('flags %s', (line) => {
    expect(kinds(modified('tests/test_a.py', `+${line}`))).toEqual(['test-skipped:tests/test_a.py:1'])
  })

  it('counts every skipped line in a file', () => {
    const diff = modified('src/a.test.ts', "+it.skip('a', () => {})", "+it.skip('b', () => {})", "+it('c', () => {})")
    expect(kinds(diff)).toEqual(['test-skipped:src/a.test.ts:2'])
  })

  it('flags unmistakable skips outside test files too', () => {
    expect(kinds(modified('src/helpers.ts', "+  it.skip('x', () => {})"))).toEqual(['test-skipped:src/helpers.ts:1'])
  })

  it('does not flag a bare .skip( call outside a test file', () => {
    expect(kinds(modified('src/stream.ts', '+  reader.skip(4)', '+  list.only(3)'))).toEqual([])
  })

  it('does not flag skip in a normal string, identifier or comment', () => {
    const diff = modified(
      'src/a.test.ts',
      "+  const label = 'skip this step'",
      "+  expect(skipped).toBe(true)",
      '+  const skipLink = document.querySelector(".skip")',
      '+  // do not use it.skip( here',
      '+  const only = items.filter(isOnly)',
      "+  await user.click(screen.getByText('Skip'))"
    )
    expect(kinds(diff)).toEqual([])
  })

  it('does not flag conditional skips or ML fit()', () => {
    expect(kinds(modified('tests/test_a.py', '+@pytest.mark.skipif(sys.platform == "win32", reason="x")', '+    model.fit(x, y)'))).toEqual([])
    expect(kinds(modified('src/train.ts', '+  model.fit(x, y)'))).toEqual([])
  })

  it('does not flag a skip that was already there and only edited or moved', () => {
    const diff = modified('src/a.test.ts', "-  it.skip('a', () => {})", "+it.skip('a', () => {})")
    expect(kinds(diff)).toEqual([])
  })

  it('does not flag removing a skip', () => {
    expect(kinds(modified('src/a.test.ts', "-it.skip('a', () => {})", "+it('a', () => {})"))).toEqual([])
  })

  it('ignores markdown and snapshot files', () => {
    expect(kinds(modified('docs/testing.md', '+Use `it.skip(` sparingly'))).toEqual([])
  })
})

describe('check-silenced', () => {
  it.each([
    ['npm test || true'],
    ['continue-on-error: true'],
    ['vitest run --passWithNoTests'],
    ['// eslint-disable-next-line no-console'],
    ['/* eslint-disable */'],
    ['// @ts-ignore'],
    ['// @ts-expect-error legacy'],
    ['import x  # noqa'],
    ['x = foo()  # type: ignore'],
    ['git commit --no-verify -m x']
  ])('flags %s', (line) => {
    expect(kinds(modified('src/a.ts', `+${line}`))).toEqual(['check-silenced:src/a.ts:1'])
  })

  it('counts added lines per file', () => {
    expect(kinds(modified('src/a.ts', '+// @ts-ignore', '+x()', '+// @ts-ignore', '+// eslint-disable-line'))).toEqual(['check-silenced:src/a.ts:3'])
  })

  it('is one marker per file with separate paths', () => {
    const diff = modified('src/a.ts', '+// @ts-ignore') + modified('src/b.ts', '+// @ts-ignore')
    expect(kinds(diff)).toEqual(['check-silenced:src/a.ts:1', 'check-silenced:src/b.ts:1'])
  })

  it('does not flag lookalikes', () => {
    const diff = modified('src/a.ts', '+const x = a || trueish', '+const y = a || falsey', '+// continue on error', '+const noqa = 1', '+// ts-ignore is bad')
    expect(kinds(diff)).toEqual([])
  })

  it('does not flag lines that are only removed or unchanged context', () => {
    expect(kinds(modified('src/a.ts', '-// @ts-ignore', ' // eslint-disable-next-line', '+const x = 1'))).toEqual([])
  })

  it('does not flag a marker that an edited line keeps', () => {
    expect(kinds(modified('src/a.ts', '-  foo() // @ts-ignore', '+  bar() // @ts-ignore'))).toEqual(['check-silenced:src/a.ts:1'])
    expect(kinds(modified('src/a.ts', '-  // @ts-ignore', '+    // @ts-ignore'))).toEqual([])
  })

  it('ignores prose and lock files', () => {
    expect(kinds(modified('README.md', '+run `npm test || true` to ignore'))).toEqual([])
    expect(kinds(modified('docs/lint.txt', '+eslint-disable'))).toEqual([])
  })

  it('flags a silencer in a workflow together with the ci-config marker', () => {
    expect(kinds(modified('.github/workflows/ci.yml', '+        continue-on-error: true'))).toEqual([
      'check-silenced:.github/workflows/ci.yml:1',
      'ci-config:.github/workflows/ci.yml:1'
    ])
  })
})

describe('ci-config, dependencies, migration', () => {
  it.each([
    '.github/workflows/ci.yml',
    '.gitlab-ci.yml',
    '.circleci/config.yml',
    'azure-pipelines.yml',
    'Jenkinsfile',
    '.buildkite/pipeline.yml',
    'eslint.config.js',
    'eslint.config.mjs',
    '.eslintrc.json',
    '.eslintrc',
    'jest.config.ts',
    'vitest.config.mts',
    'playwright.config.ts',
    'tsconfig.json',
    'packages/app/tsconfig.node.json'
  ])('ci-config: %s', (path) => {
    expect(riskMarkers(modified(path, '+x'))).toEqual([{ kind: 'ci-config', path, count: 1 }])
  })

  it.each([
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
    'requirements.txt',
    'requirements-dev.txt',
    'Gemfile',
    'site/package.json'
  ])('dependencies: %s', (path) => {
    expect(riskMarkers(modified(path, '+x'))).toEqual([{ kind: 'dependencies', path, count: 1 }])
  })

  it.each([
    'db/migrations/001_init.sql',
    'prisma/migrations/20240101_init/migration.sql',
    'alembic/versions/abc_add_users.py',
    'db/schema.sql',
    'db/seeds/data.sql',
    'app/db/migrate/20240101_create_users.rb',
    'src/migration/1700000-add-col.ts'
  ])('migration: %s', (path) => {
    expect(riskMarkers(modified(path, '+x'))).toEqual([{ kind: 'migration', path, count: 1 }])
  })

  it.each([
    'src/migrate.ts',
    'src/migrations.md.ts',
    'docs/migration-guide.md',
    'src/database/query.sql',
    'src/package.jsonl',
    'src/requirements.ts',
    'src/__tests__/migrations/run.test.ts'
  ])('none: %s', (path) => {
    expect(kinds(modified(path, '+x')).filter((k) => !k.startsWith('test-'))).toEqual([])
  })

  it('flags a deleted workflow and a pure rename of a lock file', () => {
    expect(kinds(deleted('.github/workflows/ci.yml', 'name: ci'))).toEqual(['ci-config:.github/workflows/ci.yml:1'])
    expect(kinds(renamed('package-lock.json', 'lock/package-lock.json'))).toEqual(['dependencies:lock/package-lock.json:1'])
  })

  it('does not look at diff content to decide path kinds', () => {
    expect(riskMarkers(modified('src/a.ts', '+// see .github/workflows/ci.yml', '+import "package.json"'))).toEqual([])
  })
})

describe('diff parsing and order', () => {
  it('returns [] for empty or non-diff text', () => {
    expect(riskMarkers('')).toEqual([])
    expect(riskMarkers('not a diff\n+it.skip(\n')).toEqual([])
  })

  it('orders by kind, then path', () => {
    const diff = [
      modified('package.json', '+x'),
      modified('db/migrations/2.sql', '+x'),
      modified('db/migrations/1.sql', '+x'),
      modified('.github/workflows/ci.yml', '+x'),
      modified('src/z.ts', '+// @ts-ignore'),
      modified('src/b.test.ts', "+it.skip('x', () => {})"),
      modified('src/a.test.ts', "-it('x', () => {"),
      modified('src/a.ts', '+// @ts-ignore')
    ].join('')
    expect(riskMarkers(diff).map((m) => `${m.kind}:${m.path}`)).toEqual([
      'test-deleted:src/a.test.ts',
      'test-skipped:src/b.test.ts',
      'check-silenced:src/a.ts',
      'check-silenced:src/z.ts',
      'ci-config:.github/workflows/ci.yml',
      'migration:db/migrations/1.sql',
      'migration:db/migrations/2.sql',
      'dependencies:package.json'
    ])
  })

  it('keeps hunks of different files apart', () => {
    const diff = modified('src/a.test.ts', "-it('a', () => {") + modified('src/b.ts', "-it('b', () => {")
    expect(kinds(diff)).toEqual(['test-deleted:src/a.test.ts:1'])
  })

  it('handles paths with spaces and CRLF diffs', () => {
    const diff = modified('src/my tests/a.test.ts', "-it('one', () => {").replace(/\n/g, '\r\n')
    expect(kinds(diff)).toEqual(['test-deleted:src/my tests/a.test.ts:1'])
  })

  it('decodes git-quoted unicode paths', () => {
    const diff = [
      'diff --git "a/tests/\\344\\270\\255.test.ts" "b/tests/\\344\\270\\255.test.ts"',
      'deleted file mode 100644',
      '--- "a/tests/\\344\\270\\255.test.ts"',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      "-it('x', () => {",
      ''
    ].join('\n')
    expect(riskMarkers(diff)).toEqual([{ kind: 'test-deleted', path: 'tests/中.test.ts', count: 1, wholeFile: true }])
  })

  it('does not read a line starting with --- or +++ inside a hunk as a header', () => {
    const diff = modified('src/a.test.ts', '--- a/comment', "+++ it.skip('x')", ' ctx')
    expect(kinds(diff)).toEqual(['test-skipped:src/a.test.ts:1'])
  })

  it('reads binary changes by path only', () => {
    const diff = ['diff --git a/bun.lockb b/bun.lockb', 'index 1..2 100644', 'Binary files a/bun.lockb and b/bun.lockb differ', ''].join('\n')
    expect(kinds(diff)).toEqual(['dependencies:bun.lockb:1'])
  })
})

describe('riskLabel and riskPhrase', () => {
  const rows: Array<[RiskMarker, string, string]> = [
    [{ kind: 'test-deleted', path: 'a.test.ts', count: 1 }, '删了 1 个测试', '删了 1 个测试 · a.test.ts'],
    [{ kind: 'test-deleted', path: 'a.test.ts', count: 5 }, '删了 5 个测试', '删了 5 个测试 · a.test.ts'],
    [{ kind: 'test-deleted', path: 'a.test.ts', count: 3, wholeFile: true }, '删了测试文件', '删了测试文件 · a.test.ts'],
    [{ kind: 'test-skipped', path: 'a.test.ts', count: 2 }, '跳过了 2 个测试', '跳过了 2 个测试 · a.test.ts'],
    [{ kind: 'check-silenced', path: 'src/a.ts', count: 4 }, '关掉了 4 处检查', '关掉了 4 处检查 · src/a.ts'],
    [{ kind: 'ci-config', path: '.github/workflows/ci.yml', count: 1 }, '改了 CI 配置', '改了 CI 配置 · .github/workflows/ci.yml'],
    [{ kind: 'ci-config', path: 'eslint.config.js', count: 1 }, '改了检查配置', '改了检查配置 · eslint.config.js'],
    [{ kind: 'ci-config', path: 'tsconfig.json', count: 1 }, '改了检查配置', '改了检查配置 · tsconfig.json'],
    [{ kind: 'migration', path: 'db/migrations/1.sql', count: 1 }, '有数据库迁移', '有数据库迁移 · db/migrations/1.sql'],
    [{ kind: 'dependencies', path: 'package.json', count: 1 }, '改了依赖', '改了依赖 · package.json']
  ]
  it.each(rows)('%j', (marker, phrase, label) => {
    expect(riskPhrase(marker)).toBe(phrase)
    expect(riskLabel(marker)).toBe(label)
  })
})
