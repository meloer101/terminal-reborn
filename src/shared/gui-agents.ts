// Which agents a GUI session can drive, and how (PRD F23 / §6.17). Claude and Codex speak their own protocols; the
// rest speak ACP, with the arguments the ACP registry lists for them
// (cdn.agentclientprotocol.com/registry/v1/latest/registry.json, read 2026-11-05). Pi and Amp need an adapter the
// user installs; Wavi never downloads one. Pure.

import type { CliAgent } from './agents'
import type { GuiPermission, GuiProtocol } from './gui-chat'

/**
 * An ACP agent whose own permission mode is a launch argument (Figma 56): the arguments before its ACP ones for 询问
 * (also 接受编辑, which Wavi answers), for 自动 when it has its own, and for 计划 when it has a plan mode. Changing one
 * restarts the agent on its conversation.
 */
export interface GuiLaunchPermission {
  ask: readonly string[]
  auto?: readonly string[]
  plan?: readonly string[]
}

export type GuiDriver =
  | { protocol: 'claude-stream' }
  | { protocol: 'codex-app-server' }
  /** The agent's own binary in ACP mode. */
  | { protocol: 'acp'; args: readonly string[]; env?: Readonly<Record<string, string>>; launchPermission?: GuiLaunchPermission }
  /** A separate ACP adapter for the agent. */
  | { protocol: 'acp'; adapter: { binary: string; args: readonly string[]; install: string } }

/** Why an agent has no GUI, shown on hover over the disabled GUI segment (Figma 49″B). */
export const NO_GUI_REASON: Partial<Record<CliAgent, string>> = {
  crush: 'Crush 没有 ACP，只能用 CLI',
  antigravity: 'Antigravity 的 ACP 服务要另外下载，Wavi 还不支持'
}

export const AGENT_GUI: Readonly<Record<CliAgent, GuiDriver | null>> = {
  claude: { protocol: 'claude-stream' },
  codex: { protocol: 'codex-app-server' },
  opencode: { protocol: 'acp', args: ['acp'] },
  gemini: { protocol: 'acp', args: ['--acp'] },
  qwen: { protocol: 'acp', args: ['--acp', '--experimental-skills'] },
  pi: { protocol: 'acp', adapter: { binary: 'pi-acp', args: [], install: 'npm install -g pi-acp' } },
  copilot: { protocol: 'acp', args: ['--acp'] },
  cursor: { protocol: 'acp', args: ['acp'] },
  // `grok --help`: --permission-mode default | acceptEdits | auto | dontAsk | bypassPermissions | plan (2026-11-05).
  grok: {
    protocol: 'acp',
    args: ['agent', 'stdio'],
    launchPermission: { ask: ['--permission-mode', 'default'], auto: ['--permission-mode', 'auto'], plan: ['--permission-mode', 'plan'] }
  },
  kimi: { protocol: 'acp', args: ['acp'] },
  droid: { protocol: 'acp', args: ['exec', '--output-format', 'acp-daemon'], env: { DROID_DISABLE_AUTO_UPDATE: 'true' } },
  amp: { protocol: 'acp', adapter: { binary: 'amp-acp', args: [], install: 'npm install -g amp-acp' } },
  kiro: { protocol: 'acp', args: ['acp', '--agent-engine=v3'] },
  crush: null,
  goose: { protocol: 'acp', args: ['acp'] },
  cline: { protocol: 'acp', args: ['--acp'] },
  antigravity: null,
  auggie: { protocol: 'acp', args: ['--acp'], env: { AUGMENT_DISABLE_AUTO_UPDATE: '1' } },
  codebuddy: { protocol: 'acp', args: ['--acp'] }
}

/** The launch arguments for a permission level and 计划 (an agent with launchPermission); none otherwise. */
export function launchPermissionArgs(agent: CliAgent, permission: GuiPermission | undefined, plan: boolean | undefined): readonly string[] {
  const driver = AGENT_GUI[agent]
  const spec = driver?.protocol === 'acp' && 'launchPermission' in driver ? driver.launchPermission : undefined
  if (!spec) return []
  if (plan && spec.plan) return spec.plan
  return permission === 'auto' && spec.auto ? spec.auto : spec.ask
}

/** What an ACP agent's launch arguments allow (the driver offers 自动 / 计划 only then); undefined without any. */
export function launchPermissionOf(agent: CliAgent): { auto: boolean; plan: boolean } | undefined {
  const driver = AGENT_GUI[agent]
  const spec = driver?.protocol === 'acp' && 'launchPermission' in driver ? driver.launchPermission : undefined
  return spec ? { auto: !!spec.auto, plan: !!spec.plan } : undefined
}

export function guiProtocolOf(agent: CliAgent): GuiProtocol | null {
  return AGENT_GUI[agent]?.protocol ?? null
}

/** The binary a GUI session of this agent runs: the agent's own, or its adapter. */
export function guiBinary(agent: CliAgent, agentBinary: string): string {
  const driver = AGENT_GUI[agent]
  return driver?.protocol === 'acp' && 'adapter' in driver ? driver.adapter.binary : agentBinary
}

/** What 「界面」 shows for an agent (Figma 49″A / B): GUI available, GUI after installing an adapter, or CLI only. */
export type GuiAvailability = { kind: 'available' } | { kind: 'needs-adapter'; binary: string; install: string } | { kind: 'cli-only'; reason: string }

export function guiAvailability(agent: CliAgent, installed: (binary: string) => boolean): GuiAvailability {
  const driver = AGENT_GUI[agent]
  if (!driver) return { kind: 'cli-only', reason: NO_GUI_REASON[agent] ?? '这个智能体只能用 CLI' }
  if (driver.protocol === 'acp' && 'adapter' in driver && !installed(driver.adapter.binary)) {
    return { kind: 'needs-adapter', binary: driver.adapter.binary, install: driver.adapter.install }
  }
  return { kind: 'available' }
}
