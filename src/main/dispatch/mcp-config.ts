// How each agent gets Wavi's dispatch MCP server for one launch (PRD F21, §6.14); nothing global is written (§6.2).
// The server is Wavi's own binary run as Node (ELECTRON_RUN_AS_NODE) on out/main/wavi-mcp.js.
import { tomlString } from '@shared/agent-launch'

export interface McpServerCommand {
  /** Wavi's executable (process.execPath). */
  command: string
  /** out/main/wavi-mcp.js */
  script: string
}

/** The hook environment the server relays with. Claude passes its whole environment to stdio servers; Codex only these. */
export const FORWARDED_ENV = ['TR_SESSION_ID', 'TR_HOOK_SOCK', 'TR_HOOK_TOKEN'] as const

/** Codex's default MCP tool timeout is 60 s; start_sessions waits for the user (and polls) for up to 15 minutes. */
const CODEX_TOOL_TIMEOUT_S = 16 * 60

/** The `--mcp-config` file for Claude: added to the user's own servers (never `--strict-mcp-config`). */
export function claudeMcpConfig(server: McpServerCommand): { mcpServers: Record<string, unknown> } {
  return {
    mcpServers: {
      wavi: { type: 'stdio', command: server.command, args: [server.script, '--agent', 'claude'], env: { ELECTRON_RUN_AS_NODE: '1' } }
    }
  }
}

/** `-c` overrides for Codex (each becomes its own `-c`). */
export function codexMcpOverrides(server: McpServerCommand): string[] {
  const array = (values: readonly string[]) => `[${values.map(tomlString).join(',')}]`
  return [
    `mcp_servers.wavi.command=${tomlString(server.command)}`,
    `mcp_servers.wavi.args=${array([server.script, '--agent', 'codex'])}`,
    `mcp_servers.wavi.env={ELECTRON_RUN_AS_NODE="1"}`,
    `mcp_servers.wavi.env_vars=${array(FORWARDED_ENV)}`,
    `mcp_servers.wavi.tool_timeout_sec=${CODEX_TOOL_TIMEOUT_S}`,
    // Codex asks before every MCP tool call by default (measured on 0.163). Starting sessions waits for Wavi's own
    // confirmation strip already, and the other tools only read or act on the caller's own sessions (like Claude's
    // `permissions.allow: mcp__wavi`).
    'mcp_servers.wavi.default_tools_approval_mode="approve"'
  ]
}
