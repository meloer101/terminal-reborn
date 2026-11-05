// The macOS system proxy for what Wavi starts (PRD §6.18): command-line agents and tools read a proxy only from
// HTTPS_PROXY / HTTP_PROXY / ALL_PROXY, never from System Settings, and an app opened from the Finder or Dock gets no
// shell environment — so a Grok that the browser could reach timed out (2026-11-05). When the app started with none
// of those variables, the system proxy goes into this process's environment, which every terminal, GUI agent and
// helper Wavi starts inherits (appEnv, buildPtyEnv). Read at boot, then every minute; a proxy the user set themselves
// is never touched. Only the env parsing is pure; the reads are injected.

import { execFile, execFileSync } from 'node:child_process'

/** The variables a proxy can come from, upper and lower case (curl reads only the lower-case http one). */
export const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const
const MANAGED_VARS = [...PROXY_VARS, 'NO_PROXY', 'no_proxy'] as const

/** Always direct, whatever the system list says. */
const LOCAL = ['localhost', '127.0.0.1', '::1']

export interface SystemProxy {
  https?: string
  http?: string
  socks?: string
  /** Bypass list, as System Settings has it (`*.local`, `169.254/16`). */
  exceptions: string[]
  /** Only an automatic configuration (PAC) is set: the proxy has to be resolved per URL. */
  pacOnly: boolean
}

export const hasProxyEnv = (env: NodeJS.ProcessEnv): boolean => PROXY_VARS.some((key) => !!env[key])

/** `scutil --proxy` → the proxies that are switched on. */
export function parseScutilProxy(text: string): SystemProxy {
  const value = (key: string): string | undefined => new RegExp(`^\\s*${key} : (.+)$`, 'm').exec(text)?.[1]?.trim()
  const on = (kind: string): string | undefined => {
    const host = value(`${kind}Proxy`)
    const port = value(`${kind}Port`)
    return value(`${kind}Enable`) === '1' && host ? `${host}${port ? `:${port}` : ''}` : undefined
  }
  const list = /ExceptionsList : <array> \{([\s\S]*?)\}/.exec(text)?.[1] ?? ''
  const exceptions = [...list.matchAll(/^\s*\d+ : (.+)$/gm)].map((m) => m[1]!.trim()).filter(Boolean)
  const https = on('HTTPS')
  const http = on('HTTP')
  const socks = on('SOCKS')
  const pacOnly = !https && !http && !socks && value('ProxyAutoConfigEnable') === '1'
  return { ...(https ? { https } : {}), ...(http ? { http } : {}), ...(socks ? { socks } : {}), exceptions, pacOnly }
}

/** A PAC answer (`PROXY h:p; DIRECT`, `SOCKS5 h:p`, as Electron's resolveProxy gives it) → the first proxy. */
export function proxyOfPac(answer: string): Pick<SystemProxy, 'https' | 'http' | 'socks'> {
  for (const entry of answer.split(';').map((s) => s.trim())) {
    const [kind, address] = entry.split(/\s+/)
    if (!address) continue
    if (kind === 'PROXY' || kind === 'HTTPS') return { https: address, http: address }
    if (kind === 'SOCKS' || kind === 'SOCKS5') return { socks: address }
  }
  return {}
}

/** The variables for a system proxy, both cases; empty when no proxy is on. */
export function proxyEnv(proxy: Pick<SystemProxy, 'https' | 'http' | 'socks'> & { exceptions?: string[] }): Record<string, string> {
  const env: Record<string, string> = {}
  const set = (key: string, value: string) => {
    env[key] = value
    env[key.toLowerCase()] = value
  }
  const http = proxy.http ?? proxy.https
  const https = proxy.https ?? proxy.http
  if (https) set('HTTPS_PROXY', `http://${https}`)
  if (http) set('HTTP_PROXY', `http://${http}`)
  // socks5h: names are resolved by the proxy (as a SOCKS proxy in System Settings does).
  if (proxy.socks) set('ALL_PROXY', `socks5h://${proxy.socks}`)
  if (Object.keys(env).length === 0) return {}
  const bypass = (proxy.exceptions ?? []).map((e) => (e.startsWith('*.') ? e.slice(1) : e)).filter((e) => !e.includes('<') && !e.includes(' '))
  set('NO_PROXY', [...new Set([...LOCAL, ...bypass])].join(','))
  return env
}

/**
 * Puts `next` in `env`, taking out what an earlier call put there and is gone now. `ownNoProxy` is a bypass list the
 * user set themselves: kept, and merged with the system's.
 */
export function applyProxyEnv(env: NodeJS.ProcessEnv, next: Record<string, string>, ownNoProxy?: string): void {
  for (const key of MANAGED_VARS) {
    let value = next[key]
    if (key === 'NO_PROXY' || key === 'no_proxy') value = [ownNoProxy, value].filter(Boolean).join(',') || undefined
    if (value !== undefined) env[key] = value
    else delete env[key]
  }
}

export interface SystemProxyDeps {
  /** `scutil --proxy` now (sync, at boot) and later (async). */
  readSync(): string | null
  read(): Promise<string | null>
  /** The proxy a URL would use per the automatic configuration (Electron `session.resolveProxy`). */
  resolvePac?(url: string): Promise<string>
}

/** The URL a PAC is asked about: an agent's API, never a local or intranet one. */
const PAC_PROBE = 'https://api.anthropic.com'

/**
 * Keeps `env` on the system proxy while the app runs, when it started without proxy variables. Returns a stop
 * function. Nothing is done when the app was given a proxy of its own (a shell export, the launching app's).
 */
export function followSystemProxy(env: NodeJS.ProcessEnv, deps: SystemProxyDeps, everyMs = 60_000): () => void {
  if (hasProxyEnv(env)) return () => undefined
  const ownNoProxy = env.NO_PROXY || env.no_proxy || undefined
  const apply = (next: Record<string, string>) => applyProxyEnv(env, next, ownNoProxy)
  const take = async (text: string | null): Promise<void> => {
    if (text === null) return
    const proxy = parseScutilProxy(text)
    if (proxy.pacOnly && deps.resolvePac) {
      const answer = await deps.resolvePac(PAC_PROBE).catch(() => '')
      apply(proxyEnv({ ...proxyOfPac(answer), exceptions: proxy.exceptions }))
      return
    }
    apply(proxyEnv(proxy))
  }
  const first = parseScutilProxy(deps.readSync() ?? '')
  if (!first.pacOnly) apply(proxyEnv(first))
  void deps.read().then(take)
  const timer = setInterval(() => void deps.read().then(take), everyMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

const SCUTIL = '/usr/sbin/scutil'

/** The real reads (macOS); elsewhere there is nothing to read. */
export const scutilDeps = (resolvePac?: (url: string) => Promise<string>): SystemProxyDeps => ({
  readSync: () => {
    if (process.platform !== 'darwin') return null
    try {
      return execFileSync(SCUTIL, ['--proxy'], { encoding: 'utf8', timeout: 2000 })
    } catch {
      return null
    }
  },
  read: () =>
    process.platform !== 'darwin'
      ? Promise.resolve(null)
      : new Promise((resolve) => execFile(SCUTIL, ['--proxy'], { encoding: 'utf8', timeout: 2000 }, (error, out) => resolve(error ? null : out))),
  ...(resolvePac ? { resolvePac } : {})
})
