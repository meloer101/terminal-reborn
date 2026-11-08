// Drives one long-lived `claude -p` over stream-json (PRD F23 / §6.17; message sequences in
// scripts/spikes/53-gui-claude-stream-lab.mjs): `initialize` and `get_settings` for the pickers and the `/` menu, user
// messages in, `can_use_tool` answered with `control_response`, `set_model` / `set_permission_mode` /
// `apply_flag_settings` for the pickers, `interrupt`. Its hooks still fire (§6.17), so status comes from them, not
// from here. Electron-free.

import type { GuiAnswer, GuiCommand, GuiConfigOption, GuiEvent } from '@shared/gui-chat'
import {
  claudeAnswerResponse,
  claudeConfig,
  claudeConfigRequest,
  claudeLevel,
  commandsOf,
  createClaudeStreamNormalizer,
  markSkills,
  type ClaudePickerState,
  type ClaudeStreamNormalizer
} from './claude-stream'
import { isRec, str, type DriverIO, type DriverOptions, type GuiDriver, type Rec } from './driver'
import { splitAttachments, withPaths } from './launch'

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
  // A saved level started with (launch.ts --permission-mode) is also where 计划 off returns to.
  const current: ClaudePickerState = { ...(options.model ? { model: options.model } : {}), ...(options.permission ? { level: options.permission } : {}) }
  let config: GuiConfigOption[] = []
  // The / menu (Figma 59H): the latest commands (initialize, commands_changed) and skills (each turn's system/init).
  let commands: GuiCommand[] = []
  let skills: ReadonlySet<string> = new Set()
  const commandsEvent = (list: GuiCommand[]): GuiEvent => {
    commands = list
    return { type: 'commands', commands: markSkills(list, skills) }
  }

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
    if (Array.isArray(response.commands)) io.emit([commandsEvent(commandsOf(response.commands))])
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
          // Answered before the app quit, its tool still running: not asked again.
          if (replay && requestId && options.answered?.has(requestId)) return
          const toolUseId = str(request.tool_use_id)
          if (toolUseId && requestId) asks.set(toolUseId, requestId)
          break
        }
        case 'system':
          if (message.subtype === 'init') {
            noteSession(message)
            if (Array.isArray(message.skills)) {
              const next = new Set(message.skills.filter((s): s is string => typeof s === 'string'))
              const changed = next.size !== skills.size || [...next].some((s) => !skills.has(s))
              skills = next
              if (changed && commands.length > 0) io.emit([commandsEvent(commands)])
            }
            const model = str(message.model)
            const mode = str(message.permissionMode)
            // Each turn's init names the resolved model (`claude-haiku-5-5`); the picker holds the alias (`haiku`).
            const chosen = (Array.isArray(init?.models) ? init.models : []).find((m) => isRec(m) && m.value === current.model)
            const sameModel = !model || model === current.model || (isRec(chosen) && chosen.resolvedModel === model)
            if (!sameModel || (mode && mode !== current.mode)) {
              if (model && !sameModel) current.model = model
              if (mode) current.mode = mode
              emitConfig()
            }
          }
          break
        case 'result':
          noteSession(message)
          // 快速 on but not serving: the turn's result says why (Figma 65 tooltip).
          if (current.fast && !replay) {
            const blocked = message.fast_mode_state === 'on' ? undefined : str(message.fast_mode_disabled_reason)
            if (blocked !== current.fastBlocked) {
              current.fastBlocked = blocked
              emitConfig()
            }
          }
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
      // commands_changed: marked with the skills known so far.
      const events = normalizer.push(message).map((e) => (e.type === 'commands' ? commandsEvent(e.commands) : e))
      if (events.length > 0) io.emit(events)
    },

    replayed() {
      if (init) becomeReady()
      else void handshake()
    },

    async send(text, attachments) {
      const split = await splitAttachments(attachments, io.image)
      const images = split.images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }))
      const body = withPaths(text, split.paths)
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
        current.level = claudeLevel(current.mode, undefined)
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
      // The level 计划 returns to: the one chosen before it (or before Claude was put in plan mode some other way).
      const mode = current.mode ?? str(init?.current_permission_mode)
      const level = claudeLevel(mode, current.level)
      // While planning, a level is only where 计划 off returns to.
      if (id === 'permission' && mode === 'plan' && option?.values.some((v) => v.value === value)) {
        current.level = value as ClaudePickerState['level']
        emitConfig()
        return true
      }
      const request = claudeConfigRequest(id, value, level)
      if (!option || !request || !option.values.some((v) => v.value === value)) return false
      const outcome = await control(request, 15_000)
      if (!outcome.ok) return false
      if (id === 'model') current.model = value
      else if (id === 'effort') current.effort = value
      else if (id === 'fast') {
        current.fast = value === 'on'
        current.fastBlocked = undefined
      }
      else if (isRec(request) && typeof request.mode === 'string') {
        current.level = id === 'permission' ? (value as ClaudePickerState['level']) : level
        current.mode = request.mode
      }
      emitConfig()
      return true
    },

    closed() {
      for (const resolve of [...pending.values()]) resolve({ ok: false, error: 'the agent is not running' })
      pending.clear()
    }
  }
}
