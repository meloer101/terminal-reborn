// 同任务多解 groups (PRD v1.59 / v1.68): the sessions launched together with one prompt, saved with the workspace
// (`workspace.json`, see ./persistence), plus how far each member's launch got (worktree → agent up → prompt sent),
// which is not saved. Closed sessions leave their group (workspace.ts prunes); a group with no member left goes.
import { create } from 'zustand'
import { markMerged, pruneAttemptGroups, type AttemptGroup } from '@shared/attempt-groups'
import type { SessionId } from '@shared/types'
import { initialWorkspaceFile, requestSave } from './persistence'

/** Where one member's launch is: its worktree, its agent starting, the prompt being typed, sent — or why not. */
export type MemberLaunch =
  | { phase: 'creating' | 'starting' | 'sending' | 'sent' }
  | { phase: 'failed'; message: string }

interface State {
  groups: AttemptGroup[]
  launches: Record<SessionId, MemberLaunch | undefined>
}

export const useAttemptGroups = create<State>()(() => ({
  groups: initialWorkspaceFile()?.attemptGroups ?? [],
  launches: {}
}))

/** For the workspace snapshot. */
export const attemptGroupsSnapshot = (): AttemptGroup[] => useAttemptGroups.getState().groups

useAttemptGroups.subscribe((state, prev) => {
  if (state.groups !== prev.groups) requestSave()
})

let counter = 0
export const newGroupId = (): string => `g${Date.now().toString(36)}${(counter++).toString(36)}`

export function addAttemptGroup(group: AttemptGroup): void {
  useAttemptGroups.setState((s) => ({ groups: [...s.groups, group] }))
}

export function setMemberLaunch(id: SessionId, launch: MemberLaunch): void {
  useAttemptGroups.setState((s) => ({ launches: { ...s.launches, [id]: launch } }))
}

/** One member was merged into the base (the merge sheet): the others are offered for archive from now on. */
export function markGroupMerged(groupId: string, sessionId: SessionId, branch: string): void {
  useAttemptGroups.setState((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? markMerged(g, sessionId, branch, Date.now()) : g)) }))
}

/** Sessions that were closed leave their groups. */
export function pruneGroups(alive: ReadonlySet<SessionId>): void {
  const { groups } = useAttemptGroups.getState()
  const next = pruneAttemptGroups(groups, alive)
  if (next !== groups) useAttemptGroups.setState({ groups: next })
}

/** The members' settle that went to the session the task came from (or is held for its 送进去). */
export function markGroupReported(groupId: string, key: string): void {
  useAttemptGroups.setState((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? { ...g, reported: key } : g)) }))
}
