// One serve-sim helper per simulator (PRD F17 · iOS 模拟器): the CLI in the foreground (`--no-preview`), bound to
// 127.0.0.1 on a free port, run by this app's own binary as Node (ELECTRON_RUN_AS_NODE). It prints one JSON line with
// its stream and input URLs. No Electron imports, so the smoke script runs it in plain Node.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

/**
 * Runs the CLI as `-e` code, with argv `[execPath, cli, ...cliArgs]`. The CLI reads its flags from argv[2] on, as if
 * run as a script; commander would read them from argv[1] on under `-e` (or in a packaged Electron), so `-e` is cleared
 * from execArgv and `defaultApp` set. With `watchStdin`, stdin is a pipe from this process: when the app dies without
 * stopping the helper (crash, SIGKILL) the pipe closes and the helper ends itself instead of streaming on as an orphan
 * (unref'd, so the pipe alone never keeps the helper running).
 */
function launcher(watchStdin: boolean): string {
  return [
    'const cli = process.argv[1];',
    'process.execArgv = [];',
    'process.defaultApp = true;',
    ...(watchStdin
      ? [
          "const end = () => process.kill(process.pid, 'SIGTERM');",
          "process.stdin.on('end', end);",
          "process.stdin.on('error', end);",
          'process.stdin.resume();',
          'process.stdin.unref?.();'
        ]
      : []),
    "import(require('node:url').pathToFileURL(cli).href).catch((e) => { console.error(e); process.exit(1); });"
  ].join('\n')
}

const START_TIMEOUT_MS = 30_000
const STOP_GRACE_MS = 3_000

export interface HelperRuntime {
  /** A binary that runs JavaScript as Node with ELECTRON_RUN_AS_NODE=1 (the app itself; plain node works too). */
  execPath: string
  /** serve-sim's dist/serve-sim.js. */
  cliPath: string
  env: NodeJS.ProcessEnv
}

export interface HelperEndpoints {
  streamUrl: string
  wsUrl: string
  port: number
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

/** The helper's JSON line, accepted only when both URLs point at this machine's loopback. */
export function parseHelperLine(line: string, udid: string): HelperEndpoints | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { streamUrl, wsUrl, port } = value as Record<string, unknown>
  if (typeof streamUrl !== 'string' || typeof wsUrl !== 'string' || typeof port !== 'number') return null
  try {
    const stream = new URL(streamUrl)
    const ws = new URL(wsUrl)
    const loopback = (u: URL) => u.hostname === '127.0.0.1' && u.port === String(port)
    if (stream.protocol !== 'http:' || ws.protocol !== 'ws:' || !loopback(stream) || !loopback(ws)) return null
    if (!stream.pathname.includes(udid) || !ws.pathname.includes(udid)) return null
  } catch {
    return null
  }
  return { streamUrl, wsUrl, port }
}

function cliArgs(udid: string, port: number): string[] {
  return ['--no-preview', udid, '--port', String(port), '--host', '127.0.0.1', '--quiet', '--exit-on-simulator-shutdown']
}

export class SimHelper {
  private stopping = false
  /** Resolves when the helper process has exited (at once for a server this app does not own). */
  readonly exited: Promise<void>

  private constructor(
    private readonly child: ChildProcess,
    readonly endpoints: HelperEndpoints,
    /** False when serve-sim found a server already streaming this device and handed us its URLs: never stopped here. */
    readonly owned: boolean,
    exited: Promise<void>
  ) {
    this.exited = exited
  }

  static async start(runtime: HelperRuntime, udid: string, log: (line: string) => void = () => {}): Promise<SimHelper> {
    const port = await freePort()
    const child = spawn(runtime.execPath, ['-e', launcher(true), runtime.cliPath, ...cliArgs(udid, port)], {
      env: { ...runtime.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000)
      for (const line of chunk.split('\n')) if (line.trim() && !line.includes('codesign_util')) log(line.trim())
    })
    child.stdin?.on('error', () => {})
    const endpoints = await new Promise<HelperEndpoints>((resolve, reject) => {
      let out = ''
      const fail = (message: string) => {
        clearTimeout(timer)
        child.kill('SIGKILL')
        reject(new Error(message))
      }
      const timer = setTimeout(() => fail('serve-sim did not start in time'), START_TIMEOUT_MS)
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        out += chunk
        for (const line of out.split('\n')) {
          const parsed = parseHelperLine(line.trim(), udid)
          if (parsed) {
            clearTimeout(timer)
            resolve(parsed)
            return
          }
        }
        if (out.length > 64 * 1024) fail('serve-sim printed no endpoints')
      })
      child.once('error', (error) => fail(error.message))
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`serve-sim exited (${code ?? 'signal'}): ${stderr.trim().split('\n').pop() ?? ''}`))
      })
    })
    // Keep reading so a chatty helper never blocks on a full pipe.
    child.stdout?.resume()
    return new SimHelper(child, endpoints, endpoints.port === port, exited)
  }

  get alive(): boolean {
    return this.owned && this.child.exitCode === null && this.child.signalCode === null && !this.stopping
  }

  /** SIGTERM, then SIGKILL after a grace period. A server this app does not own is left alone. */
  async stop(): Promise<void> {
    if (!this.owned || this.stopping) return this.exited
    this.stopping = true
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    this.child.kill('SIGTERM')
    const timer = setTimeout(() => this.child.kill('SIGKILL'), STOP_GRACE_MS)
    await this.exited
    clearTimeout(timer)
  }

  /** `serve-sim repair-input -d <udid>`: resets Device Hub's input flag and restarts backboardd (closes running apps). */
  static repairInput(runtime: HelperRuntime, udid: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(runtime.execPath, ['-e', launcher(false), runtime.cliPath, 'repair-input', '-d', udid], {
        env: { ...runtime.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'ignore'
      })
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
      child.once('error', () => resolve(false))
      child.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code === 0)
      })
    })
  }
}
