// Pure logic for the GitHub release update check: repository parsing, semver, response handling.
// No Electron imports and no ambient network access (fetch is injected), so it is unit-testable.
import type { UpdateInfo } from '@shared/ipc'

export interface Repo {
  owner: string
  name: string
}

export interface Semver {
  major: number
  minor: number
  patch: number
  /** Dot-separated pre-release identifiers; empty for a normal release. */
  prerelease: string[]
}

const NAME = '[A-Za-z0-9_.-]+'
const SHORTHAND = new RegExp(`^(?:github:)?(${NAME})/(${NAME})$`)
const URL_FORM = new RegExp(`^(?:git\\+)?https://github\\.com/(${NAME})/(${NAME}?)(?:\\.git)?/?$`)

/** `package.json` `repository`: "github:o/r", "o/r", a GitHub URL, or `{ type, url }`. */
export function parseRepository(value: unknown): Repo | null {
  const text = typeof value === 'string' ? value : isRecord(value) && typeof value.url === 'string' ? value.url : null
  if (text === null) return null
  const trimmed = text.trim()
  const match = URL_FORM.exec(trimmed) ?? SHORTHAND.exec(trimmed.replace(/\.git$/, ''))
  if (!match?.[1] || !match[2]) return null
  return { owner: match[1], name: match[2] }
}

export function releasesApiUrl(repo: Repo): string {
  return `https://api.github.com/repos/${repo.owner}/${repo.name}/releases/latest`
}

export function parseSemver(value: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!match) return null
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number)
  if (major === undefined || minor === undefined || patch === undefined) return null
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  return { major, minor, patch, prerelease: match[4] ? match[4].split('.') : [] }
}

function comparePrerelease(a: string[], b: string[]): number {
  // A version without a pre-release outranks the same version with one.
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : a.length === 0 ? 1 : -1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/** Negative when a < b, 0 when equal, positive when a > b. */
export function compareSemver(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePrerelease(a.prerelease, b.prerelease)
}

const MAX_NOTES = 4000

/**
 * The `UpdateInfo` for a GitHub "latest release" payload if it is newer than `currentVersion`.
 * Drafts, pre-releases, malformed tags and release pages outside github.com are ignored.
 */
export function updateFromRelease(release: unknown, currentVersion: string): UpdateInfo | null {
  if (!isRecord(release) || release.draft === true || release.prerelease === true) return null
  const { tag_name: tag, html_url: url, body } = release
  if (typeof tag !== 'string' || typeof url !== 'string' || !url.startsWith('https://github.com/')) return null
  const latest = parseSemver(tag)
  const current = parseSemver(currentVersion)
  if (!latest || !current || compareSemver(latest, current) <= 0) return null
  const version = tag.trim().replace(/^v/, '')
  const notes = typeof body === 'string' && body.trim() ? body.trim().slice(0, MAX_NOTES) : undefined
  return notes === undefined ? { version, url } : { version, url, notes }
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export const REQUEST_TIMEOUT_MS = 5000

/** Asks GitHub for the latest release; resolves null on any failure (offline, rate limit, 404, bad JSON). */
export async function checkLatestRelease(
  repo: Repo | null,
  currentVersion: string,
  fetchImpl: FetchLike,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<UpdateInfo | null> {
  if (!repo) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(releasesApiUrl(repo), {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wavi-update-check' },
      signal: controller.signal
    })
    if (!response.ok) return null
    return updateFromRelease(await response.json(), currentVersion)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
