// Drives one `codex app-server` over JSON-RPC (PRD F23 / §6.17; sequences in
// scripts/spikes/54-gui-codex-app-server-lab.mjs): `initialize` + `initialized`, `model/list`, `thread/start` or
// `thread/resume`, one `turn/start` per message, approvals answered as responses to the server's requests,
// `turn/interrupt`. Model, effort and the permission level (approval policy and reviewer) go with each `turn/start`.
// Electron-free.

import type { GuiAnswer, GuiConfigOption, GuiPermission } from '@shared/gui-chat'
import { CODEX_APPROVAL, codexAnswerResult, codexConfig, codexTurnParams, createCodexNormalizer, isCodexLevel } from './codex-app-server'
import { isRec, isResponse, isServerRequest, RpcClient, str, type DriverIO, type DriverOptions, type GuiDriver, type Rec } from './driver'
import { isImagePath, withPaths } from './launch'

const HANDSHAKE_TIMEOUT_MS = 60_000

export function createCodexDriver(io: DriverIO, options: DriverOptions): GuiDriver {
  const normalizer = createCodexNormalizer(options.cwd)
  const rpc = new RpcClient(io.write, false)
  /** Prompt id → the server request's own id (number or string), to answer with. */
  const requestIds = new Map<string, unknown>()
  let models: unknown[] = []
  const current: { model?: string; effort?: string; permission?: GuiPermission } = { ...(options.model ? { model: options.model } : {}), permission: options.permission ?? 'accept-edits' }
  let config: GuiConfigOption[] = []
  let threadId: string | undefined
  /** 自动 sent `approvalsReviewer: auto_review` on this thread: later turns at another level send `user`. */
  let reviewerSet = false
  let turnId: string | undefined
  let interruptWanted = false
  let isReady = false

  const emitConfig = () => {
    config = codexConfig(models, current)
    // What codexConfig settled on (the default model, its default effort) is what the next turn sends.
    for (const option of config) {
      if (option.id === 'model' && option.current) current.model = option.current
      if (option.id === 'effort') current.effort = option.current
    }
    io.emit([{ type: 'config', config }])
  }

  const takeThread = (thread: unknown) => {
    const id = isRec(thread) ? str(thread.id) : undefined
    if (!id) return false
    threadId = id
    io.agentSession(id)
    // A resumed thread keeps the name it was given (by the Codex TUI, or `thread/name/set` from another client).
    const name = isRec(thread) ? str(thread.name) : undefined
    if (name) io.title(name)
    return true
  }

  const interrupt = () => {
    if (!threadId || !turnId) return
    interruptWanted = false
    void rpc.request('turn/interrupt', { threadId, turnId })
  }

  async function handshake(): Promise<void> {
    const init = await rpc.request('initialize', { clientInfo: { name: 'wavi', title: 'Wavi', version: options.clientVersion }, capabilities: null }, HANDSHAKE_TIMEOUT_MS)
    // A reattached server that was initialized before says so; it still works.
    if (!init.ok && !/initiali[sz]ed/i.test(init.message)) {
      io.fail(`Codex 没有完成初始化：${init.message}`)
      return
    }
    rpc.notify('initialized')
    const list = await rpc.request('model/list', {}, HANDSHAKE_TIMEOUT_MS)
    if (list.ok && isRec(list.result) && Array.isArray(list.result.data)) models = list.result.data
    emitConfig()
    if (options.resume) {
      const resumed = await rpc.request('thread/resume', { threadId: options.resume }, HANDSHAKE_TIMEOUT_MS)
      if (resumed.ok && isRec(resumed.result) && takeThread(resumed.result.thread)) {
        isReady = true
        io.ready()
        return
      }
    }
    const started = await rpc.request(
      'thread/start',
      { cwd: options.cwd, ...CODEX_APPROVAL[current.permission ?? 'accept-edits'], sandbox: 'workspace-write', ...(current.model ? { model: current.model } : {}) },
      HANDSHAKE_TIMEOUT_MS
    )
    if (!started.ok || !isRec(started.result) || !takeThread(started.result.thread)) {
      io.fail(`Codex 没能开始对话：${started.ok ? '没有返回 thread' : started.message}`)
      return
    }
    isReady = true
    io.ready()
  }

  function replayedResponse(message: Rec): void {
    const result = isRec(message.result) ? message.result : null
    if (!result) return
    if (isRec(result.thread) && !threadId) takeThread(result.thread)
    if (Array.isArray(result.data) && result.data.some((m) => isRec(m) && (typeof m.id === 'string' || typeof m.model === 'string'))) {
      models = result.data
      emitConfig()
    }
  }

  return {
    start() {
      void handshake()
    },

    line(message, replay) {
      if (rpc.handle(message)) return
      if (isResponse(message)) {
        if (replay) replayedResponse(message)
        return
      }
      const method = str(message.method)
      if (!method) return
      const params = isRec(message.params) ? message.params : {}
      if (isServerRequest(message)) {
        const id = String(message.id)
        // Answered before the app quit: not asked again.
        if (replay && options.answered?.has(id)) return
        const events = normalizer.request(id, method, params)
        if (events.length === 0) {
          if (!replay) rpc.respondError(message.id, -32601, `${method} is not supported by Wavi`)
          return
        }
        requestIds.set(id, message.id)
        io.emit(events)
        return
      }
      if (method === 'thread/name/updated') {
        const name = str(params.threadName)
        if (name && (!threadId || params.threadId === threadId)) io.title(name)
        return
      }
      if (method === 'turn/started') {
        const turn = isRec(params.turn) ? params.turn : {}
        turnId = str(turn.id)
        if (interruptWanted) interrupt()
      }
      const events = normalizer.notification(method, params)
      if (events.length > 0) io.emit(events)
      if (method === 'turn/completed') {
        turnId = undefined
        interruptWanted = false
        const turn = isRec(params.turn) ? params.turn : {}
        if (!replay) {
          const error = isRec(turn.error) ? str(turn.error.message) : undefined
          io.turnEnd({ failed: turn.status === 'failed', ...(error ? { message: error } : {}) })
        }
      }
    },

    replayed() {
      if (threadId) {
        isReady = true
        io.ready()
      } else void handshake()
    },

    async send(text, attachments) {
      if (!threadId) return false
      const images = attachments.filter(isImagePath)
      const body = withPaths(text, attachments.filter((p) => !isImagePath(p)))
      const id = threadId
      const params = codexTurnParams(id, body, config, images)
      // The reviewer holds for later turns: once 自动 was used, the other levels put the user back.
      if (params.approvalsReviewer === 'auto_review') reviewerSet = true
      else if (reviewerSet) params.approvalsReviewer = 'user'
      void rpc.request('turn/start', params).then((outcome) => {
        if (outcome.ok) return
        // Refused before it began: there is no turn/completed to end it.
        io.emit([...normalizer.failed(outcome.message), { type: 'busy', busy: false }])
        io.turnEnd({ failed: true, message: outcome.message })
      })
      return true
    },

    answer(answer: GuiAnswer) {
      const pending = normalizer.pending(answer.id)
      const rawId = requestIds.get(answer.id)
      if (!pending || rawId === undefined) return false
      if (!rpc.respond(rawId, codexAnswerResult(pending, answer))) return false
      requestIds.delete(answer.id)
      io.emit(normalizer.settle(answer.id))
      return true
    },

    interrupt() {
      if (!isReady || !threadId) return false
      // Sent before the server said which turn started: interrupt it as soon as it does.
      if (!turnId) interruptWanted = true
      else interrupt()
      return true
    },

    async setConfig(id, value) {
      const option = config.find((o) => o.id === id)
      if (!option || !option.values.some((v) => v.value === value)) return false
      if (id === 'model') {
        current.model = value
        // Another model has its own efforts: start from its default.
        current.effort = undefined
      } else if (id === 'effort') current.effort = value
      else if (id === 'permission' && isCodexLevel(value)) current.permission = value
      else return false
      emitConfig()
      return true
    },

    closed() {
      rpc.failAll('the agent is not running')
    }
  }
}
