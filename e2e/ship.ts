// Helpers for the merge chain's exits (PRD F16 v1.78): Wavi asks the session's agent to write `<git dir>/wavi/commit.md` or
// `pr.md`. The fake agent (e2e/fake-hook-claude.ts) only echoes what it reads, so the test plays the agent: it finds the
// path in the prompt that reached the input line, writes the file there and ends the turn with the Stop hook, the way
// the real agent's turn ends.
import { expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FakeAgentFolder } from './fake-hook-claude'

/** What the fake agent was typed, without the bracketed-paste markers the send protocol wraps text in. */
export const typedBy = (agent: FakeAgentFolder): string => {
  const esc = String.fromCharCode(27)
  return agent.typed().split(`${esc}[200~`).join('').split(`${esc}[201~`).join('')
}

/** The path the last prompt for `<git dir>/worktrees/<name>/wavi/<kind>.md` names; waits until the prompt arrived. */
export async function promptedPath(agent: FakeAgentFolder, name: string, kind: 'commit' | 'pr', timeout = 30_000): Promise<string> {
  const re = new RegExp(`/\\S+/worktrees/${name}/wavi/${kind}\\.md`, 'g')
  let found = ''
  await expect
    .poll(
      () => {
        found = typedBy(agent).match(re)?.at(-1) ?? ''
        return found
      },
      { timeout, message: `the prompt for ${name}/${kind}.md reaches the agent` }
    )
    .not.toBe('')
  return found
}

/** The agent's answer: its turn starts, the file lands where the prompt said, the turn ends. */
export function agentWrites(agent: FakeAgentFolder, path: string, text: string): void {
  agent.step({ hook: 'UserPromptSubmit', payload: { prompt: 'Wavi 的请求' } })
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  agent.step({ hook: 'Stop', payload: { last_assistant_message: '写好了。' } })
}
