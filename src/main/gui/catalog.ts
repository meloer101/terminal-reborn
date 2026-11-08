// An agent's models for an empty GUI session's agent menu (PRD F23 v1.159, Figma 65B), asked without starting a
// conversation — the way T3 Code (`6417151`) and Paseo (`27872a8`) do — so nothing shows up in the agent's own history:
//   Claude  `claude -p` stream-json, `initialize` only (no message, no transcript)
//   Codex   `codex app-server`, `model/list` only (no thread)
//   Grok    `grok agent stdio`, ACP `initialize` only — its `_meta.modelState` (T3 Code; never `session/new`)
//   Cursor  `cursor-agent models` (its ACP lists sessions, so no `session/new` there)
//   Pi      `pi --mode rpc --no-session --offline`, `get_available_models` + `get_state` (T3 Code)
// Other ACP agents only list models in a session: none is asked (the menu shows their default until they have run).
// Answers are kept a few minutes; one probe per agent at a time.

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { AGENT_SPECS, type CliAgent } from '@shared/agents'
import type { GuiCatalogResult, GuiModelCatalog } from '@shared/gui-chat'
import { executableOnPath, userLoginPath } from '../agents-installed'
import { claudeConfig } from './claude-stream'
import { codexConfig } from './codex-app-server'

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

const PROBE_TIMEOUT_MS = 15_000
const KEEP_MS = 5 * 60_000

// --- what each agent says, as a catalog (pure) -------------------------------------------------------------------

const fromModelOption = (config: ReturnType<typeof claudeConfig>): GuiModelCatalog | null => {
  const model = config.find((o) => o.category === 'model')
  return model && model.values.length > 0 ? { models: model.values.map(({ value, label }) => ({ value, label })), current: model.current } : null
}

/** Claude's `initialize` answer (its picker without 「Default」, claudeConfig). */
export const claudeCatalog = (init: Rec): GuiModelCatalog | null => fromModelOption(claudeConfig(init, {}))

/** Codex's `model/list` data. */
export const codexCatalog = (models: unknown[]): GuiModelCatalog | null => fromModelOption(codexConfig(models, {}))

/** Grok's ACP `initialize` result: `_meta.modelState` (grok 1.0.77). */
export function grokCatalog(result: Rec): GuiModelCatalog | null {
  const state = isRec(result._meta) && isRec(result._meta.modelState) ? result._meta.modelState : null
  const list = state && Array.isArray(state.availableModels) ? state.availableModels.filter(isRec) : []
  const models = list.flatMap((m) => {
    const value = str(m.modelId)
    return value ? [{ value, label: str(m.name) ?? value }] : []
  })
  if (models.length === 0) return null
  const current = str(state?.currentModelId)
  return { models, ...(current ? { current } : {}) }
}

/** `cursor-agent models`: `id - Name`, the default marked `(default)`, the one in use `(current)`. */
export function cursorCatalog(output: string): GuiModelCatalog | null {
  let current: string | undefined
  let fallback: string | undefined
  const models = output.split('\n').flatMap((line) => {
    const m = /^(\S+) - (.+?)\s*$/.exec(line.trim())
    if (!m) return []
    const [, value, rest] = m as unknown as [string, string, string]
    const marks = /\s*\((default|current)\)/g
    if (/\(current\)/.test(rest)) current = value
    if (/\(default\)/.test(rest)) fallback = value
    return [{ value, label: rest.replace(marks, '').trim() }]
  })
  if (models.length === 0) return null
  const chosen = current ?? fallback
  return { models, ...(chosen ? { current: chosen } : {}) }
}

/** Pi's rpc `get_available_models` models and `get_state` data; a model is `provider/id`, as `--model` takes it. */
export function piCatalog(models: unknown[], state: Rec): GuiModelCatalog | null {
  const values = models.filter(isRec).flatMap((m) => {
    const provider = str(m.provider)
    const id = str(m.id)
    return provider && id ? [{ value: `${provider}/${id}`, label: str(m.name) ?? id }] : []
  })
  if (values.length === 0) return null
  const now = isRec(state.model) ? state.model : null
  const current = now && str(now.provider) && str(now.id) ? `${str(now.provider)}/${str(now.id)}` : undefined
  return { models: values, ...(current ? { current } : {}) }
}

// --- asking ------------------------------------------------------------------------------------------------------

