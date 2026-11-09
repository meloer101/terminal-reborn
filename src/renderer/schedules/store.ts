// 定时任务 in the window (PRD F24): main's list of tasks, kept current from `schedules.onChanged`, and what the dialog
// shows (open, the row whose history is unfolded, the sheet with the task being edited).
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { Schedule } from '@shared/schedule'

export type SheetState = { mode: 'new' } | { mode: 'edit'; id: string } | { mode: 'copy'; id: string }

interface State {
  schedules: Schedule[]
  open: boolean
  expanded: string | null
  sheet: SheetState | null
}

export const useSchedules = create<State>()(() => ({ schedules: [], open: false, expanded: null, sheet: null }))

let listening = false

/** Loads the list once and follows main's changes from then on. */
export function followSchedules(): void {
  if (listening) return
  listening = true
  window.tr.schedules.onChanged((schedules) => useSchedules.setState({ schedules }))
  void window.tr.schedules.list().then((schedules) => useSchedules.setState({ schedules }))
}

/** ⇧⌘T, the sidebar row, ⌘K and 设置: opens the dialog, unfolding `expand`'s history (定时开出的会话's header link). */
export function openSchedules(expand?: string): void {
  followSchedules()
  useSchedules.setState({ open: true, ...(expand ? { expanded: expand } : {}) })
}

export const closeSchedules = (): void => useSchedules.setState({ open: false, sheet: null })
export const openSheet = (sheet: SheetState): void => useSchedules.setState({ open: true, sheet })
export const closeSheet = (): void => useSchedules.setState({ sheet: null })
export const toggleExpanded = (id: string): void => useSchedules.setState((s) => ({ expanded: s.expanded === id ? null : id }))

/** The time the dialog and the sheet read 下次 and 今天 from, moved on every 30 s while they are open. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
