import { describe, expect, it } from 'vitest'
import { claudeMcpConfig, codexMcpOverrides } from './mcp-config'

const server = { command: '/Applications/Wavi.app/Contents/MacOS/Wavi', script: '/Applications/Wavi.app/Contents/Resources/app.asar/out/main/wavi-mcp.js' }

describe('dispatch MCP injection', () => {
  it('gives Claude a stdio server run by Wavi as Node', () => {
    expect(claudeMcpConfig(server)).toEqual({
      mcpServers: { wavi: { type: 'stdio', command: server.command, args: [server.script, '--agent', 'claude'], env: { ELECTRON_RUN_AS_NODE: '1' } } }
    })
  })

  it('gives Codex the same server, forwards the hook environment and lifts the tool timeout', () => {
    expect(codexMcpOverrides(server)).toEqual([
      `mcp_servers.wavi.command="${server.command}"`,
      `mcp_servers.wavi.args=["${server.script}","--agent","codex"]`,
      'mcp_servers.wavi.env={ELECTRON_RUN_AS_NODE="1"}',
      'mcp_servers.wavi.env_vars=["TR_SESSION_ID","TR_HOOK_SOCK","TR_HOOK_TOKEN"]',
      'mcp_servers.wavi.tool_timeout_sec=960'
    ])
  })
})
