// Validation for confirmation-dialog payloads from the renderer.
import type { ConfirmOptions } from '@shared/lifecycle'

const MAX_TEXT = 500
const MAX_LABEL = 40

function text(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) {
    throw new Error(`invalid confirm ${name}`)
  }
  return value
}

export function parseConfirmOptions(raw: unknown): ConfirmOptions {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid confirm options')
  const o = raw as Record<string, unknown>
  const result: ConfirmOptions = {
    message: text(o.message, MAX_TEXT, 'message'),
    confirmLabel: text(o.confirmLabel, MAX_LABEL, 'label')
  }
  if (o.detail !== undefined) result.detail = text(o.detail, MAX_TEXT, 'detail')
  if (o.cancelLabel !== undefined) result.cancelLabel = text(o.cancelLabel, MAX_LABEL, 'label')
  if (o.destructive !== undefined) {
    if (typeof o.destructive !== 'boolean') throw new Error('invalid confirm options')
    result.destructive = o.destructive
  }
  return result
}
