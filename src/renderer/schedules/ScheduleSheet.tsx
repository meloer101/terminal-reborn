// 新建 / 编辑定时任务 (PRD F24, Figma 67D′–67G′): the 新建会话 sheet's rows, menus and controls (new-session/), with the
// task's own: 做什么 · 会话 or 项目 · 基于 · 智能体 · 界面 · 模型 · 权限 · 消息 · 时间 · 错过了 · 自动归档 · 前置检查.
// No explanatory lines: labels, values and the 下次 time carry it (Figma 67′).
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, ChevronRight, GitBranch, Globe } from 'lucide-react'
import { AGENT_SPECS, agentName, CLI_AGENTS, type CliAgent } from '@shared/agents'
import { GUI_PERMISSION_LABELS, type GuiPermission } from '@shared/gui-chat'
import type { AgentAvailability } from '@shared/ipc'
import { defaultBase, groupBranches, type NewSessionInfo } from '@shared/new-session'
import {
  MIN_INTERVAL_MINUTES,
  nextOccurrence,
  whenLabel,
  type Schedule,
  type ScheduleAction,
  type ScheduleDraft,
  type ScheduleTiming,
  type Weekday
} from '@shared/schedule'
import type { ProjectId, SessionId, SessionUi } from '@shared/types'
import { Field, SelectButton } from '../new-session/NewSessionSheet'
import { binaryInstalled, listedAgents, uiRow } from '../new-session/model'
import { SheetMenu, type SheetMenuSection } from '../new-session/SheetMenu'
import { useWorkspace } from '../state/workspace'
import { Segmented } from '../ui/Segmented'
import { StatusGlyph } from '../ui/StatusGlyph'
import { canReceive } from './model'
import { closeSheet, useNow, useSchedules, type SheetState } from './store'
import sheet from '../new-session/NewSessionSheet.module.css'
import styles from './ScheduleSheet.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

type What = ScheduleAction['kind']
type TimingKind = ScheduleTiming['kind']
type Permission = GuiPermission | 'default'

const WHATS: ReadonlyArray<{ value: What; label: string }> = [
  { value: 'new', label: '开新会话' },
  { value: 'send', label: '发给已有会话' }
]
const UIS: ReadonlyArray<{ value: SessionUi; label: string }> = [
  { value: 'gui', label: 'GUI' },
  { value: 'cli', label: 'CLI' }
]
const TIMINGS: ReadonlyArray<{ value: TimingKind; label: string }> = [
  { value: 'interval', label: '间隔' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'once', label: '一次' }
]
const MISSED: ReadonlyArray<{ value: Schedule['missed']; label: string }> = [
  { value: 'catch-up', label: '补跑一次' },
  { value: 'skip', label: '跳过' }
]
const UNITS: ReadonlyArray<{ value: 'minutes' | 'hours'; label: string }> = [
  { value: 'minutes', label: '分钟' },
  { value: 'hours', label: '小时' }
]
/** Monday first, as the Mac's calendar shows a week here. */
const WEEK: ReadonlyArray<{ value: Weekday; label: string }> = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' }
]

const pad = (n: number): string => String(n).padStart(2, '0')
const dayOf = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const clockOf = (t: number): string => `${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}`
const atDayClock = (day: string, time: string): number | null => {
  const [y, m, d] = day.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  if (!y || !m || !d || h === undefined || min === undefined || Number.isNaN(h) || Number.isNaN(min)) return null
  return new Date(y, m - 1, d, h, min).getTime()
}

/** The form's fields, from the task being edited or copied, or the defaults. */
interface Form {
  name: string
  what: What
  projectId: ProjectId | null
  base: string | null
  agent: CliAgent
  ui: SessionUi
  model: string
  permission: Permission
  autoArchive: boolean
  precheck: string
  sessionId: SessionId | null
  prompt: string
  timing: TimingKind
  every: number
  unit: 'minutes' | 'hours'
  time: string
  days: Weekday[]
  onceDay: string
  hasUntil: boolean
  until: string
  missed: Schedule['missed']
}

