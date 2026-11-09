// 定时任务 (PRD F24, Figma 67A′–67C′, 67L′): every task in one dialog over the window — global things never take the
// main area (v1.89). A row: switch · name, its time and what it does · 下次 and the last outcome · 「…」. Clicking a row
// unfolds its last 20 runs, each opening its session or restoring an archived one. The sheet (ScheduleSheet) edits.
import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { Copy, Ellipsis, Pencil, Play, Trash2, X } from 'lucide-react'
import { agentName } from '@shared/agents'
import { clock, monthDay, nextRun, runLabel, timingLabel, whenLabel, type Schedule, type ScheduleRun } from '@shared/schedule'
import { restoreArchivedWorktree } from '../archive/actions'
import { openSettings } from '../settings/SettingsDialog'
import { Toggle } from '../settings/controls'
import { useWorkspace } from '../state/workspace'
import { IconButton } from '../ui/IconButton'
import { popupMenu } from '../ui/menu'
import { ScheduleSheet } from './ScheduleSheet'
import { closeSchedules, openSheet, toggleExpanded, useNow, useSchedules } from './store'
import sheet from '../new-session/NewSessionSheet.module.css'
import styles from './SchedulesDialog.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export function SchedulesDialog() {
  const open = useSchedules((s) => s.open)
  return open ? (
    <>
      <Dialog />
      <ScheduleSheet />
    </>
  ) : null
}

/** `在 terminal-reborn 开 Codex（gpt-6-sol）` / `发给「Cookie 会话迁移」`. */
function useWhatLabel(schedule: Schedule): string {
  const projects = useWorkspace((s) => s.projects)
  const sessions = useWorkspace((s) => s.sessions)
  const a = schedule.action
  if (a.kind === 'send') return `发给「${sessions.find((s) => s.id === a.sessionId)?.title ?? '已关闭的会话'}」`
  const project = projects.find((p) => p.id === a.projectId)?.name ?? '已移除的项目'
  return `在 ${project} 开 ${agentName(a.agent)}${a.model ? `（${a.model}）` : ''}${a.precheck ? ' · 有前置检查' : ''}`
}

/** The outcome's mark: filled for what happened, hollow for a skip, red for a failure; the text says which (never color alone). */
function RunMark({ run }: { run: ScheduleRun | undefined }) {
  const kind = !run ? 'none' : run.outcome === 'failed' ? 'failed' : run.outcome === 'skipped' ? 'skipped' : run.outcome === 'running' ? 'running' : 'done'
  return <span className={styles.mark} data-kind={kind} aria-hidden />
}

