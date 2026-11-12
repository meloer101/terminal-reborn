// Disk side of settings.json (phase 2a · A10), free of Electron so failures can be injected in tests:
//  - loading backs a corrupt file up (settings.json.bad-<ts>) before falling back to defaults, so the next
//    write does not silently destroy what the user had;
//  - writing is a serialized write-then-rename chain in which one failure never blocks later writes.
import { readFileSync, renameSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { sanitizeSettings, type AppSettings } from '@shared/settings'

export interface SettingsFs {
  readFileSync(path: string): string
  renameSync(from: string, to: string): void
  writeFile(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export const nodeSettingsFs: SettingsFs = {
  readFileSync: (path) => readFileSync(path, 'utf8'),
  renameSync,
  writeFile: (path, data) => writeFile(path, data),
  rename
}

type Log = (message: string, error?: unknown) => void
const defaultLog: Log = (message, error) => console.error(`[settings] ${message}`, error ?? '')

export interface LoadedSettings {
  settings: AppSettings
  /** Where a corrupt file was moved to, when it was. */
  backupPath?: string
}

/** macOS 26 or later (Liquid Glass); the same test as `nativeGlass` in appearance.ts, which imports this module's user. */
const systemHasLiquidGlass = (): boolean =>
  process.platform === 'darwin' && typeof process.getSystemVersion === 'function' && Number(process.getSystemVersion().split('.')[0]) >= 26

/**
 * Before PRD v1.174 a saved 'liquid' showed as 磨砂玻璃 before macOS 26, and the opacity slider wrote
 * `shellOpacity.frosted`; naming it 'frosted' lets the migration in sanitizeSettings carry that value over.
 */
export function withLegacyMaterialShown(raw: Record<string, unknown>, liquidGlass: boolean): Record<string, unknown> {
  const appearance = raw.appearance
  if (liquidGlass || typeof appearance !== 'object' || appearance === null) return raw
  const a = appearance as Record<string, unknown>
  return a.windowMaterial === 'liquid' ? { ...raw, appearance: { ...a, windowMaterial: 'frosted' } } : raw
}

export function loadSettingsFile(
  path: string,
  fs: SettingsFs = nodeSettingsFs,
  now: () => number = Date.now,
  log: Log = defaultLog,
  liquidGlass: boolean = systemHasLiquidGlass()
): LoadedSettings {
  let text: string
  try {
    text = fs.readFileSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`could not read ${path}; using defaults`, error)
    return { settings: sanitizeSettings(null) }
  }
  let raw: unknown
  let valid = false
  try {
    raw = JSON.parse(text)
    valid = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
  } catch {
    // Falls through to the backup below.
  }
  if (valid) return { settings: sanitizeSettings(withLegacyMaterialShown(raw as Record<string, unknown>, liquidGlass)) }
  const backupPath = `${path}.bad-${now()}`
  try {
    fs.renameSync(path, backupPath)
    log(`${path} is not valid settings JSON; moved it to ${backupPath} and using defaults`)
    return { settings: sanitizeSettings(null), backupPath }
  } catch (error) {
    log(`${path} is not valid settings JSON and could not be backed up; using defaults`, error)
    return { settings: sanitizeSettings(null) }
  }
}

export class SettingsWriter {
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly onError: (error: Error) => void,
    private readonly fs: SettingsFs = nodeSettingsFs,
    private readonly log: Log = defaultLog
  ) {}

  /** Queues a write. Resolves once it settled; never rejects — failures go to `onError` and the log. */
  write(settings: AppSettings): Promise<void> {
    const run = async (): Promise<void> => {
      const tmp = `${this.path}.tmp`
      try {
        await this.fs.writeFile(tmp, JSON.stringify(settings, null, 2))
        await this.fs.rename(tmp, this.path)
      } catch (error) {
        this.log(`could not save ${this.path}`, error)
        this.onError(error instanceof Error ? error : new Error(String(error)))
      }
    }
    // `run` handles its own errors, so the chain is never left rejected.
    this.chain = this.chain.then(run)
    return this.chain
  }
}
