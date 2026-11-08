// Drives one `pi --mode rpc` (PRD F23 v1.158; protocol: pi-mono modes/rpc @ ccbb224, as Paseo `27872a8` and T3 Code
// `6417151` drive it): `get_state` + `get_available_models` + `get_commands` at start, one `prompt` per message,
// `abort` to stop, `extension_ui_response` to answer a dialog. Pi has no approvals of its own: Wavi's extension
// (resources/hooks/wavi-pi-gui.js) confirms each call that is not read-only, and this driver answers 接受编辑's file
// changes and 总是允许's repeats itself. Model and thinking are launch arguments (rpc `set_model` would save them as
// Pi's defaults): a change restarts Pi on its conversation. Electron-free.

import { randomInt } from 'node:crypto'
import type { GuiAnswer, GuiConfigOption } from '@shared/gui-chat'
import { isRec, str, type DriverIO, type DriverOptions, type GuiDriver, type Rec } from './driver'
import { splitAttachments, withPaths } from './launch'
import { callKey, createPiNormalizer, PI_FILE_CHANGE_TOOLS, PI_LEVELS, piAnswerResponse, piCommands, piConfig, piModelValue, waviConfirm, type PiPicks } from './pi-rpc'

const HANDSHAKE_TIMEOUT_MS = 60_000

type Outcome = { ok: true; data: unknown } | { ok: false; message: string }

