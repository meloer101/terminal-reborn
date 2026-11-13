// The simulator the iOS 模拟器 view showed last, kept in `<userData>/simulator.json` so the view comes back to it
// (PRD F17). Atomic writes; no Electron imports, so it is unit-tested.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isUdid } from '@shared/simulator'

export function sanitizeLastUdid(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const { lastUdid } = value as Record<string, unknown>
  return isUdid(lastUdid) ? lastUdid : null
}

export class RememberedDevice {
  private udid: string | null | undefined

  constructor(private readonly path: string) {}

  get(): string | null {
    if (this.udid === undefined) {
      let value: unknown = null
      try {
        value = JSON.parse(readFileSync(this.path, 'utf8'))
      } catch {
        // Missing or corrupt: nothing remembered.
      }
      this.udid = sanitizeLastUdid(value)
    }
    return this.udid
  }

  set(udid: string): void {
    if (this.get() === udid) return
    this.udid = udid
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify({ lastUdid: udid }))
      renameSync(tmp, this.path)
    } catch (error) {
      console.error('[simulator] could not save simulator.json', error)
    }
  }
}
