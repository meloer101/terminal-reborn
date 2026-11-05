// Drives one ACP agent over JSON-RPC 2.0 (PRD F23 / §6.17; handshake in scripts/spikes/55-gui-acp-handshake-lab.mjs):
// `initialize`, `session/new` or `session/load`, one `session/prompt` per message (its response ends the turn),
// `session/cancel` to interrupt, `session/request_permission` answered with the chosen option. Wavi offers no file
// system or terminal to the agent: those requests get -32601. Figma 56: 权限 is Wavi's — 询问 asks every request,
// 接受编辑 answers those that change files itself; 自动 and 计划 come from a launch argument (Grok, a restart) or
// the agent's own plan mode. Electron-free.

import type { GuiAnswer, GuiConfigOption, GuiPermission } from '@shared/gui-chat'
import { acpAnswerResult, acpAutoAllow, acpConfig, acpConfigRequest, acpPickers, acpPlanValue, createAcpNormalizer, type AcpPickerState } from './acp'
import { isRec, isResponse, isServerRequest, RpcClient, str, type DriverIO, type DriverOptions, type GuiDriver, type Rec } from './driver'
import { splitAttachments, withPaths } from './launch'

const HANDSHAKE_TIMEOUT_MS = 60_000
const UPDATES_THAT_RUN = new Set(['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan'])

export function createAcpDriver(io: DriverIO, options: DriverOptions & { label: string }): GuiDriver {
  const normalizer = createAcpNormalizer(options.cwd)
  const rpc = new RpcClient(io.write, true)
  const requestIds = new Map<string, unknown>()
  let sessionId: string | undefined
  /** The pickers as the agent reports them, and as shown (acpPickers). */
  let agentConfig: GuiConfigOption[] = []
  let config: GuiConfigOption[] = []
  const launch = options.launchPermission
  const picks: AcpPickerState = {
    levels: ['ask', 'accept-edits', ...(launch?.auto ? (['auto'] as const) : [])],
    permission: options.permission ?? 'ask',
    ...(launch?.plan ? { launchPlan: options.plan ?? false } : {})
  }
  const showConfig = () => {
    config = acpPickers(agentConfig, picks)
    io.emit([{ type: 'config', config }])
  }
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
    agentConfig = acpConfig(result)
    showConfig()
  }

  const takeCapabilities = (result: Rec) => {
    const caps = isRec(result.agentCapabilities) ? result.agentCapabilities : {}
    loadSession = caps.loadSession === true
    images = isRec(caps.promptCapabilities) && caps.promptCapabilities.image === true
  }

  const ready = async () => {
    // A model asked for at launch (F21 dispatch, 新建会话) is set once the agent says it offers it.
    const model = agentConfig.find((o) => o.category === 'model')
    if (options.model && model && model.current !== options.model && model.values.some((v) => v.value === options.model)) await setOption(model, options.model)
    // 计划 saved on (Figma 56) for an agent whose plan is its own mode: back into it.
    if (options.plan && picks.launchPlan === undefined) await setPlan(true)
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
      agentConfig = agentConfig.map((o) => (o.id === option.id ? { ...o, current: value } : o))
      showConfig()
    }
    return true
  }

  async function setPermission(value: string): Promise<boolean> {
    const level = picks.levels.find((l) => l === value)
    if (!level) return false
    // 自动 is a launch argument; 询问 and 接受编辑 share one (Wavi tells them apart): only crossing 自动 restarts, and
    // not while planning (the plan argument holds; the level is where 计划 off returns to).
    if (launch && !picks.launchPlan && (level === 'auto') !== (picks.permission === 'auto')) return io.relaunch({ permission: level, plan: false })
    picks.permission = level
    showConfig()
    return true
  }

  async function setPlan(on: boolean): Promise<boolean> {
    if (picks.launchPlan !== undefined) return on === picks.launchPlan || io.relaunch({ permission: picks.permission as GuiPermission, plan: on })
    const mode = agentConfig.find((o) => o.category === 'mode')
    const planValue = acpPlanValue(mode)
    if (!mode || !planValue) return false
    if (on) {
      if (mode.current !== planValue) picks.modeBefore = mode.current
      return mode.current === planValue || setOption(mode, planValue)
    }
    const back = mode.values.find((v) => v.value === picks.modeBefore && v.value !== planValue) ?? mode.values.find((v) => v.value !== planValue)
    return mode.current !== planValue || (back ? setOption(mode, back.value) : false)
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
        agentConfig = agentConfig.map((o) => (o.category === 'mode' ? { ...o, current: mode } : o))
        showConfig()
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
        // Answered before the app quit (the turn has not ended yet): not asked again.
        if (replay && options.answered?.has(id)) return
        // 接受编辑: a change to files goes through without asking.
        const allowed = replay ? null : acpAutoAllow(params, picks.permission)
        if (allowed) {
          rpc.respond(message.id, { outcome: { outcome: 'selected', optionId: allowed } })
          io.emit(normalizer.allowed(params))
          return
        }
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
      const split = await splitAttachments(attachments, images ? io.image : null)
      const blocks: Rec[] = split.images.map((image) => ({ type: 'image', mimeType: image.mediaType, data: image.data }))
      const body = withPaths(text, split.paths)
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
      if (id === 'permission') return setPermission(value)
      if (id === 'plan') return setPlan(value === 'on')
      const option = agentConfig.find((o) => o.id === id)
      if (!option || !option.values.some((v) => v.value === value)) return false
      return setOption(option, value)
    },

    closed() {
      rpc.failAll('the agent is not running')
    }
  }
}
