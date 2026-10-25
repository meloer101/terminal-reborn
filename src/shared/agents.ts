// The agent CLIs Wavi can start in a session (PRD F4, ROADMAP “借鉴 T3 Code” 7): one row per CLI with what its
// launch needs. Claude Code and Codex keep their own launch code (agent-launch.ts); every other CLI is started from
// its row here: binary, first prompt, resume, model. Each runs its own vendor's model — a CLI pointed at another
// vendor through an endpoint override is not a separate row (users switch those with CC Switch).

/** Every agent CLI, in the order 新建会话 lists them. */
export const CLI_AGENTS = [
  'claude',
  'codex',
  'opencode',
  'gemini',
  'qwen',
  'pi',
  'copilot',
  'cursor',
  'grok',
  'kimi',
  'droid',
  'amp',
  'kiro',
  'crush',
  'goose',
  'cline',
  'antigravity',
  'auggie',
  'codebuddy'
] as const

export type CliAgent = (typeof CLI_AGENTS)[number]

/**
 * How the CLI learns about turns, permission dialogs and the end of a turn (状态 in 设置 · 智能体):
 * - `hooks`: Wavi injects hooks for this launch only (Claude `--settings`, Codex `-c`, and the per-CLI adapters
 *   in src/main/hooks) — 准确.
 * - `osc`: the CLI reports its state on the terminal itself (OSC 7501 Program Status), no injection — 准确.
 * - `title`: only the terminal title and the foreground process say anything — 估计.
 */
export type StatusSource = 'hooks' | 'osc' | 'title'

/** How the first message reaches a starting TUI without typing into it. */
export type PromptMode =
  /** `cli <prompt>` (after `--` when `separator`). */
  | { kind: 'argv'; separator?: boolean }
  /** `cli <flag> <prompt>`, e.g. `--prompt-interactive`. */
  | { kind: 'flag'; flag: string }
  /** No way to pass it: Wavi sends it once the TUI is up (PRD §6.9). */
  | { kind: 'type' }

export interface AgentSpec {
  id: CliAgent
  /** Name in menus and the session header. */
  label: string
  /** Command on PATH. */
  binary: string
  /** What 设置 · 智能体 offers to copy when it is not installed. */
  install: string
  status: StatusSource
  prompt: PromptMode
  /** Argv after the binary that continues a conversation by id (`{id}` is replaced), or null. */
  resumeById: readonly string[] | null
  /** Argv after the binary that continues the most recent conversation in the cwd (each session has its own worktree), or null. */
  continueLatest: readonly string[] | null
  /** The model flag, or null when the CLI has none. */
  modelFlag: string | null
  /** Argv Wavi always adds after the binary (e.g. a TUI subcommand). */
  baseArgs?: readonly string[]
  /** Older versions lack what `status` relies on (their status is then 估计). */
  minStatusVersion?: string
  /** Environment for this launch only (e.g. a per-launch folder trust that writes nothing). */
  env?: Readonly<Record<string, string>>
}

const spec = (s: AgentSpec): AgentSpec => s