function initialForm(source: Schedule | undefined, copy: boolean, projectId: ProjectId | null): Form {
  const now = Date.now()
  const base: Form = {
    name: '',
    what: 'new',
    projectId,
    base: null,
    agent: 'claude',
    ui: 'gui',
    model: '',
    permission: 'ask',
    autoArchive: true,
    precheck: '',
    sessionId: null,
    prompt: '',
    timing: 'daily',
    every: 30,
    unit: 'minutes',
    time: '09:00',
    days: [new Date(now).getDay() as Weekday],
    onceDay: dayOf(now + 24 * 60 * 60 * 1000),
    hasUntil: false,
    until: dayOf(now + 30 * 24 * 60 * 60 * 1000),
    missed: 'catch-up'
  }
  if (!source) return base
  const a = source.action
  const t = source.timing
  return {
    ...base,
    name: copy ? `${source.name} 副本`.slice(0, 60) : source.name,
    what: a.kind,
    prompt: source.prompt,
    missed: source.missed,
    ...(source.until ? { hasUntil: true, until: source.until } : {}),
    ...(a.kind === 'new'
      ? { projectId: a.projectId, base: a.base, agent: a.agent, ui: a.ui, model: a.model ?? '', permission: a.permission ?? 'default', autoArchive: a.autoArchive, precheck: a.precheck ?? '' }
      : { sessionId: a.sessionId }),
    timing: t.kind,
    ...(t.kind === 'interval' ? (t.minutes % 60 === 0 ? { every: t.minutes / 60, unit: 'hours' as const } : { every: t.minutes, unit: 'minutes' as const }) : {}),
    ...(t.kind === 'daily' || t.kind === 'weekdays' || t.kind === 'weekly' ? { time: t.time } : {}),
    ...(t.kind === 'weekly' ? { days: t.days } : {}),
    ...(t.kind === 'once' ? { onceDay: dayOf(t.at), time: clockOf(t.at) } : {})
  }
}

function timingOf(form: Form): ScheduleTiming | null {
  switch (form.timing) {
    case 'interval': {
      const minutes = Math.round(form.every * (form.unit === 'hours' ? 60 : 1))
      return Number.isFinite(minutes) && minutes >= MIN_INTERVAL_MINUTES ? { kind: 'interval', minutes } : null
    }
    case 'daily':
    case 'weekdays':
      return { kind: form.timing, time: form.time }
    case 'weekly':
      return form.days.length > 0 ? { kind: 'weekly', days: [...form.days].sort(), time: form.time } : null
    case 'once': {
      const at = atDayClock(form.onceDay, form.time)
      return at !== null ? { kind: 'once', at } : null
    }
  }
}

/** Only Claude's terminal takes a 权限 at launch; every GUI session does (PRD F24). */
const permissionsFor = (agent: CliAgent, ui: SessionUi): readonly Permission[] => (ui === 'gui' || agent === 'claude' ? ['ask', 'accept-edits', 'auto'] : ['default'])

export function ScheduleSheet() {
  const state = useSchedules((s) => s.sheet)
  return state ? <Sheet key={JSON.stringify(state)} state={state} /> : null
}

