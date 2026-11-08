// A session's model, effort and permission as the phone shows and changes them (PRD F22 v1.144, Figma 64B–64F): only
// for this session, never the agent's own defaults. GUI sessions map their composer pickers (gui-chat.ts); terminal
// sessions are driven by typing into the agent's TUI (terminal-settings.ts). Pure; session-settings.test.ts.
import type { GuiConfigOption } from './gui-chat'

export type SettingKind = 'model' | 'effort' | 'permission'

export interface SettingValue {
  value: string
  label: string
}

export interface SessionSetting {
  kind: SettingKind
  current: string
  values: SettingValue[]
}

export interface SessionSettings {
  /** In the order the phone lists them: model, effort, permission. */
  items: SessionSetting[]
  /** Nothing can change right now: a terminal session's agent is mid-turn (64E). */
  locked?: 'running'
  /** Shown, never changed: this agent's terminal has no way to change them for one session only (64F). */
  readOnly?: true
}

const KINDS: readonly SettingKind[] = ['model', 'effort', 'permission']
const MAX_VALUES = 40
/** The plan switch shows on the permission page as one more choice (64C). */
export const PLAN_VALUE = 'plan'

const record = (raw: unknown): Record<string, unknown> | null => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null)
const controls = (s: string): boolean => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
const text = (raw: unknown, max: number): string | null => (typeof raw === 'string' && raw.length > 0 && raw.length <= max && !controls(raw) ? raw : null)

export function isSettingKind(raw: unknown): raw is SettingKind {
  return KINDS.includes(raw as SettingKind)
}

/** A setting value from the phone or the window: a short single line. */
export function settingValue(raw: unknown): string | null {
  return text(raw, 100)
}

/** The window's settings for one session (IPC), validated like everything main receives; null when anything is off. */
export function parseSessionSettings(raw: unknown): SessionSettings | null {
  const v = record(raw)
  if (!v || !Array.isArray(v.items) || v.items.length > KINDS.length) return null
  const items: SessionSetting[] = []
  for (const it of v.items) {
    const r = record(it)
    const current = text(r?.current, 100)
    if (!r || !isSettingKind(r.kind) || current === null || !Array.isArray(r.values) || r.values.length > MAX_VALUES) return null
    const values: SettingValue[] = []
    for (const x of r.values) {
      const o = record(x)
      const value = text(o?.value, 100)
      const label = text(o?.label, 100)
      if (value === null || label === null) return null
      values.push({ value, label })
    }
    items.push({ kind: r.kind, current, values })
  }
  const out: SessionSettings = { items }
  if (v.locked === 'running') out.locked = 'running'
  else if (v.locked !== undefined) return null
  if (v.readOnly === true) out.readOnly = true
  else if (v.readOnly !== undefined) return null
  return out
}

/** A picker the phone can show: a current value, and no more choices than its list takes (an ACP model list can be long). */
const byCategory = (config: readonly GuiConfigOption[], category: GuiConfigOption['category']): GuiConfigOption | undefined => {
  const option = config.find((o) => o.category === category)
  if (!option || !option.current || option.values.length === 0) return undefined
  return { ...option, values: option.values.filter((v) => v.value && v.label).slice(0, MAX_VALUES).map((v) => ({ value: v.value.slice(0, 100), label: v.label.slice(0, 100) })) }
}

/** A GUI session's pickers as the phone's three rows (absent ones left out); undefined when it has none of them. */
export function guiSettings(config: readonly GuiConfigOption[]): SessionSettings | undefined {
  const items: SessionSetting[] = []
  const model = byCategory(config, 'model')
  if (model) items.push({ kind: 'model', current: model.current, values: model.values })
  const effort = byCategory(config, 'thought_level')
  if (effort) items.push({ kind: 'effort', current: effort.current, values: effort.values })
  const permission = byCategory(config, 'permission')
  if (permission) {
    const plan = byCategory(config, 'plan')
    const values = [...permission.values]
    // 计划 before 自动 (64C), at the end when there is no 自动.
    const auto = values.findIndex((x) => x.value === 'auto')
    if (plan) values.splice(auto < 0 ? values.length : auto, 0, { value: PLAN_VALUE, label: '计划' })
    items.push({ kind: 'permission', current: plan?.current === 'on' ? PLAN_VALUE : permission.current, values })
  }
  return items.length > 0 ? { items } : undefined
}

/** The picker changes (option id → value) that set `kind` to `value` in a GUI session; null when it cannot be set. */
export function guiSettingChanges(config: readonly GuiConfigOption[], kind: SettingKind, value: string): { option: string; value: string }[] | null {
  const pick = (option: GuiConfigOption | undefined, v: string) => (option && option.values.some((x) => x.value === v) ? [{ option: option.id, value: v }] : null)
  if (kind === 'model') return pick(byCategory(config, 'model'), value)
  if (kind === 'effort') return pick(byCategory(config, 'thought_level'), value)
  const permission = byCategory(config, 'permission')
  const plan = byCategory(config, 'plan')
  if (value === PLAN_VALUE) return plan ? [{ option: plan.id, value: 'on' }] : null
  const level = pick(permission, value)
  if (!level) return null
  return plan?.current === 'on' ? [{ option: plan.id, value: 'off' }, ...level] : level
}
