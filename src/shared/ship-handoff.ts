// What Wavi asks the agent in the session to write or fix (PRD F16 v1.78, §6.9), and how it reads the answer back.
// The agent writes into `<git dir>/wavi/<kind>.md`; it never commits a ship text, never pushes and never opens a PR —
// Wavi does those after the user has looked. Outside text (CI logs, PR comments) is quoted as data, never instructions.

export type HandoffKind = 'commit' | 'pr' | 'fix'

export const HANDOFF_FILES: Record<HandoffKind, string> = { commit: 'commit.md', pr: 'pr.md', fix: 'fix.md' }

/** A failure to fix: the PR's checks, or the base's after 合并到 main pushed it. */
export interface HandoffFailure {
  scope: 'pr' | 'base'
  /** The PR number (scope 'pr') or the base branch name (scope 'base'). */
  where: string
  checks: string[]
  /** Raw log tail; the prompt cleans and quotes it. */
  log: string
}

export interface HandoffContext {
  kind: HandoffKind
  /** Absolute path the agent writes to. */
  path: string
  branch: string
  base: string
  /** The repository's PR template text, if any (kind 'pr'). */
  template: string | null
  /** Facts Wavi saw for the evidence part: checks this turn ran, the review result. One line each. */
  evidence: string[]
  /** kind 'fix'. */
  failure?: HandoffFailure
}

/** The message Wavi submits into the session for one handoff. */
export function handoffPrompt(context: HandoffContext): string {
  return `${context.kind} → ${context.path}`
}

export interface CommitText {
  subject: string
  body: string
}

export interface PrText {
  title: string
  body: string
}

/** The commit message the agent wrote (first line subject, rest body), or null when the file is unusable. */
export function parseCommitHandoff(text: string): CommitText | null {
  const subject = text.trim().split('\n')[0] ?? ''
  return subject ? { subject, body: '' } : null
}

/** The PR title (first line) and body the agent wrote, or null when the file is unusable. */
export function parsePrHandoff(text: string): PrText | null {
  const title = text.trim().split('\n')[0] ?? ''
  return title ? { title, body: '' } : null
}
