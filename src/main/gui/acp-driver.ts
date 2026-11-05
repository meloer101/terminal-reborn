// Drives one ACP agent over JSON-RPC 2.0 (PRD F23 / §6.17; handshake in scripts/spikes/55-gui-acp-handshake-lab.mjs):
// `initialize`, `session/new` or `session/load`, one `session/prompt` per message (its response ends the turn),
// `session/cancel` to interrupt, `session/request_permission` answered with the chosen option. Wavi offers no file
// system or terminal to the agent: those requests get -32601. Electron-free.

import type { GuiAnswer, GuiConfigOption } from '@shared/gui-chat'
import { acpAnswerResult, acpConfig, acpConfigRequest, createAcpNormalizer } from './acp'
import { isRec, isResponse, isServerRequest, RpcClient, str, type DriverIO, type DriverOptions, type GuiDriver, type Rec } from './driver'
import { isImagePath, withPaths } from './launch'

const HANDSHAKE_TIMEOUT_MS = 60_000
const UPDATES_THAT_RUN = new Set(['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan'])

export function createAcpDriver(io: DriverIO, options: DriverOptions & { label: string }): GuiDriver {
  const normalizer = createAcpNormalizer(options.cwd)
  const rpc = new RpcClient(io.write, true)
  const requestIds = new Map<string, unknown>()
  let sessionId: string | undefined
  let config: GuiConfigOption[] = []
  let viaConfigOptions = false
  let images = false
  let loadSession = false
  let isReady = false
  let sent = 0
  /** A reattached session: updates of a turn arrived after the last `stopReason` (it is still running). */
  let replayBusy = false

  const takeSession = (result: Rec, id: string | undefined) => {
    if (!id) return false
    sessionId = id
    io.agentSession(id)
    takeConfig(result)
    return true
  }

  const takeConfig = (result: Rec) => {
    viaConfigOptions = Array.isArray(result.configOptions) && result.configOptions.length > 0
    config = acpConfig(result)
    io.emit([{ type: 'config', config }])
  }

  const takeCapabilities = (result: Rec) => {
    const caps = isRec(result.agentCapabilities) ? result.agentCapabilities : {}
    loadSession = caps.loadSession === true
    images = isRec(caps.promptCapabilities) && caps.promptCapabilities.image === true
  }

  const ready = async () => {
    // A model asked for at launch (F21 dispatch, 新建会话) is set once the agent says it offers it.
    const model = config.find((o) => o.category === 'model')
    if (options.model && model && model.current !== options.model && model.values.some((v) => v.value === options.model)) await setOption(model, options.model)
    isReady = true
    io.ready()
  }

  async function handshake(): Promise<void> {
    const init = await rpc.request(
      'initialize',
      { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'wavi', title: 'Wavi', version: options.clientVersion } },
      HANDSHAKE_TIMEOUT_MS
    )
    if (!init.ok) {
      io.fail(`${options.label} 没有完成初始化：${init.message}`)
      return
    }
    if (isRec(init.result)) takeCapabilities(init.result)
    if (options.resume && loadSession) {
      const loaded = await rpc.request('session/load', { sessionId: options.resume, cwd: options.cwd, mcpServers: [] }, HANDSHAKE_TIMEOUT_MS)
      if (loaded.ok && takeSession(isRec(loaded.result) ? loaded.result : {}, options.resume)) {
        // The replayed conversation's last block has no end of its own: close it like a finished turn.
        io.emit(normalizer.promptDone(undefined))
        await ready()
        return
      }
    }
    const created = await rpc.request('session/new', { cwd: options.cwd, mcpServers: [] }, HANDSHAKE_TIMEOUT_MS)
    const result = created.ok && isRec(created.result) ? created.result : null
    if (!result || !takeSession(result, str(result.sessionId))) {
      // -32000 "Authentication required" (ACP): the agent's own login is needed first.
      const login = !created.ok && /auth/i.test(created.message)
      io.fail(login ? `${options.label} 还没有登录：先在终端里运行它登录一次` : `${options.label} 没能开始对话：${created.ok ? '没有返回 sessionId' : created.message}`)
      return
    }
    await ready()
  }

  async function setOption(option: GuiConfigOption, value: string): Promise<boolean> {
    if (!sessionId) return false
    const { method, params } = acpConfigRequest(sessionId, option, value, viaConfigOptions)
    const outcome = await rpc.request(method, params, 15_000)
    if (!outcome.ok) return false
    const result = isRec(outcome.result) ? outcome.result : {}
    if (Array.isArray(result.configOptions)) takeConfig(result)
    else {
      config = config.map((o) => (o.id === option.id ? { ...o, current: value } : o))
      io.emit([{ type: 'config', config }])
    }
    return true
  }

  function turnDone(stopReason: string | undefined, error?: string): void {
    io.emit(normalizer.promptDone(stopReason))
    if (error) io.turnEnd({ failed: true, message: error })
    else io.turnEnd({ failed: stopReason === 'refusal', ...(stopReason === 'refusal' ? { message: `${options.label} 拒绝了这个请求` } : {}) })
  }

  function update(update: Rec, replay: boolean): void {
    if (update.sessionUpdate === 'config_option_update' && Array.isArray(update.configOptions)) {
      takeConfig({ configOptions: update.configOptions })
      return
    }
    if (update.sessionUpdate === 'current_mode_update') {
      const mode = str(update.currentModeId)
      if (mode) {
        config = config.map((o) => (o.category === 'mode' ? { ...o, current: mode } : o))
        io.emit([{ type: 'config', config }])
      }
      return
    }
    if (replay && UPDATES_THAT_RUN.has(str(update.sessionUpdate) ?? '') && !replayBusy) {
      replayBusy = true
      io.emit([{ type: 'busy', busy: true }])
    }
    const events = normalizer.update(update)
    if (events.length > 0) io.emit(events)
  }

  return {
    start() {
      void handshake()
    },

    line(message, replay) {
      if (rpc.handle(message)) return
      if (isResponse(message)) {
        // The kept lines of a reattached session: the earlier run's answers, read by their shape.
        const result = isRec(message.result) ? message.result : null
        if (result && replay) {
          if (isRec(result.agentCapabilities)) takeCapabilities(result)
          if (str(result.sessionId) && !sessionId) takeSession(result, str(result.sessionId))
        }
        // A prompt the earlier run sent ends here, also live after a reattach.
        if (result && typeof result.stopReason === 'string') {
          replayBusy = false
          if (replay) io.emit(normalizer.promptDone(result.stopReason))
          else turnDone(result.stopReason)
        }
        return
      }
      const method = str(message.method)
      if (!method) return
      const params = isRec(message.params) ? message.params : {}
      if (isServerRequest(message)) {
        if (method !== 'session/request_permission') {
          if (!replay) rpc.respondError(message.id, -32601, `${method} is not supported by Wavi`)
          return
        }
        const id = String(message.id)
        requestIds.set(id, message.id)
        io.emit(normalizer.request(id, params))
        return
      }
      if (method === 'session/update' && isRec(params.update)) update(params.update, replay)
    },

    replayed() {
      if (sessionId) {
        isReady = true
        io.ready()
      } else void handshake()
    },

    async send(text, attachments) {
      if (!sessionId) return false
      const blocks: Rec[] = []
      const paths: string[] = []
      for (const path of attachments) {
        const image = images && isImagePath(path) ? await io.image(path) : null
        if (image) blocks.push({ type: 'image', mimeType: image.mediaType, data: image.data })
        else paths.push(path)
      }
      const body = withPaths(text, paths)
      io.emit(normalizer.sent(`u-sent-${++sent}`, body, blocks.length))
      const id = sessionId
      void rpc.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: body }, ...blocks] }).then((outcome) => {
        if (outcome.ok) turnDone(isRec(outcome.result) ? str(outcome.result.stopReason) : undefined)
        else turnDone(undefined, outcome.message)
      })
      return true
    },

    answer(answer: GuiAnswer) {
      const pending = normalizer.pending(answer.id)
      const rawId = requestIds.get(answer.id)
      if (!pending || rawId === undefined) return false
      if (!rpc.respond(rawId, acpAnswerResult(pending, answer))) return false
      requestIds.delete(answer.id)
      io.emit(normalizer.settle(answer.id))
      return true
    },

    interrupt() {
      if (!isReady || !sessionId) return false
      // Pending permission requests must be answered `cancelled` (ACP prompt-turn cancellation).
      for (const [id, rawId] of requestIds) {
        rpc.respond(rawId, { outcome: { outcome: 'cancelled' } })
        io.emit(normalizer.settle(id))
      }
      requestIds.clear()
      return rpc.notify('session/cancel', { sessionId })
    },

    async setConfig(id, value) {
      const option = config.find((o) => o.id === id)
      if (!option || !option.values.some((v) => v.value === value)) return false
      return setOption(option, value)
    },

    closed() {
      rpc.failAll('the agent is not running')
    }
  }
}