export const AGENT_SPECS: Readonly<Record<CliAgent, AgentSpec>> = {
  claude: spec({
    id: 'claude',
    label: 'Claude Code',
    binary: 'claude',
    install: 'npm install -g @anthropic-ai/claude-code',
    status: 'hooks',
    prompt: { kind: 'argv', separator: true },
    resumeById: ['--resume', '{id}'],
    continueLatest: ['--continue'],
    modelFlag: '--model'
  }),
  codex: spec({
    id: 'codex',
    label: 'Codex',
    binary: 'codex',
    install: 'npm install -g @openai/codex',
    status: 'hooks',
    prompt: { kind: 'argv', separator: true },
    resumeById: ['resume', '{id}'],
    continueLatest: ['resume', '--last'],
    modelFlag: '-m'
  }),
  opencode: spec({
    id: 'opencode',
    label: 'OpenCode',
    binary: 'opencode',
    install: 'curl -fsSL https://opencode.ai/install | bash',
    // OpenCode 2 reports OSC 7501 itself; its plugins run in a shared background server that a launch cannot reach.
    status: 'osc',
    prompt: { kind: 'flag', flag: '--prompt' },
    resumeById: ['--session', '{id}'],
    continueLatest: ['--continue'],
    // 2.x has no root --model (only `run` / `mini`).
    modelFlag: null,
    // OpenCode 1.x does not report OSC 7501.
    minStatusVersion: '2.0.0'
  }),
  gemini: spec({
    id: 'gemini',
    label: 'Gemini CLI',
    binary: 'gemini',
    install: 'npm install -g @google/gemini-cli',
    status: 'hooks',
    prompt: { kind: 'flag', flag: '--prompt-interactive' },
    resumeById: ['--resume', '{id}'],
    continueLatest: ['--resume', 'latest'],
    modelFlag: '--model'
  }),
  qwen: spec({
    id: 'qwen',
    label: 'Qwen Code',
    binary: 'qwen',
    install: 'npm install -g @qwen-code/qwen-code',
    status: 'hooks',
    // A positional prompt runs one-shot and exits; -i keeps the TUI.
    prompt: { kind: 'flag', flag: '--prompt-interactive' },
    resumeById: ['--resume', '{id}'],
    continueLatest: ['--continue'],
    modelFlag: '--model'
  }),
  pi: spec({
    id: 'pi',
    label: 'Pi',
    binary: 'pi',
    install: 'npm install -g @earendil-works/pi-coding-agent',
    status: 'hooks',
    prompt: { kind: 'argv' },
    resumeById: ['--session', '{id}'],
    continueLatest: ['--continue'],
    modelFlag: '--model'
  }),
  copilot: spec({
    id: 'copilot',
    label: 'Copilot CLI',
    binary: 'copilot',
    install: 'npm install -g @github/copilot',
    status: 'title',
    // -p/--prompt exits when done; -i stays interactive.
    prompt: { kind: 'flag', flag: '--interactive' },
    resumeById: ['--resume={id}'],
    continueLatest: ['--continue'],
    modelFlag: '--model'
  }),
  cursor: spec({
    id: 'cursor',
    label: 'Cursor Agent',
    binary: 'cursor-agent',
    install: 'curl https://cursor.com/install -fsS | bash',
    status: 'title',
    prompt: { kind: 'argv' },
    resumeById: ['--resume', '{id}'],
    continueLatest: ['--continue'],
    modelFlag: '--model'
  }),
  grok: spec({
    id: 'grok',
    label: 'Grok',
    binary: 'grok',
    install: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    // Grok Build 1.0.67 reports OSC 7501 (after its query). Its hooks would need `--trust` (a global write): not used.
    status: 'osc',
    prompt: { kind: 'argv', separator: true },
    resumeById: ['--resume', '{id}'],
    continueLatest: ['--continue'],
    modelFlag: '--model'
  }),
  kimi: spec({
    id: 'kimi',
    label: 'Kimi Code',
    binary: 'kimi',
    install: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
    status: 'title',
    // -p is headless; the first message is typed once the TUI is up.
    prompt: { kind: 'type' },
    resumeById: ['--session', '{id}'],
    continueLatest: ['--continue'],
    modelFlag: '--model',
    // Trusts this launch's folder without writing its trust list (agent-core trustEnv).
    env: { KIMI_CODE_TRUST_WORKSPACE: '1' }
  }),
  droid: spec({
    id: 'droid',
    label: 'Droid',
    binary: 'droid',
    install: 'curl -fsSL https://app.factory.ai/cli | sh',
    status: 'title',
    prompt: { kind: 'argv' },
    resumeById: ['--resume', '{id}'],
    continueLatest: null,
    modelFlag: null
  }),
  amp: spec({
    id: 'amp',
    label: 'Amp',
    binary: 'amp',
    install: 'curl -fsSL https://ampcode.com/install.sh | bash',
    status: 'title',
    prompt: { kind: 'type' },
    resumeById: null,
    continueLatest: null,
    modelFlag: null
  }),
  kiro: spec({
    id: 'kiro',
    label: 'Kiro',
    binary: 'kiro-cli',
    install: 'curl -fsSL https://cli.kiro.dev/install | bash',
    status: 'title',
    prompt: { kind: 'argv' },
    resumeById: ['--resume-id', '{id}'],
    continueLatest: ['--resume'],
    modelFlag: null,
    baseArgs: ['chat', '--tui']
  }),
  crush: spec({
    id: 'crush',
    label: 'Crush',
    binary: 'crush',
    install: 'brew install charmbracelet/tap/crush',
    status: 'osc',
    prompt: { kind: 'type' },
    resumeById: ['--session', '{id}'],
    continueLatest: ['--continue'],
    modelFlag: null
  }),
  goose: spec({
    id: 'goose',
    label: 'Goose',
    binary: 'goose',
    install: 'brew install block-goose-cli',
    status: 'osc',
    prompt: { kind: 'type' },
    // A bare `goose session -r` resumes the most recent session of any folder: not used.
    resumeById: null,
    continueLatest: null,
    modelFlag: null,
    baseArgs: ['session']
  }),
  cline: spec({
    id: 'cline',
    label: 'Cline',
    binary: 'cline',
    install: 'npm install -g cline',
    status: 'title',
    // `cline "<task>"` runs it at once with auto-approve: the first message is typed instead.
    prompt: { kind: 'type' },
    resumeById: ['--id', '{id}'],
    continueLatest: null,
    modelFlag: '--model'
  }),
  antigravity: spec({
    id: 'antigravity',
    label: 'Antigravity',
    binary: 'agy',
    install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    status: 'title',
    prompt: { kind: 'flag', flag: '--prompt-interactive' },
    resumeById: ['--conversation', '{id}'],
    continueLatest: null,
    modelFlag: '--model'
  }),
  auggie: spec({
    id: 'auggie',
    label: 'Auggie',
    binary: 'auggie',
    install: 'npm install -g @augmentcode/auggie',
    status: 'title',
    prompt: { kind: 'argv' },
    resumeById: ['--resume', '{id}'],
    continueLatest: ['--continue'],
    modelFlag: '--model'
  }),
  codebuddy: spec({
    id: 'codebuddy',
    label: 'CodeBuddy',
    binary: 'codebuddy',
    install: 'npm install -g @tencent-ai/codebuddy-code',
    status: 'title',
    prompt: { kind: 'argv' },
    resumeById: ['--resume', '{id}'],
    continueLatest: ['--continue'],
    modelFlag: '--model'
  })
}

const AGENT_SET: ReadonlySet<string> = new Set(CLI_AGENTS)

export function isCliAgent(value: unknown): value is CliAgent {
  return typeof value === 'string' && AGENT_SET.has(value)
}

/** Claude Code and Codex: the two CLIs with plan usage, dispatch, background review and the send profiles. */
export type ClaudeOrCodex = 'claude' | 'codex'

export function claudeOrCodex(kind: string | null | undefined): ClaudeOrCodex | null {
  return kind === 'claude' || kind === 'codex' ? kind : null
}

/** The name a session of this kind shows ('终端' for a plain shell). */
export function agentName(kind: CliAgent | 'shell'): string {
  return kind === 'shell' ? '终端' : AGENT_SPECS[kind].label
}
