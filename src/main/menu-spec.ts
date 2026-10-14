// Validation for native menu payloads from the renderer.
import type { MenuEntry } from '@shared/ipc'

const MAX_ENTRIES = 64
const MAX_DEPTH = 3
const MAX_LABEL = 200
const ID = /^[A-Za-z0-9._:-]{1,256}$/
const ACCELERATOR = /^[A-Za-z0-9+,.]{1,32}$/

function parseLabel(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LABEL) throw new Error('invalid menu label')
  return value
}

export function parseMenuEntries(raw: unknown, depth = 0): MenuEntry[] {
  if (!Array.isArray(raw) || raw.length > MAX_ENTRIES || depth >= MAX_DEPTH) throw new Error('invalid menu')
  return raw.map((value: unknown): MenuEntry => {
    if (typeof value !== 'object' || value === null) throw new Error('invalid menu entry')
    const o = value as Record<string, unknown>
    switch (o.type) {
      case 'separator':
        return { type: 'separator' }
      case 'submenu':
        return { type: 'submenu', label: parseLabel(o.label), items: parseMenuEntries(o.items, depth + 1) }
      case 'item': {
        if (typeof o.id !== 'string' || !ID.test(o.id)) throw new Error('invalid menu id')
        if (o.enabled !== undefined && typeof o.enabled !== 'boolean') throw new Error('invalid menu entry')
        if (o.accelerator !== undefined && (typeof o.accelerator !== 'string' || !ACCELERATOR.test(o.accelerator))) {
          throw new Error('invalid menu accelerator')
        }
        return {
          type: 'item',
          id: o.id,
          label: parseLabel(o.label),
          ...(o.enabled === false ? { enabled: false } : {}),
          ...(typeof o.accelerator === 'string' ? { accelerator: o.accelerator } : {})
        }
      }
      default:
        throw new Error('invalid menu entry')
    }
  })
}