function Dialog() {
  const schedules = useSchedules((s) => s.schedules)
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const sheetOpen = useSchedules((s) => s.sheet !== null)
  useEffect(() => ref.current?.focus(), [])

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || sheetOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSchedules()
    }
  }
  const onScrimMouseDown = (event: MouseEvent): void => {
    if (event.target === event.currentTarget && !sheetOpen) closeSchedules()
  }

  return (
    <div className={sheet.scrim} onMouseDown={onScrimMouseDown} data-region="schedules">
      <div ref={ref} className={`${sheet.sheet} ${styles.dialog}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown} data-testid="schedules-dialog">
        <header className={styles.header}>
          <h2 id={titleId} className={sheet.title}>
            定时任务
          </h2>
          <span className={styles.spacer} />
          {schedules.length > 0 && (
            <button type="button" className={styles.button} onClick={() => openSheet({ mode: 'new' })}>
              新建定时任务
            </button>
          )}
          <IconButton label="关闭" onClick={closeSchedules}>
            <X {...ICON} />
          </IconButton>
        </header>
        {schedules.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>还没有定时任务</p>
            <button type="button" className={sheet.primary} onClick={() => openSheet({ mode: 'new' })}>
              新建定时任务
            </button>
          </div>
        ) : (
          <div className={styles.list} role="list">
            {schedules.map((s) => (
              <Row key={s.id} schedule={s} />
            ))}
          </div>
        )}
        <footer className={styles.footer}>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              closeSchedules()
              openSettings('automation')
            }}
          >
            设置…
          </button>
        </footer>
      </div>
    </div>
  )
}

async function rowMenu(schedule: Schedule, anchor: Element): Promise<void> {
  const choice = await popupMenu(
    [
      { type: 'item', id: 'run', label: '立即运行', icon: Play },
      { type: 'item', id: 'edit', label: '编辑…', icon: Pencil },
      { type: 'item', id: 'copy', label: '复制一份', icon: Copy },
      { type: 'separator' },
      { type: 'item', id: 'delete', label: '删除', icon: Trash2 }
    ],
    anchor
  )
  if (choice === 'run') await window.tr.schedules.runNow(schedule.id)
  else if (choice === 'edit') openSheet({ mode: 'edit', id: schedule.id })
  else if (choice === 'copy') openSheet({ mode: 'copy', id: schedule.id })
  else if (choice === 'delete') await window.tr.schedules.remove(schedule.id)
}

function Row({ schedule }: { schedule: Schedule }) {
  const expanded = useSchedules((s) => s.expanded === schedule.id)
  const what = useWhatLabel(schedule)
  const now = useNow()
  const next = nextRun(schedule, now)
  const last = schedule.runs[0]
  const state = schedule.paused === 'failures' ? '已暂停：连续 3 次失败' : !schedule.enabled ? '已关闭' : null
  return (
    <div className={styles.item} role="listitem" data-testid="schedule-row">
      <div className={styles.row} data-expanded={expanded} data-off={!schedule.enabled} onClick={() => toggleExpanded(schedule.id)}>
        <span className={styles.toggle} onClick={(e) => e.stopPropagation()}>
          <Toggle checked={schedule.enabled} label={`${schedule.name}：开关`} onChange={(on) => void window.tr.schedules.setEnabled(schedule.id, on)} />
        </span>
        <div className={styles.main}>
          <div className={styles.nameLine}>
            <span className={styles.name}>{schedule.name}</span>
            {schedule.expiresAt !== undefined && (
              <>
                <span className={styles.meta}>agent 建的 · {monthDay(schedule.expiresAt)} 到期</span>
                <button
                  type="button"
                  className={styles.link}
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.tr.schedules.keep(schedule.id)
                  }}
                >
                  保留
                </button>
              </>
            )}
          </div>
          <span className={styles.sub}>
            {timingLabel(schedule.timing)} · {what}
          </span>
        </div>
        <div className={styles.side}>
          {state ? (
            <span className={styles.state} data-paused={schedule.paused === 'failures'}>
              {schedule.paused === 'failures' && <span className={styles.mark} data-kind="failed" aria-hidden />}
              {state}
            </span>
          ) : (
            <span className={styles.nextLine}>
              <span className={styles.nextLabel}>下次</span>
              <span className={styles.nextTime}>{next !== null ? whenLabel(next, now) : '不会再运行'}</span>
            </span>
          )}
          <span className={styles.result}>
            {last ? (
              <>
                <RunMark run={last} />
                <span className={styles.resultText}>
                  {whenLabel(last.at, now).replace(/^(\d)/, '今天 $1')} · {runLabel(last)}
                </span>
              </>
            ) : (
              <span className={styles.resultText}>还没运行过</span>
            )}
          </span>
        </div>
        <span className={styles.more} onClick={(e) => e.stopPropagation()}>
          <IconButton label={`${schedule.name}：更多`} onClick={(e) => void rowMenu(schedule, e.currentTarget)}>
            <Ellipsis {...ICON} />
          </IconButton>
        </span>
      </div>
      {expanded && <History schedule={schedule} />}
    </div>
  )
}

function History({ schedule }: { schedule: Schedule }) {
  const sessions = useWorkspace((s) => s.sessions)
  const worktrees = useWorkspace((s) => s.worktrees)
  const today = monthDay(useNow())
  if (schedule.runs.length === 0) return <div className={styles.history}><span className={styles.historyEmpty}>还没运行过</span></div>
  return (
    <div className={styles.history} role="list" aria-label={`${schedule.name}：最近的运行`}>
      {schedule.runs.map((run) => {
        const session = run.sessionId ? sessions.find((s) => s.id === run.sessionId) : undefined
        const worktree = session && worktrees.find((w) => w.id === session.worktreeId)
        const archived = worktree?.archived !== undefined
        return (
          <div key={`${run.planned}-${run.manual ? 'm' : 's'}`} className={styles.run} role="listitem">
            <span className={styles.runTime}>
              {monthDay(run.at) === today ? '今天' : monthDay(run.at)} {clock(run.at)}
            </span>
            <RunMark run={run} />
            <span className={styles.runText}>{runLabel(run)}</span>
            {session && worktree && (
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  if (archived) void restoreArchivedWorktree(worktree.id)
                  else {
                    closeSchedules()
                    useWorkspace.getState().setActiveSession(session.id)
                  }
                }}
              >
                {archived ? '恢复' : '打开'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
