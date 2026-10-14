import { describe, expect, it } from 'vitest'
import {
  checkLatestRelease,
  compareSemver,
  parseRepository,
  parseSemver,
  releasesApiUrl,
  updateFromRelease,
  type FetchLike
} from './update-check'

const semver = (v: string) => {
  const parsed = parseSemver(v)
  if (!parsed) throw new Error(`bad version ${v}`)
  return parsed
}

describe('parseRepository', () => {
  it.each([
    ['github:meloer101/terminal-reborn'],
    ['meloer101/terminal-reborn'],
    ['https://github.com/meloer101/terminal-reborn'],
    ['https://github.com/meloer101/terminal-reborn.git'],
    ['git+https://github.com/meloer101/terminal-reborn.git'],
    [{ type: 'git', url: 'git+https://github.com/meloer101/terminal-reborn.git' }]
  ])('reads %j', (input) => {
    expect(parseRepository(input)).toEqual({ owner: 'meloer101', name: 'terminal-reborn' })
  })

  it.each([[undefined], [null], [42], [''], ['nonsense'], ['gitlab:a/b'], ['https://example.com/a/b'], ['a/b/c'], [{ type: 'git' }]])(
    'rejects %j',
    (input) => {
      expect(parseRepository(input)).toBeNull()
    }
  )

  it('builds the latest-release API url', () => {
    expect(releasesApiUrl({ owner: 'o', name: 'r' })).toBe('https://api.github.com/repos/o/r/releases/latest')
  })
})

describe('semver', () => {
  it('parses tags with and without v, pre-release and build metadata', () => {
    expect(parseSemver('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseSemver('0.10.0-beta.2+abc')).toEqual({ major: 0, minor: 10, patch: 0, prerelease: ['beta', '2'] })
    for (const bad of ['1.2', 'latest', '1.2.3.4', 'v1.x.0', '']) expect(parseSemver(bad)).toBeNull()
  })

  it('orders numerically, not lexically', () => {
    expect(compareSemver(semver('0.10.0'), semver('0.9.9'))).toBeGreaterThan(0)
    expect(compareSemver(semver('1.0.0'), semver('1.0.0'))).toBe(0)
    expect(compareSemver(semver('0.1.0'), semver('0.1.1'))).toBeLessThan(0)
  })

  it('ranks a pre-release below its release and orders identifiers', () => {
    expect(compareSemver(semver('1.0.0-rc.1'), semver('1.0.0'))).toBeLessThan(0)
    expect(compareSemver(semver('1.0.0-rc.2'), semver('1.0.0-rc.10'))).toBeLessThan(0)
    expect(compareSemver(semver('1.0.0-alpha'), semver('1.0.0-alpha.1'))).toBeLessThan(0)
    expect(compareSemver(semver('1.0.0-1'), semver('1.0.0-alpha'))).toBeLessThan(0)
  })
})

describe('updateFromRelease', () => {
  const release = { tag_name: 'v0.2.0', html_url: 'https://github.com/o/r/releases/tag/v0.2.0', body: '  - faster\n' }

  it('reports a newer release', () => {
    expect(updateFromRelease(release, '0.1.0')).toEqual({
      version: '0.2.0',
      url: 'https://github.com/o/r/releases/tag/v0.2.0',
      notes: '- faster'
    })
  })

  it('omits empty notes', () => {
    expect(updateFromRelease({ ...release, body: '  ' }, '0.1.0')).toEqual({ version: '0.2.0', url: release.html_url })
  })

  it('returns null for the same or an older release', () => {
    expect(updateFromRelease(release, '0.2.0')).toBeNull()
    expect(updateFromRelease(release, '0.3.0')).toBeNull()
  })

  it('ignores drafts, pre-releases, bad tags, foreign urls and junk', () => {
    expect(updateFromRelease({ ...release, draft: true }, '0.1.0')).toBeNull()
    expect(updateFromRelease({ ...release, prerelease: true }, '0.1.0')).toBeNull()
    expect(updateFromRelease({ ...release, tag_name: 'nightly' }, '0.1.0')).toBeNull()
    expect(updateFromRelease({ ...release, html_url: 'https://evil.example/x' }, '0.1.0')).toBeNull()
    expect(updateFromRelease(release, 'dev')).toBeNull()
    for (const junk of [null, 'x', 7, [], {}]) expect(updateFromRelease(junk, '0.1.0')).toBeNull()
  })

  it('caps very long notes', () => {
    expect(updateFromRelease({ ...release, body: 'x'.repeat(10_000) }, '0.1.0')?.notes).toHaveLength(4000)
  })
})

describe('checkLatestRelease (injected fetch, no network)', () => {
  const repo = { owner: 'o', name: 'r' }
  const payload = { tag_name: 'v0.2.0', html_url: 'https://github.com/o/r/releases/tag/v0.2.0' }
  const ok =
    (json: unknown): FetchLike =>
    async () => ({ ok: true, json: async () => json })

  it('requests the latest-release endpoint and returns the update', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push(url, init.headers['Accept'] ?? '')
      return { ok: true, json: async () => payload }
    }
    expect(await checkLatestRelease(repo, '0.1.0', fetchImpl)).toEqual({ version: '0.2.0', url: payload.html_url })
    expect(seen).toEqual(['https://api.github.com/repos/o/r/releases/latest', 'application/vnd.github+json'])
  })

  it('returns null when up to date, without a repo, or on a non-2xx response', async () => {
    expect(await checkLatestRelease(repo, '0.2.0', ok(payload))).toBeNull()
    expect(await checkLatestRelease(null, '0.1.0', ok(payload))).toBeNull()
    expect(await checkLatestRelease(repo, '0.1.0', async () => ({ ok: false, json: async () => payload }))).toBeNull()
  })

  it('never throws: network errors and bad JSON become null', async () => {
    expect(
      await checkLatestRelease(repo, '0.1.0', async () => {
        throw new Error('offline')
      })
    ).toBeNull()
    expect(
      await checkLatestRelease(repo, '0.1.0', async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('bad json')
        }
      }))
    ).toBeNull()
  })

  it('aborts a request that outlives the timeout', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    expect(await checkLatestRelease(repo, '0.1.0', hang, 20)).toBeNull()
  })
})
