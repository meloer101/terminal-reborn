import { describe, expect, it } from 'vitest'
import { applyProxyEnv, followSystemProxy, hasProxyEnv, parseScutilProxy, proxyEnv, proxyOfPac, scutilDeps } from './system-proxy'

// `scutil --proxy` on the author's Mac (2026-11-05), with a local proxy app on 7897.
const SCUTIL = `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : 192.168.0.0/16
    2 : *.local
    3 : <local>
  }
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 0
}`

describe('parseScutilProxy / proxyEnv', () => {
  it('reads the proxies that are on and the bypass list', () => {
    expect(parseScutilProxy(SCUTIL)).toEqual({ https: '127.0.0.1:7897', http: '127.0.0.1:7897', exceptions: ['127.0.0.1', '192.168.0.0/16', '*.local', '<local>'], pacOnly: false })
    expect(parseScutilProxy('<dictionary> {\n  HTTPEnable : 0\n  ProxyAutoConfigEnable : 1\n}')).toEqual({ exceptions: [], pacOnly: true })
  })

  it('writes both cases, http:// for HTTP(S), socks5h:// for SOCKS, and local hosts never through the proxy', () => {
    const env = proxyEnv(parseScutilProxy(SCUTIL))
    expect(env).toMatchObject({ HTTPS_PROXY: 'http://127.0.0.1:7897', https_proxy: 'http://127.0.0.1:7897', HTTP_PROXY: 'http://127.0.0.1:7897', http_proxy: 'http://127.0.0.1:7897' })
    expect(env.NO_PROXY).toBe('localhost,127.0.0.1,::1,192.168.0.0/16,.local')
    expect(env.no_proxy).toBe(env.NO_PROXY)
    expect(proxyEnv({ socks: '127.0.0.1:7891' })).toMatchObject({ ALL_PROXY: 'socks5h://127.0.0.1:7891', all_proxy: 'socks5h://127.0.0.1:7891' })
    expect(proxyEnv({ https: 'p:1' })).toMatchObject({ HTTP_PROXY: 'http://p:1' })
    expect(proxyEnv({})).toEqual({})
  })

  it('takes the first proxy of a PAC answer', () => {
    expect(proxyOfPac('PROXY 127.0.0.1:7897; DIRECT')).toEqual({ https: '127.0.0.1:7897', http: '127.0.0.1:7897' })
    expect(proxyOfPac('SOCKS5 127.0.0.1:7891')).toEqual({ socks: '127.0.0.1:7891' })
    expect(proxyOfPac('DIRECT')).toEqual({})
  })
})

describe('followSystemProxy', () => {
  const deps = (texts: string[]) => {
    let at = 0
    return { readSync: () => texts[0] ?? null, read: () => Promise.resolve(texts[Math.min(++at, texts.length - 1)] ?? null) }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('fills an environment without a proxy, follows the system turning it off, and leaves a user’s own proxy alone', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/bin' }
    const off = '<dictionary> {\n  HTTPSEnable : 0\n}'
    const stop = followSystemProxy(env, deps([SCUTIL, SCUTIL, off]), 5)
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7897')
    await new Promise((r) => setTimeout(r, 30))
    expect(hasProxyEnv(env)).toBe(false)
    expect(env.NO_PROXY).toBeUndefined()
    stop()

    const own: NodeJS.ProcessEnv = { https_proxy: 'http://corp:8080' }
    followSystemProxy(own, deps([SCUTIL]))()
    await flush()
    expect(own).toEqual({ https_proxy: 'http://corp:8080' })
  })

  it('asks the automatic configuration when that is all the system has', async () => {
    const env: NodeJS.ProcessEnv = {}
    const pac = '<dictionary> {\n  ProxyAutoConfigEnable : 1\n}'
    followSystemProxy(env, { ...deps([pac, pac]), resolvePac: () => Promise.resolve('PROXY 10.0.0.1:3128; DIRECT') })()
    await flush()
    await flush()
    expect(env.HTTPS_PROXY).toBe('http://10.0.0.1:3128')
  })

  it('keeps a bypass list the user set, merged with the system’s', async () => {
    const env: NodeJS.ProcessEnv = { NO_PROXY: 'corp.internal' }
    const off = '<dictionary> {\n  HTTPSEnable : 0\n}'
    const stop = followSystemProxy(env, deps([SCUTIL, SCUTIL, off]), 5)
    expect(env.NO_PROXY).toBe('corp.internal,localhost,127.0.0.1,::1,192.168.0.0/16,.local')
    await new Promise((r) => setTimeout(r, 30))
    expect(env).toMatchObject({ NO_PROXY: 'corp.internal', no_proxy: 'corp.internal' })
    expect(hasProxyEnv(env)).toBe(false)
    stop()
  })

  it('applyProxyEnv takes out only the proxy variables', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/bin', HTTPS_PROXY: 'http://a', no_proxy: 'x' }
    applyProxyEnv(env, {})
    expect(env).toEqual({ PATH: '/bin' })
  })

  it.runIf(process.platform === 'darwin')('reads this Mac’s system proxy with scutil', async () => {
    const text = await scutilDeps().read()
    expect(text).toContain('<dictionary>')
    expect(() => parseScutilProxy(text ?? '')).not.toThrow()
  })
})