export function createPiDriver(io: DriverIO, options: DriverOptions): GuiDriver {
  const normalizer = createPiNormalizer(options.cwd)
  // Ids start at a random prefix per client: a reattached session's new client must not take the earlier one's answers.
  const prefix = `w${randomInt(1, 2 ** 31)}-`
  let next = 0
  const waiting = new Map<string, (outcome: Outcome) => void>()
  let models: unknown[] = []
  const picks: PiPicks = { ...(options.model ? { model: options.model } : {}), permission: options.permission === 'accept-edits' ? 'accept-edits' : 'ask' }
  let config: GuiConfigOption[] = []
  /** 总是允许: the same call again goes through for the rest of this process. */
  const allowed = new Set<string>()
  let sessionId: string | undefined
  let isReady = false
  /** The turn's error, from its last assistant message (agent_end carries none). */
  let turnError: string | undefined

  function request(type: string, fields: Rec = {}, timeoutMs?: number): Promise<Outcome> {
    const id = `${prefix}${next++}`
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined
      const done = (outcome: Outcome) => {
        if (timer) clearTimeout(timer)
        waiting.delete(id)
        resolve(outcome)
      }
      waiting.set(id, done)
      if (timeoutMs) timer = setTimeout(() => done({ ok: false, message: `${type} timed out` }), timeoutMs)
      if (!io.write({ id, type, ...fields })) done({ ok: false, message: 'the agent is not running' })
    })
  }

  const emitConfig = () => {
    config = piConfig(models, picks)
    // What piConfig settled on (the first model, the model's default level) is what Pi runs with.
    for (const option of config) {
      if (option.id === 'model') picks.model = option.current
      if (option.id === 'effort') picks.effort = option.current
    }
    io.emit([{ type: 'config', config }])
  }

  const takeState = (data: unknown) => {
    if (!isRec(data)) return
    const model = piModelValue(data.model)
    if (model) picks.model = model
    if (typeof data.thinkingLevel === 'string') picks.effort = data.thinkingLevel
    const id = str(data.sessionId)
    if (id && id !== sessionId) {
      sessionId = id
      io.agentSession(id)
    }
  }
  const takeModels = (data: unknown) => {
    if (isRec(data) && Array.isArray(data.models)) models = data.models
  }
  const takeCommands = (data: unknown) => {
    if (isRec(data)) io.emit([{ type: 'commands', commands: piCommands(data.commands) }])
  }

  async function handshake(): Promise<void> {
    const [state, list, commands] = await Promise.all([request('get_state', {}, HANDSHAKE_TIMEOUT_MS), request('get_available_models', {}, HANDSHAKE_TIMEOUT_MS), request('get_commands', {}, HANDSHAKE_TIMEOUT_MS)])
    if (!state.ok) {
      io.fail(`Pi 没有回应：${state.message}`)
      return
    }
    takeState(state.data)
    if (list.ok) takeModels(list.data)
    if (commands.ok) takeCommands(commands.data)
    emitConfig()
    if (!sessionId) {
      io.fail('Pi 没有返回会话 id')
      return
    }
    isReady = true
    io.ready()
  }

  /** 接受编辑 lets file changes through; 总是允许 the same call. */
  const allowedNow = (call: { tool: string; input: unknown }): boolean => (picks.permission === 'accept-edits' && PI_FILE_CHANGE_TOOLS.has(call.tool)) || allowed.has(callKey(call.tool, call.input))

  const respond = (id: string, fields: Rec): boolean => io.write({ type: 'extension_ui_response', id, ...fields })

  /** A model or thinking level is a launch argument: shown at once, then Pi restarts with it (reverted if it cannot). */
  async function relaunchWith(change: Partial<PiPicks>): Promise<boolean> {
    const before = { ...picks }
    Object.assign(picks, change)
    emitConfig()
    if (await io.relaunch({ permission: picks.permission, plan: false })) return true
    Object.assign(picks, before)
    emitConfig()
    return false
  }

  const imagesTaken = (): boolean => {
    const model = models.filter(isRec).find((m) => piModelValue(m) === picks.model)
    return Array.isArray(model?.input) && model.input.includes('image')
  }

  return {
    start() {
      void handshake()
    },

    line(message, replay) {
      if (message.type === 'response') {
        const id = str(message.id)
        const resolve = id ? waiting.get(id) : undefined
        if (resolve) {
          resolve(message.success === true ? { ok: true, data: message.data } : { ok: false, message: str(message.error) ?? 'error' })
          return
        }
        // The kept lines of a reattached session: the earlier client's answers, read by their command.
        if (replay && message.success === true) {
          if (message.command === 'get_state') takeState(message.data)
          if (message.command === 'get_available_models') takeModels(message.data)
          if (message.command === 'get_commands') takeCommands(message.data)
        }
        return
      }
      if (message.type === 'extension_ui_request') {
        const id = str(message.id)
        // Answered before the app quit: not asked again.
        if (!id || (replay && options.answered?.has(id))) return
        const call = waviConfirm(message)
        if (call && !replay && allowedNow(call)) {
          respond(id, { confirmed: true })
          return
        }
        io.emit(normalizer.request(message))
        return
      }
      if (message.type === 'message_end' && isRec(message.message) && message.message.role === 'assistant') {
        turnError = message.message.stopReason === 'error' ? (str(message.message.errorMessage) ?? 'Pi 出错了') : undefined
      }
      const events = normalizer.event(message)
      if (events.length > 0) io.emit(events)
      if (message.type === 'agent_end' && message.willRetry !== true) {
        if (!replay) io.turnEnd({ failed: turnError !== undefined, ...(turnError !== undefined ? { message: turnError } : {}) })
        turnError = undefined
      }
    },

    replayed() {
      if (sessionId) {
        if (models.length > 0) emitConfig()
        isReady = true
        io.ready()
      } else void handshake()
    },

    async send(text, attachments) {
      if (!isReady) return false
      const split = await splitAttachments(attachments, imagesTaken() ? io.image : null)
      const images = split.images.map((image) => ({ type: 'image', data: image.data, mimeType: image.mediaType }))
      io.emit([{ type: 'busy', busy: true }])
      void request('prompt', { message: withPaths(text, split.paths), ...(images.length > 0 ? { images } : {}) }).then((outcome) => {
        if (outcome.ok) return
        // Refused before it began: there is no agent_end to end it.
        io.emit(normalizer.failed(outcome.message))
        io.turnEnd({ failed: true, message: outcome.message })
      })
      return true
    },

    answer(answer: GuiAnswer) {
      const pending = normalizer.pending(answer.id)
      const response = pending ? piAnswerResponse(pending, answer) : undefined
      if (!pending || !response) return false
      if (!respond(answer.id, response)) return false
      if (pending.call && answer.kind === 'permission' && answer.optionId === 'always') allowed.add(callKey(pending.call.tool, pending.call.input))
      io.emit(normalizer.settle(answer.id))
      return true
    },

    interrupt() {
      if (!isReady) return false
      // Abort also cancels the dialogs' signal; answered here so none is left waiting.
      const dropped = normalizer.dropPrompts()
      for (const event of dropped) if (event.type === 'prompt-done') respond(event.id, { cancelled: true })
      if (dropped.length > 0) io.emit(dropped)
      void request('abort')
      return true
    },

    async setConfig(id, value) {
      const option = config.find((o) => o.id === id)
      if (!option || !option.values.some((v) => v.value === value)) return false
      if (option.current === value) return true
      if (id === 'permission') {
        const level = PI_LEVELS.find((l) => l === value)
        if (!level) return false
        picks.permission = level
        emitConfig()
        return true
      }
      // Another model has its own levels: piConfig keeps the level when the new model takes it.
      if (id === 'model') return relaunchWith({ model: value })
      if (id === 'effort') return relaunchWith({ effort: value })
      return false
    },

    closed() {
      for (const resolve of [...waiting.values()]) resolve({ ok: false, message: 'the agent is not running' })
      waiting.clear()
    }
  }
}
