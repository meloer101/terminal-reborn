// 额度恢复后继续 (PRD F11): what the renderer knows about plan-limit stops and the sends the user asked for. Transient:
// a request lives as long as this window's page (a hidden window keeps it; ⌘Q, a restart or a reload drop it).
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { limitStop, type LimitStop, type ResumePlan, type StopFailure } from '@shared/limit-resume'
import type { SessionId } from '@shared/types'
import { useMetaNow } from '../session-meta/MetaChips'
import { useSessionMeta } from '../session-meta/store'
import { useWorkspace } from '../state/workspace'

interface LimitResumeState {
  /** Each session's StopFailure since its last prompt (Claude). */
  failures: Record<SessionId, StopFailure>
  /** Sends the user asked for, by session. */
  plans: Record<SessionId, ResumePlan>
  setFailure(sessionId: SessionId, failure: StopFailure | null): void
  arm(sessionId: SessionId, plan: ResumePlan): void
  cancel(sessionId: SessionId): void
  postpone(sessionId: SessionId, resetsAt: number): void
}

function without<T>(record: Record<SessionId, T>, sessionId: SessionId): Record<SessionId, T> {
  const next = { ...record }
  delete next[sessionId]
  return next
}

export const useLimitResume = create<LimitResumeState>()((set) => ({
  failures: {},
  plans: {},
  setFailure: (sessionId, failure) =>
    set((s) => {
      if (failure) return { failures: { ...s.failures, [sessionId]: failure } }
      return sessionId in s.failures ? { failures: without(s.failures, sessionId) } : {}
    }),
  arm: (sessionId, plan) => set((s) => ({ plans: { ...s.plans, [sessionId]: plan } })),
  cancel: (sessionId) => set((s) => (sessionId in s.plans ? { plans: without(s.plans, sessionId) } : {})),
  postpone: (sessionId, resetsAt) =>
    set((s) => {
      const plan = s.plans[sessionId]
      return plan ? { plans: { ...s.plans, [sessionId]: { ...plan, resetsAt } } } : {}
    })
}))

/** The plan limit that stopped this session right now, or null. Re-reads itself the moment the limit resets. */
export function useLimitStop(sessionId: SessionId): LimitStop | null {
  // The shared clock moves every 15 s; the reset itself is not left to it (the button would linger after it).
  const clock = useMetaNow()
  const [woke, setWoke] = useState(0)
  const session = useWorkspace((s) => s.sessions.find((x) => x.id === sessionId))
  const failure = useLimitResume((s) => s.failures[sessionId])
  const offPlan = useSessionMeta((s) => s.bySession[sessionId]?.plan === false)
  const usage = useSessionMeta((s) => (session && session.kind !== 'shell' ? s.usage[session.kind] : undefined))
  const stop = session ? limitStop({ session, failure, offPlan, usage, now: Math.max(clock, woke) }) : null
  const resetsAt = stop?.resetsAt
  useEffect(() => {
    if (resetsAt === undefined) return
    const timer = setTimeout(() => setWoke(Date.now()), Math.min(2 ** 31 - 1, Math.max(0, resetsAt - Date.now() + 50)))
    return () => clearTimeout(timer)
  }, [resetsAt])
  return stop
}
