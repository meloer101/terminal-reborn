// Electron glue for dispatch (PRD F21): the per-launch MCP injection, hook-socket calls relayed to the window that owns
// the calling session, and reports delivered into a dispatcher through its agent's own channel (§6.14).
import { app, ipcMain, type WebContents } from 'electron'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DISPATCH_AGENTS, DISPATCH_IPC, isDispatchAgent, parseDeliverRequest, type DeliverResult, type DispatchAgent } from '@shared/dispatch'
import { executableOnPath, userLoginPath } from '../agents-installed'
import { sessionOwner, setDispatchHookHandler } from '../hooks'
import { getSettings } from '../settings'
import { DispatchBroker } from './broker'
import { codexQueue, writeInbox } from './deliver'
import { claudeMcpConfig, codexMcpOverrides, type McpServerCommand } from './mcp-config'

const broker = new DispatchBroker<WebContents>({
  ownerOf: (sessionId) => sessionOwner(sessionId),
  send: (owner, request) => {
    if (!owner.isDestroyed()) owner.send(DISPATCH_IPC.request, request)
  }
})

/** Wavi's binary running out/main/wavi-mcp.js as Node; the same paths in dev, in the linked app and packaged. */
function serverCommand(): McpServerCommand {
  return { command: process.execPath, script: join(__dirname, 'wavi-mcp.js') }
}

let configDir: string | null = null

/** `<userData>/dispatch/wavi-mcp.json`, (re)written when missing or different. A stable path, like the hook settings. */
function claudeConfigPath(): string | null {
  try {
    configDir ??= join(app.getPath('userData'), 'dispatch')
    const path = join(configDir, 'wavi-mcp.json')
    const content = JSON.stringify(claudeMcpConfig(serverCommand()), null, 2)
    let current = ''
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      // Written below.
    }
    if (current !== content) {
      mkdirSync(configDir, { recursive: true, mode: 0o700 })
      writeFileSync(path, content, { mode: 0o600 })
      chmodSync(path, 0o600)
    }
    return path
  } catch (error) {
    console.error('[dispatch] could not write the MCP config:', error)
    return null
  }
}

/** What an agent launch adds for dispatch: nothing when the user turned it off (设置 · 自动化 · 派活). */
export function dispatchLaunchFor(agent: DispatchAgent): { mcpConfigPath?: string; codexOverrides?: string[] } {
  if (!getSettings().dispatch.tools) return {}
  if (agent === 'claude') {
    const path = claudeConfigPath()
    return path ? { mcpConfigPath: path } : {}
  }
  return { codexOverrides: codexMcpOverrides(serverCommand()) }
}

async function deliver(raw: unknown, sender: WebContents): Promise<DeliverResult> {
  const request = parseDeliverRequest(raw)
  if (!request || sessionOwner(request.sessionId) !== sender) return 'failed'
  switch (DISPATCH_AGENTS[request.agent].report) {
    case 'claude-inbox': {
      const inbox = broker.inboxOf(request.sessionId)
      if (!inbox) return 'no-channel'
      return (await writeInbox(inbox, request.text)) ? 'delivered' : 'failed'
    }
    case 'codex-queue': {
      if (!request.agentSessionId) return 'no-channel'
      const path = await userLoginPath()
      const codex = path ? executableOnPath(path, 'codex') : null
      if (!path || !codex) return 'no-channel'
      return (await codexQueue(codex, path, request.agentSessionId, request.text)) ? 'delivered' : 'failed'
    }
    default:
      return 'no-channel'
  }
}

export function registerDispatchHandlers(): void {
  setDispatchHookHandler((request) => (isDispatchAgent(request.agent) ? broker.handle(request.event, request.sessionId, request.agent, request.payload) : Promise.resolve('')))
  ipcMain.on(DISPATCH_IPC.reply, (event, callId: unknown, result: unknown) => {
    if (typeof callId === 'string' && callId.length <= 64) broker.answer(event.sender, callId, result)
  })
  ipcMain.handle(DISPATCH_IPC.deliver, (event, raw: unknown) => deliver(raw, event.sender))
}
