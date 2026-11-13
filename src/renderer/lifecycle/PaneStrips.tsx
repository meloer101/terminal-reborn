// The cards a session shows under itself (Figma 80): in its own pane — under a terminal's card, as wide as it and
// --card-gap below it (80A, 80C), or in a chat's column above the composer (80B′) — never under the whole main area.
// Each renders nothing until its session has something to say.
import type { SessionId } from '@shared/types'
import { HeldAttemptReportStrip } from '../attempts/HeldAttemptReportStrip'
import { PlanStrip } from '../attempts/PlanStrip'
import { DispatchStrip } from '../dispatch/DispatchStrip'
import { HeldReportsStrip } from '../dispatch/HeldReportsStrip'
import { ScheduleConfirmStrip } from '../schedules/ScheduleConfirmStrip'
import { SetupStrip } from '../scripts/SetupStrip'
import { EngineRestartedCard } from './EngineRestartedCard'
import { SessionErrorBar } from './SessionErrorBar'

/** `active`: the pane has the keyboard (a ⌘↵ with nothing focused is its strips'). */
export function PaneStrips({ sessionId, active }: { sessionId: SessionId; active: boolean }) {
  return (
    <>
      <EngineRestartedCard sessionId={sessionId} />
      <SessionErrorBar sessionId={sessionId} />
      <SetupStrip sessionId={sessionId} />
      <DispatchStrip sessionId={sessionId} active={active} />
      <ScheduleConfirmStrip sessionId={sessionId} active={active} />
      <HeldReportsStrip sessionId={sessionId} />
      <HeldAttemptReportStrip sessionId={sessionId} />
      <PlanStrip sessionId={sessionId} />
    </>
  )
}
