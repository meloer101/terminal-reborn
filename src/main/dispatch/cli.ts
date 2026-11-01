// `wavi` (PRD F21 接口): Wavi's own binary run as Node (ELECTRON_RUN_AS_NODE) on out/main/wavi-cli.js, from the
// `<userData>/bin/wavi` wrapper Wavi puts first on every agent's PATH. Stateless: it checks the command, writes it to
// this session's WAVI_DIR as `req/<id>.json` and prints the answer main writes to `res/<id>.json`. Never hangs: with no
// answer in 5 s it takes its request back and says Wavi is not answering. Output is for the agent, in English.
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DISPATCH_LIMITS, parseWaviArgv, parseWaviCommand, parseWaviResult, WAVI_HELP, WAVI_SKILL, waviFail, waviOutput, type WaviResult } from '@shared/dispatch'

const env = process.env
const POLL_MS = 50

/** Thrown by print to stop main once the output is on its way; the process exits when stdout has drained. */
const DONE = Symbol('done')

function print(result: WaviResult, json: boolean): never {
  // Exiting right after a write would cut a pipe at 64 KB (long `wavi read` pages): exit once it is flushed.
  process.exitCode = result.ok ? 0 : 1
  process.stdout.write(`${json ? JSON.stringify(result) : waviOutput(result)}\n`, () => process.exit())
  throw DONE
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function main(): Promise<void> {
  const args = parseWaviArgv(process.argv.slice(2))
  if (args.kind === 'skill') return void process.stdout.write(`${WAVI_SKILL}\n`)
  if (args.kind === 'help') return void process.stdout.write(`${WAVI_HELP}\n`)
  if (args.kind === 'error') {
    process.stderr.write(`wavi: ${args.error}\n`)
    process.exit(2)
  }
  const json = args.json
  const raw = args.kind === 'command-stdin' ? { ...args.command, [args.field]: await readStdin() } : args.command
  const parsed = parseWaviCommand(raw)
  if (!parsed.ok) print(waviFail('invalid_request', parsed.error), json)

  const dir = env.WAVI_DIR
  const token = env.WAVI_TOKEN
  if (!dir || !token || !existsSync(join(dir, 'req'))) {
    print(waviFail('wavi_unavailable', 'This shell is not in a Wavi session, so wavi has no one to ask. It works in sessions Wavi starts.'), json)
  }
  // Claude's cross-session inbox, so reports reach this session without typing (§6.14).
  const inbox = env.CLAUDE_CODE_MESSAGING_SOCKET && env.CLAUDE_CODE_MESSAGING_TOKEN ? { socket: env.CLAUDE_CODE_MESSAGING_SOCKET, token: env.CLAUDE_CODE_MESSAGING_TOKEN } : undefined
  const id = randomBytes(8).toString('hex')
  const request = join(dir, 'req', `${id}.json`)
  const response = join(dir, 'res', `${id}.json`)
  await writeFile(`${request}.tmp`, JSON.stringify({ v: 1, token, command: parsed.command, ...(inbox ? { inbox } : {}) }), { mode: 0o600 })
  await rename(`${request}.tmp`, request)

  const deadline = Date.now() + DISPATCH_LIMITS.responseMs
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    let text: string
    try {
      text = await readFile(response, 'utf8')
    } catch {
      continue
    }
    await unlink(response).catch(() => {})
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      value = null
    }
    print(parseWaviResult(value) ?? waviFail('failed', 'Wavi gave an answer wavi could not read.'), json)
  }
  // Take the request back, so Wavi does not act on it after we said it did not answer.
  const taken = await unlink(request).then(
    () => true,
    () => false
  )
  if (!taken) {
    // Wavi picked it up just now and may still answer: give it a moment more.
    await sleep(1_000)
    const late = await readFile(response, 'utf8').catch(() => null)
    if (late !== null) {
      await unlink(response).catch(() => {})
      let value: unknown
      try {
        value = JSON.parse(late)
      } catch {
        value = null
      }
      print(parseWaviResult(value) ?? waviFail('failed', 'Wavi gave an answer wavi could not read.'), json)
    }
  }
  print(waviFail('wavi_unavailable', 'Wavi is not answering right now (the app may be closed or busy). Try again later, or ask the user.'), json)
}

main().catch((error: unknown) => {
  if (error === DONE) return
  process.stderr.write(`wavi: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
