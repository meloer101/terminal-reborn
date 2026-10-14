// Whether a session's status can be trusted to follow hooks (phase 2a · A8).
//
// `useHooksHealth(sessionId)` is the one thing the UI reads. It is 'unavailable' when
// - the hook server is down (main's `onHooksHealth`),
// - this agent was launched without hooks (`onSessionHooks` kind 'unavailable': server down, Codex probe failed),
// - or the agent is up but no hook ever arrived (derived locally by the status machine, and from main's
//   `start-timeout` signal).
// In all of those the sidebar and header fall back to the terminal title, and the header says so.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { HooksHealth, SessionHooksSignal } from '@shared/agent-events'
import type { SessionId } from '@shared/types'

export type HooksHealthState = 'ok' | 'unavailable'

interface HooksHealthStore {
  server: HooksHealth
  /** Launched without hooks. */
  unavailable: Record<SessionId, true | undefined>
  /** Up, but no hook event ever arrived. */
  silent: Record<SessionId, true | undefined>
}

const useStore = create<HooksHealthStore>(() => ({ server: { ok: true }, unavailable: {}, silent: {} }))

function setFlag(key: 'unavailable' | 'silent', sessionId: SessionId, on: boolean): void {
  if (!!useStore.getState()[key][sessionId] === on) return
  useStore.setState((s) => ({ [key]: { ...s[key], [sessionId]: on ? true : undefined } }) as Pick<HooksHealthStore, typeof key>)
}

/** Status machine: the agent is up but silent (or spoke up again). */
export function setHooksSilent(sessionId: SessionId, silent: boolean): void {
  setFlag('silent', sessionId, silent)
}

/** A (re)launch starts the evidence over. */
export function resetHooksHealth(sessionId: SessionId): void {
  setFlag('unavailable', sessionId, false)
  setFlag('silent', sessionId, false)
}

/** Main's per-session signal. 'start-timeout' only matters together with the screen (see StatusController). */
export function applySessionHooksSignal(signal: SessionHooksSignal): void {
  if (signal.kind === 'unavailable') setFlag('unavailable', signal.sessionId, true)
}

export function useHooksHealth(sessionId: SessionId | null): HooksHealthState {
  return useStore((s) => (!s.server.ok || (sessionId !== null && (s.unavailable[sessionId] || s.silent[sessionId])) ? 'unavailable' : 'ok'))
}

/** Follows the hook server's health; returns the unsubscribe function. */
export function startHooksHealthTracking(): () => void {
  let live = true
  const agent = window.tr.agent
  void agent.getHooksHealth().then((health) => {
    if (live) useStore.setState({ server: health })
  })
  const off = agent.onHooksHealth((health) => useStore.setState({ server: health }))
  return () => {
    live = false
    off()
  }
}

/** For tests and screenshots. */
export function resetHooksHealthStore(): void {
  useStore.setState({ server: { ok: true }, unavailable: {}, silent: {} })
}

/** Mounts the server-health subscription for the lifetime of a component. */
export function useHooksHealthTracking(): void {
  useEffect(() => startHooksHealthTracking(), [])
}
