// Which agents a GUI session can drive, and how (PRD F23 / §6.17). Claude and Codex speak their own protocols; the
// rest speak ACP, with the arguments the ACP registry lists for them
// (cdn.agentclientprotocol.com/registry/v1/latest/registry.json, read 2026-11-05). Pi and Amp need an adapter the
// user installs; Wavi never downloads one. Pure.

import type { CliAgent } from './agents'
import type { GuiProtocol } from './gui-chat'

export type GuiDriver =
  | { protocol: 'claude-stream' }
  | { protocol: 'codex-app-server' }
  /** The agent's own binary in ACP mode. */
  | { protocol: 'acp'; args: readonly string[]; env?: Readonly<Record<string, string>> }
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
  grok: { protocol: 'acp', args: ['agent', 'stdio'] },
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
