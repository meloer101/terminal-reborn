// The built-in browser's URL (and mobile toggle) per worktree, kept in `<userData>/browser.json` so a session's
// page comes back after a restart (PRD F17). Debounced atomic writes; no Electron imports, so it is unit-tested.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { isAllowedUrl, MAX_URL_LENGTH } from '@shared/browser'

export interface RememberedPage {
  url: string
  mobile: boolean
}

/** Oldest entries are dropped beyond this many worktrees. */
export const MAX_REMEMBERED = 200
const SAVE_DEBOUNCE_MS = 500

/** Keeps only well-formed entries (absolute worktree → http(s) URL), newest last, at most MAX_REMEMBERED. */
export function sanitizeRemembered(value: unknown): Map<string, RememberedPage> {
  const result = new Map<string, RememberedPage>()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return result
  for (const [worktree, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isAbsolute(worktree) || typeof raw !== 'object' || raw === null) continue
    const { url, mobile } = raw as Record<string, unknown>
    if (typeof url !== 'string' || url.length > MAX_URL_LENGTH || !isAllowedUrl(url)) continue
    result.set(worktree, { url, mobile: mobile === true })
  }
  while (result.size > MAX_REMEMBERED) result.delete(result.keys().next().value as string)
  return result
}

export class RememberedPages {
  private pages: Map<string, RememberedPage> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {}

  get(worktree: string): RememberedPage | undefined {
    return this.load().get(worktree)
  }

  set(worktree: string, page: RememberedPage): void {
    const pages = this.load()
    const current = pages.get(worktree)
    if (current?.url === page.url && current.mobile === page.mobile) return
    // Re-insert so the map stays in least-recently-changed order.
    pages.delete(worktree)
    pages.set(worktree, page)
    while (pages.size > MAX_REMEMBERED) pages.delete(pages.keys().next().value as string)
    this.timer ??= setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.pages) return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.pages)))
      renameSync(tmp, this.path)
    } catch (error) {
      console.error('[browser] could not save browser.json', error)
    }
  }

  private load(): Map<string, RememberedPage> {
    if (this.pages) return this.pages
    let value: unknown = null
    try {
      value = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      // Missing or corrupt: start empty.
    }
    this.pages = sanitizeRemembered(value)
    return this.pages
  }
}
