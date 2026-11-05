// Drives one long-lived `claude -p` over stream-json (PRD F23 / §6.17; message sequences in
// scripts/spikes/53-gui-claude-stream-lab.mjs): `initialize` and `get_settings` for the pickers and the `/` menu, user
// messages in, `can_use_tool` answered with `control_response`, `set_model` / `set_permission_mode` /
// `apply_flag_settings` for the pickers, `interrupt`. Its hooks still fire (§6.17), so status comes from them, not
// from here. Electron-free.

import type { GuiAnswer, GuiConfigOption } from '@shared/gui-chat'
import { claudeAnswerResponse, claudeConfig, claudeConfigRequest, commandsOf, createClaudeStreamNormalizer, type ClaudeStreamNormalizer } from './claude-stream'
import { isRec, str, type DriverIO, type DriverOptions, type GuiDriver, type Rec } from './driver'
import { isImagePath, withPaths } from './launch'

type ControlOutcome = { ok: true; response: Rec } | { ok: false; error: string }

const INIT_TIMEOUT_MS = 60_000

export function createClaudeDriver(io: DriverIO, options: DriverOptions): GuiDriver {
  const normalizer: ClaudeStreamNormalizer = createClaudeStreamNormalizer(options.cwd)
  const pending = new Map<string, (outcome: ControlOutcome) => void>()
  /** `tool_use_id` → the `can_use_tool` request asking for it: a tool result answers it (seen on replay). */
  const asks = new Map<string, string>()
  let n = 0
  let init: Rec | null = null
  let isReady = false
  let sessionId: string | undefined
  const current: { model?: string; effort?: string; mode?: string } = options.model ? { model: options.model } : {}
  let config: GuiConfigOption[] = []

  const control = (request: Rec, timeoutMs?: number): Promise<ControlOutcome> =>
    new Promise((resolve) => {
      const id = `wavi-${Date.now().toString(36)}-${++n}`
      let timer: NodeJS.Timeout | undefined
      const done = (outcome: ControlOutcome) => {
        if (timer) clearTimeout(timer)
        pending.delete(id)
        resolve(outcome)
      }
      pending.set(id, done)
      if (timeoutMs) timer = setTimeout(() => done({ ok: false, error: `${String(request.subtype)} timed out` }), timeoutMs)
      if (!io.write({ type: 'control_request', request_id: id, request })) done({ ok: false, error: 'the agent is not running' })
    })

  const emitConfig = () => {
    if (!init) return
    config = claudeConfig(init, current)
    io.emit([{ type: 'config', config }])
  }

  const takeInit = (response: Rec) => {
    init = response
    if (Array.isArray(response.commands)) io.emit([{ type: 'commands', commands: commandsOf(response.commands) }])
    emitConfig()
  }

  const settingsEffort = (response: Rec): string | undefined => {
    // Claude 2.1.317 answers `{ effective, sources, applied }`; `effective` is what the session runs with (§6.17).
    const settings = isRec(response.effective) ? response.effective : isRec(response.settings) ? response.settings : response
    return str(settings.effortLevel) ?? str(settings.effort)
  }

  const becomeReady = () => {
    if (isReady) return
    isReady = true
    io.ready()
  }

  async function handshake(): Promise<void> {
    const outcome = await control({ subtype: 'initialize' }, INIT_TIMEOUT_MS)
    if (!outcome.ok) {
      io.fail(`Claude 没有完成初始化：${outcome.error}`)
      return
    }
    takeInit(outcome.response)
    // The effort the user set (settings, flags) is not in `initialize`; an older Claude may not know get_settings.
    const settings = await control({ subtype: 'get_settings' }, 10_000)
    if (settings.ok) {
      const effort = settingsEffort(settings.response)
      if (effort) current.effort = effort
      emitConfig()
    }
    becomeReady()
  }

  function controlResponse(message: Rec, replay: boolean): void {
    const response = isRec(message.response) ? message.response : {}
    const id = str(response.request_id)
    const resolve = id ? pending.get(id) : undefined
    const body = isRec(response.response) ? response.response : {}
    if (resolve) {
      resolve(response.subtype === 'success' ? { ok: true, response: body } : { ok: false, error: str(response.error) ?? 'error' })
      return
    }
    // A reattached session: the earlier run's `initialize` answer is among the kept lines.
    if (replay && response.subtype === 'success' && Array.isArray(body.commands) && Array.isArray(body.models)) takeInit(body)
  }

  function noteSession(message: Rec): void {
    const id = str(message.session_id)
    if (id && id !== sessionId) {
      sessionId = id
      io.agentSession(id)
    }
  }

  /** Tool results in a user message settle the asks for those calls (they were answered before we saw them). */
  function settleAnswered(message: Rec): void {
    const content = isRec(message.message) && Array.isArray(message.message.content) ? message.message.content : []
    for (const block of content) {
      if (!isRec(block) || block.type !== 'tool_result') continue
      const requestId = asks.get(str(block.tool_use_id) ?? '')
      if (!requestId) continue
      asks.delete(str(block.tool_use_id)!)
      io.emit(normalizer.settle(requestId))
    }
  }

  /** A replayed message the user typed (not a tool result): a turn was running from here. */
  function isUserTurn(message: Rec): boolean {
    if (typeof message.parent_tool_use_id === 'string') return false
    const content = isRec(message.message) ? message.message.content : undefined
    if (typeof content === 'string') return content.trim() !== ''
    return Array.isArray(content) && content.some((b) => isRec(b) && (b.type === 'text' || b.type === 'image'))
  }

  return {
    start() {
      void handshake()
    },

    line(message, replay) {
      switch (message.type) {
        case 'control_response':
          controlResponse(message, replay)
          return
        case 'control_request': {
          const request = isRec(message.request) ? message.request : {}
          const requestId = str(message.request_id)
          if (request.subtype !== 'can_use_tool') {
            // Hook callbacks and SDK MCP servers are not registered by Wavi: nothing else should ask.
            if (requestId && !replay) io.write({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: 'not supported by Wavi' } })
            return
          }
          const toolUseId = str(request.tool_use_id)
          if (toolUseId && requestId) asks.set(toolUseId, requestId)
          break
        }
        case 'system':
          if (message.subtype === 'init') {
            noteSession(message)
            const model = str(message.model)
            const mode = str(message.permissionMode)
            if ((model && model !== current.model) || (mode && mode !== current.mode)) {
              if (model) current.model = model
              if (mode) current.mode = mode
              emitConfig()
            }
          }
          break
        case 'result':
          noteSession(message)
          if (!replay) {
            // An interrupt ends the turn with `error_during_execution`: stopped by the user, not failed.
            const failed = message.is_error === true && message.subtype !== 'error_during_execution'
            io.turnEnd({ failed, ...(failed && str(message.result) ? { message: str(message.result)! } : {}) })
          }
          break
        case 'user':
          settleAnswered(message)
          if (replay && isUserTurn(message)) io.emit([{ type: 'busy', busy: true }])
          break
      }
      const events = normalizer.push(message)
      if (events.length > 0) io.emit(events)
    },

    replayed() {
      if (init) becomeReady()
      else void handshake()
    },

    async send(text, attachments) {
      const images: Rec[] = []
      const paths: string[] = []
      for (const path of attachments) {
        const image = isImagePath(path) ? await io.image(path) : null
        if (image) images.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })
        else paths.push(path)
      }
      const body = withPaths(text, paths)
      const content = images.length === 0 ? body : [...(body ? [{ type: 'text', text: body }] : []), ...images]
      return io.write({ type: 'user', message: { role: 'user', content } })
    },

    answer(answer: GuiAnswer) {
      const ask = normalizer.pending(answer.id)
      if (!ask) return false
      const response = claudeAnswerResponse(ask, answer)
      if (!io.write({ type: 'control_response', response: { subtype: 'success', request_id: ask.requestId, response } })) return false
      for (const [toolUseId, requestId] of asks) if (requestId === ask.requestId) asks.delete(toolUseId)
      io.emit(normalizer.settle(answer.id))
      // Approving a plan switches the permission mode for the rest of the session.
      if (answer.kind === 'plan' && answer.decision !== 'keep-planning') {
        current.mode = answer.decision === 'approve-auto' ? 'acceptEdits' : 'default'
        emitConfig()
      }
      return true
    },

    interrupt() {
      if (!isReady) return false
      void control({ subtype: 'interrupt' })
      return true
    },

    async setConfig(id, value) {
      const option = config.find((o) => o.id === id)
      const request = claudeConfigRequest(id, value)
      if (!option || !request || !option.values.some((v) => v.value === value)) return false
      const outcome = await control(request, 15_000)
      if (!outcome.ok) return false
      if (id === 'model') current.model = value
      else if (id === 'mode') current.mode = value
      else if (id === 'effort') current.effort = value
      emitConfig()
      return true
    },

    closed() {
      for (const resolve of [...pending.values()]) resolve({ ok: false, error: 'the agent is not running' })
      pending.clear()
    }
  }
}
