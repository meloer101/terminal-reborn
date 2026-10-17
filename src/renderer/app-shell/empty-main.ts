// Pure helpers for the welcome page (EmptyMain.tsx, PRD F18 · Figma 14).
import type { AgentAvailability } from '@shared/ipc'

/** 5–11 早上好 · 11–13 中午好 · 13–18 下午好 · 18–23 晚上好 · 23–5 夜深了. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 11) return '早上好'
  if (hour >= 11 && hour < 13) return '中午好'
  if (hour >= 13 && hour < 18) return '下午好'
  if (hour >= 18 && hour < 23) return '晚上好'
  return '夜深了'
}

/** "下午好，Jacoy", or just "下午好" without a name. */
export function greeting(hour: number, name: string): string {
  const hello = greetingFor(hour)
  return name ? `${hello}，${name}` : hello
}

export interface Quote {
  text: string
  /** Attribution, shown after the line in tertiary; none for our own lines. */
  by?: string
}

/** Short lines only: classic programming maxims (attributed) and our own. Attributed lines drop the final 。. */
export const QUOTES: readonly Quote[] = [
  { text: '先让它跑起来，再让它跑对，最后让它跑快', by: 'Kent Beck' },
  { text: '简单是可靠的前提', by: 'Edsger Dijkstra' },
  { text: '过早优化是万恶之源', by: 'Donald Knuth' },
  { text: '让 agent 去写，你来决定写什么。' },
  { text: '一次只做一件事，但可以同时开很多个会话。' },
  { text: '好的提交说明，是写给三个月后的自己。' },
  { text: '先读懂 diff，再按合并。' }
]

/** One line per launch; `random` is injectable for tests. */
export function pickQuote(random: () => number = Math.random): Quote {
  const index = Math.min(QUOTES.length - 1, Math.floor(random() * QUOTES.length))
  return QUOTES[index]!
}

export interface InstallableAgent {
  id: string
  name: string
  command: string
}

/** The picker on the welcome page when no supported agent is installed (14C). Claude Code first: the default. */
export const INSTALLABLE_AGENTS: readonly InstallableAgent[] = [
  { id: 'claude', name: 'Claude Code', command: 'npm i -g @anthropic-ai/claude-code' },
  { id: 'codex', name: 'Codex', command: 'npm i -g @openai/codex' },
  { id: 'cursor', name: 'Cursor', command: 'curl https://cursor.com/install -fsS | bash' },
  { id: 'gemini', name: 'Gemini', command: 'npm i -g @google/gemini-cli' },
  { id: 'grok', name: 'Grok', command: 'curl -fsSL https://x.ai/cli/install.sh | bash' }
]

/** The install block shows only once detection finished and neither supported agent is on PATH. */
export function needsAgentInstall(agents: AgentAvailability | null): boolean {
  return agents !== null && !agents.claude && !agents.codex
}