function Sheet({ state }: { state: SheetState }) {
  const schedules = useSchedules((s) => s.schedules)
  const source = state.mode === 'new' ? undefined : schedules.find((s) => s.id === state.id)
  const projects = useWorkspace((s) => s.projects)
  const sessions = useWorkspace((s) => s.sessions)
  const worktrees = useWorkspace((s) => s.worktrees)
  const guiPicks = useWorkspace((s) => s.guiPicks)
  const [form, setForm] = useState<Form>(() => initialForm(source, state.mode === 'copy', projects[0]?.id ?? null))
  const set = <K extends keyof Form>(key: K, value: Form[K]): void => setForm((f) => ({ ...f, [key]: value }))
  const [precheckOpen, setPrecheckOpen] = useState(form.precheck !== '')
  const [found, setFound] = useState<AgentAvailability | null>(null)
  const [infos, setInfos] = useState<Record<ProjectId, NewSessionInfo | 'error'>>({})
  const [menu, setMenu] = useState<{ kind: 'project' | 'base' | 'agent' | 'model' | 'session'; anchor: HTMLElement } | null>(null)
  const [saving, setSaving] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const project = projects.find((p) => p.id === form.projectId) ?? null
  const loaded = project ? infos[project.id] : undefined
  const info = loaded && loaded !== 'error' ? loaded : null

  useEffect(() => sheetRef.current?.focus(), [])
  useEffect(() => {
    let cancelled = false
    void window.tr.app.detectAgents().then((next) => !cancelled && setFound(next)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    if (!project || infos[project.id]) return
    let cancelled = false
    window.tr.gitWorktrees
      .newSessionInfo(project.rootPath)
      .then((next) => !cancelled && setInfos((all) => ({ ...all, [project.id]: next })))
      .catch(() => !cancelled && setInfos((all) => ({ ...all, [project.id]: 'error' })))
    return () => {
      cancelled = true
    }
  }, [project, infos])

  // The 模型 menu lists what the agent offered last; nothing yet asks it once, as the phone's 新建会话 does.
  useEffect(() => {
    if (guiPicks[form.agent]?.models?.length) return
    let cancelled = false
    void window.tr.gui
      .models(form.agent)
      .then((result) => {
        if (cancelled || !result.ok || useWorkspace.getState().guiPicks[form.agent]?.modelsFrom === 'live') return
        useWorkspace.getState().rememberGuiPicks(form.agent, { models: result.catalog.models, modelsFrom: 'probe' })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [form.agent, guiPicks])

  const ui = uiRow(form.agent, form.ui, binaryInstalled(found))
  const sessionUi: SessionUi = ui?.value ?? 'cli'
  const permissions = permissionsFor(form.agent, sessionUi)
  const permission: Permission = permissions.includes(form.permission) ? form.permission : (permissions[0] ?? 'default')
  const base = form.base ?? (info ? defaultBase(info) : null)
  const agentModels = guiPicks[form.agent]?.models
  const models = useMemo(() => agentModels ?? [], [agentModels])
  const now = useNow()
  const timing = timingOf(form)
  const until = form.hasUntil && form.timing !== 'once' ? form.until : undefined
  const next = timing ? nextOccurrence(timing, now, now, until) : null
  const target = sessions.find((s) => s.id === form.sessionId)

  const action: ScheduleAction | null =
    form.what === 'send'
      ? target && canReceive(target)
        ? { kind: 'send', sessionId: target.id }
        : null
      : project && base
        ? {
            kind: 'new',
            projectId: project.id,
            base,
            agent: form.agent,
            ui: sessionUi,
            autoArchive: form.autoArchive,
            ...(form.model ? { model: form.model } : {}),
            ...(permission !== 'default' ? { permission } : {}),
            ...(form.precheck.trim() ? { precheck: form.precheck.trim() } : {})
          }
        : null
  const draft: ScheduleDraft | null =
    action && timing && form.name.trim() && form.prompt.trim()
      ? { name: form.name.trim(), enabled: source?.enabled ?? true, action, prompt: form.prompt, timing, missed: form.missed, ...(until ? { until } : {}) }
      : null

  const save = async (): Promise<void> => {
    if (!draft || saving) return
    setSaving(true)
    const saved = state.mode === 'edit' ? await window.tr.schedules.update(state.id, { ...draft, enabled: source?.enabled ?? true }) : await window.tr.schedules.create({ ...draft, enabled: true })
    setSaving(false)
    if (saved) closeSheet()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSheet()
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      void save()
    }
  }
  const onScrimMouseDown = (event: MouseEvent): void => {
    if (event.target === event.currentTarget) closeSheet()
  }
  const closeMenu = useCallback((refocus: boolean) => {
    setMenu((open) => {
      if (refocus) open?.anchor.focus()
      return null
    })
  }, [])
  const toggleMenu = (kind: NonNullable<typeof menu>['kind'], anchor: HTMLElement): void => setMenu(menu?.kind === kind ? null : { kind, anchor })
  const check = (on: boolean) => (on ? <Check {...ICON} /> : null)

  const projectSections = useCallback((): SheetMenuSection[] => [{ items: projects.map((p) => ({ value: p.id, label: p.name, icon: check(p.id === form.projectId) })) }], [projects, form.projectId])
  const agentSections = useCallback(
    (query: string): SheetMenuSection[] => {
      const q = query.trim().toLowerCase()
      const items = listedAgents(found)
        .filter((id): id is CliAgent => id !== 'shell' && (!found || found[id] === true))
        .filter((id) => !q || agentName(id).toLowerCase().includes(q) || AGENT_SPECS[id].binary.includes(q))
        .map((id) => ({ value: id, label: agentName(id), icon: check(id === form.agent) }))
      return [{ title: '已安装', items }]
    },
    [found, form.agent]
  )
  const branchSections = useCallback(
    (query: string): SheetMenuSection[] => {
      if (!info) return []
      const groups = groupBranches(info.branches, info.defaultBranch, query)
      return [
        { title: '本地分支', items: groups.local.map((b) => ({ value: b.name, label: b.name, icon: b.name === base ? <Check {...ICON} /> : <GitBranch {...ICON} />, meta: b.name === info.defaultBranch ? '项目默认' : undefined })) },
        { title: '远程分支', items: groups.remote.map((b) => ({ value: b.name, label: b.name, icon: b.name === base ? <Check {...ICON} /> : <Globe {...ICON} /> })) }
      ]
    },
    [info, base]
  )
  const modelSections = useCallback(
    (): SheetMenuSection[] => [{ items: [{ value: '', label: '默认', icon: check(form.model === '') }, ...models.map((m) => ({ value: m.value, label: m.label, icon: check(m.value === form.model) }))] }],
    [models, form.model]
  )
  const sessionSections = useCallback(
    (query: string): SheetMenuSection[] => {
      const q = query.trim().toLowerCase()
      return projects
        .map((p) => ({
          title: p.name,
          items: sessions
            .filter((s) => s.kind !== 'shell' && worktrees.some((w) => w.id === s.worktreeId && w.projectId === p.id && w.archived === undefined))
            .filter((s) => !q || s.title.toLowerCase().includes(q))
            .map((s) => ({
              value: s.id,
              label: s.title,
              icon: <StatusGlyph status={s.status} />,
              meta: canReceive(s) ? agentName(s.kind) : '看不出空闲'
            }))
        }))
        .filter((section) => section.items.length > 0)
    },
    [projects, sessions, worktrees]
  )
  const modelLabel = useMemo(() => (form.model ? (models.find((m) => m.value === form.model)?.label ?? form.model) : '默认'), [form.model, models])
  const timeInput = <input className={styles.time} type="time" aria-label="时刻" value={form.time} onChange={(e) => e.currentTarget.value && set('time', e.currentTarget.value)} />

  return (
    <div className={sheet.scrim} onMouseDown={onScrimMouseDown} data-region="schedule-sheet">
      <div ref={sheetRef} className={`${sheet.sheet} ${styles.sheet}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown} data-testid="schedule-sheet">
        <header className={sheet.context}>
          <h2 id={titleId} className={sheet.title}>
            {state.mode === 'edit' ? '编辑定时任务' : '新建定时任务'}
          </h2>
        </header>

        <div className={`${sheet.fields} ${styles.fields}`}>
          <Field label="名称">
            <input className={styles.text} aria-label="名称" value={form.name} maxLength={60} onChange={(e) => set('name', e.currentTarget.value)} autoFocus={state.mode === 'new'} />
          </Field>
          <Field label="做什么">
            <Segmented label="做什么" value={form.what} options={WHATS} onChange={(v) => set('what', v)} />
          </Field>

          {form.what === 'send' ? (
            <Field label="会话">
              <SelectButton
                label="会话"
                value={target ? `${target.title} · ${projects.find((p) => worktrees.some((w) => w.id === target.worktreeId && w.projectId === p.id))?.name ?? ''} · ${agentName(target.kind)}` : '选一个会话'}
                expanded={menu?.kind === 'session'}
                onClick={(anchor) => toggleMenu('session', anchor)}
              />
            </Field>
          ) : (
            <>
              <Field label="项目">
                <SelectButton label="项目" value={project?.name ?? '—'} expanded={menu?.kind === 'project'} onClick={(anchor) => toggleMenu('project', anchor)} />
              </Field>
              <Field label="基于">
                <SelectButton label="基于" value={base ?? '—'} expanded={menu?.kind === 'base'} disabled={!info} onClick={(anchor) => toggleMenu('base', anchor)} />
              </Field>
              <Field label="智能体">
                <SelectButton label="智能体" value={agentName(form.agent)} expanded={menu?.kind === 'agent'} onClick={(anchor) => toggleMenu('agent', anchor)} />
              </Field>
              {ui && (
                <Field label="界面">
                  <Segmented label="界面" value={ui.value} options={UIS.map((o) => (o.value === 'gui' ? { ...o, disabled: ui.guiDisabled, title: ui.guiTitle } : o))} onChange={(v) => set('ui', v)} />
                </Field>
              )}
              <Field label="模型">
                <SelectButton label="模型" value={modelLabel} expanded={menu?.kind === 'model'} onClick={(anchor) => toggleMenu('model', anchor)} />
              </Field>
              <Field label="权限">
                <Segmented
                  label="权限"
                  value={permission}
                  options={permissions.map((p) => ({ value: p, label: p === 'default' ? '默认' : GUI_PERMISSION_LABELS[p] }))}
                  onChange={(v) => set('permission', v)}
                />
              </Field>
            </>
          )}

          <Field label="消息">
            <textarea className={styles.prompt} aria-label="消息" value={form.prompt} rows={3} onChange={(e) => set('prompt', e.currentTarget.value)} />
          </Field>

          <Field label="时间">
            <Segmented label="时间" value={form.timing} options={TIMINGS} onChange={(v) => set('timing', v)} />
            <div className={styles.line}>
              {form.timing === 'interval' && (
                <>
                  <span className={styles.word}>每隔</span>
                  <input
                    className={styles.number}
                    type="number"
                    aria-label="间隔"
                    min={form.unit === 'hours' ? 1 : MIN_INTERVAL_MINUTES}
                    value={form.every}
                    onChange={(e) => set('every', Number(e.currentTarget.value))}
                  />
                  <Segmented label="单位" value={form.unit} options={UNITS} onChange={(v) => set('unit', v)} />
                </>
              )}
              {form.timing === 'weekly' && (
                <div className={styles.days} role="group" aria-label="星期">
                  {WEEK.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      className={styles.day}
                      aria-pressed={form.days.includes(d.value)}
                      onClick={() => set('days', form.days.includes(d.value) ? form.days.filter((x) => x !== d.value) : [...form.days, d.value])}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              )}
              {form.timing === 'once' && <input className={styles.date} type="date" aria-label="日期" value={form.onceDay} onChange={(e) => e.currentTarget.value && set('onceDay', e.currentTarget.value)} />}
              {form.timing !== 'interval' && timeInput}
              <span className={styles.next}>{next !== null ? `下次 ${whenLabel(next, now)}` : '不会再运行'}</span>
            </div>
            {form.timing !== 'once' && (
              <div className={styles.line}>
                <label className={styles.check}>
                  <input type="checkbox" checked={form.hasUntil} onChange={(e) => set('hasUntil', e.currentTarget.checked)} />
                  到某天为止
                </label>
                {form.hasUntil && <input className={styles.date} type="date" aria-label="截止日期" value={form.until} onChange={(e) => e.currentTarget.value && set('until', e.currentTarget.value)} />}
              </div>
            )}
          </Field>

          <Field label="错过了">
            <Segmented label="错过了" value={form.missed} options={MISSED} onChange={(v) => set('missed', v)} />
          </Field>

          {form.what === 'new' && (
            <>
              <Field label="自动归档">
                <label className={`${styles.check} ${styles.checkRow}`}>
                  <input type="checkbox" checked={form.autoArchive} onChange={(e) => set('autoArchive', e.currentTarget.checked)} />
                  这一轮没有改动时
                </label>
              </Field>
              {precheckOpen ? (
                <Field label="前置检查">
                  <input className={styles.mono} aria-label="前置检查" value={form.precheck} spellCheck={false} placeholder="一条命令" onChange={(e) => set('precheck', e.currentTarget.value)} />
                </Field>
              ) : (
                <button type="button" className={sheet.advanced} aria-expanded={false} onClick={() => setPrecheckOpen(true)}>
                  <span className={sheet.label}>前置检查</span>
                  <span className={sheet.advancedBranch}>没有</span>
                  <span className={sheet.spacer} />
                  <ChevronRight {...ICON} />
                </button>
              )}
            </>
          )}
        </div>

        <footer className={sheet.footer}>
          <button type="button" className={sheet.cancel} onClick={() => closeSheet()}>
            取消
          </button>
          <button type="button" className={sheet.primary} disabled={!draft || saving} onClick={() => void save()}>
            保存
            <span className={sheet.shortcut}>⌘↵</span>
          </button>
        </footer>
      </div>

      {menu?.kind === 'project' && (
        <SheetMenu
          anchor={menu.anchor}
          label="项目"
          sections={projectSections}
          selected={form.projectId}
          empty="没有项目"
          onPick={(id) => {
            setForm((f) => ({ ...f, projectId: id, base: null }))
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'base' && (
        <SheetMenu
          anchor={menu.anchor}
          label="基于"
          sections={branchSections}
          selected={base}
          search="搜索分支"
          onPick={(name) => {
            set('base', name)
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'agent' && (
        <SheetMenu
          anchor={menu.anchor}
          label="智能体"
          sections={agentSections}
          selected={form.agent}
          search="搜索智能体"
          empty="没有匹配的智能体"
          align="selected"
          onPick={(value) => {
            if ((CLI_AGENTS as readonly string[]).includes(value)) setForm((f) => ({ ...f, agent: value as CliAgent, model: '' }))
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'model' && (
        <SheetMenu
          anchor={menu.anchor}
          label="模型"
          sections={modelSections}
          selected={form.model}
          empty="没有模型"
          onPick={(value) => {
            set('model', value)
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'session' && (
        <SheetMenu
          anchor={menu.anchor}
          label="会话"
          sections={sessionSections}
          selected={form.sessionId}
          search="搜索会话"
          empty="没有会话"
          onPick={(id) => {
            const picked = sessions.find((s) => s.id === id)
            if (!picked || !canReceive(picked)) return
            set('sessionId', id)
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}