/** A short-lived process spoken to in JSON lines; `talk` sends and waits; the process is killed afterwards. */
async function withProcess<T>(command: string, args: string[], env: NodeJS.ProcessEnv, talk: (send: (m: Rec) => void, next: (match: (m: Rec) => boolean) => Promise<Rec>) => Promise<T>): Promise<T> {
  const child = spawn(command, args, { cwd: homedir(), env, stdio: ['pipe', 'pipe', 'ignore'] })
  const waiting: { match: (m: Rec) => boolean; resolve: (m: Rec) => void }[] = []
  let failed: Error | null = null
  const fail = (error: Error) => {
    failed ??= error
    for (const w of waiting.splice(0)) w.resolve({ __failed: failed.message })
  }
  child.on('error', fail)
  child.on('exit', (code) => fail(new Error(`退出了（退出码 ${code ?? '?'}）`)))
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (!isRec(message)) return
    const at = waiting.findIndex((w) => w.match(message as Rec))
    if (at !== -1) waiting.splice(at, 1)[0]!.resolve(message)
  })
  const send = (m: Rec) => void child.stdin.write(`${JSON.stringify(m)}\n`)
  const next = (match: (m: Rec) => boolean) =>
    new Promise<Rec>((resolve, reject) => {
      if (failed) return reject(failed)
      waiting.push({ match, resolve: (m) => (typeof m.__failed === 'string' ? reject(new Error(m.__failed)) : resolve(m)) })
    })
  const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('没有在 15 秒内回答')), PROBE_TIMEOUT_MS).unref())
  try {
    return await Promise.race([talk(send, next), timer])
  } finally {
    child.kill()
  }
}

/** One command's stdout (cursor-agent models). */
function output(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: homedir(), env, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('没有在 15 秒内回答'))
    }, PROBE_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(out)
    })
  })
}

const ask = async (agent: CliAgent, binary: string, env: NodeJS.ProcessEnv): Promise<GuiModelCatalog | null> => {
  switch (agent) {
    case 'claude':
      return withProcess(binary, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], { ...env, CLAUDE_CODE_ENTRYPOINT: 'wavi' }, async (send, next) => {
        send({ type: 'control_request', request_id: 'wavi-models', request: { subtype: 'initialize' } })
        const reply = await next((m) => m.type === 'control_response' && isRec(m.response) && m.response.request_id === 'wavi-models')
        const response = isRec(reply.response) && isRec(reply.response.response) ? reply.response.response : {}
        return claudeCatalog(response)
      })
    case 'codex':
      return withProcess(binary, ['-c', 'check_for_update_on_startup=false', 'app-server'], env, async (send, next) => {
        send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'wavi', version: '0' } } })
        await next((m) => m.id === 1)
        send({ method: 'initialized' })
        send({ id: 2, method: 'model/list', params: {} })
        const reply = await next((m) => m.id === 2)
        const data = isRec(reply.result) && Array.isArray(reply.result.data) ? reply.result.data : []
        return codexCatalog(data)
      })
    case 'grok':
      return withProcess(binary, ['agent', 'stdio'], env, async (send, next) => {
        send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } })
        const reply = await next((m) => m.id === 1)
        return grokCatalog(isRec(reply.result) ? reply.result : {})
      })
    case 'cursor':
      return cursorCatalog(await output(binary, ['models'], env))
    case 'pi':
      return withProcess(binary, ['--mode', 'rpc', '--no-session', '--offline'], env, async (send, next) => {
        send({ id: 'models', type: 'get_available_models' })
        send({ id: 'state', type: 'get_state' })
        const [models, state] = await Promise.all([next((m) => m.id === 'models'), next((m) => m.id === 'state')])
        const list = isRec(models.data) && Array.isArray(models.data.models) ? models.data.models : []
        return piCatalog(list, isRec(state.data) ? state.data : {})
      })
    default:
      return null
  }
}

/** The agents asked; any other answers `unsupported`. */
export const CATALOG_AGENTS: ReadonlySet<CliAgent> = new Set<CliAgent>(['claude', 'codex', 'grok', 'cursor', 'pi'])

const kept = new Map<CliAgent, { at: number; result: Promise<GuiCatalogResult> }>()

/** The agent's models (kept KEEP_MS; a failure is not kept, so 重试 asks again). */
export function agentModels(agent: CliAgent): Promise<GuiCatalogResult> {
  if (!CATALOG_AGENTS.has(agent)) return Promise.resolve({ ok: false, unsupported: true })
  const hit = kept.get(agent)
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.result
  const result = (async (): Promise<GuiCatalogResult> => {
    const path = (await userLoginPath()) ?? process.env.PATH ?? ''
    const binary = executableOnPath(path, AGENT_SPECS[agent].binary)
    if (!binary) return { ok: false, reason: `没有找到 ${AGENT_SPECS[agent].binary}` }
    try {
      const catalog = await ask(agent, binary, { ...process.env, PATH: path })
      return catalog ? { ok: true, catalog } : { ok: false, reason: '没有列出模型' }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  })()
  kept.set(agent, { at: Date.now(), result })
  void result.then((r) => {
    if (!r.ok && kept.get(agent)?.result === result) kept.delete(agent)
  })
  return result
}
