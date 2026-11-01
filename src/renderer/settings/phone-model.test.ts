import { describe, expect, it } from 'vitest'
import { expiresText, lastSeenText, qrPath } from './phone-model'

describe('设置 · 手机 texts', () => {
  it('counts the pairing code down in minutes and seconds', () => {
    expect(expiresText(272_000)).toBe('4:32 后失效')
    expect(expiresText(1)).toBe('0:01 后失效')
    expect(expiresText(0)).toBe('已失效')
  })

  it('says when a phone was last here', () => {
    const now = 10 * 86_400_000
    expect(lastSeenText(null, now)).toBe('')
    expect(lastSeenText(now - 20_000, now)).toBe('刚刚')
    expect(lastSeenText(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(lastSeenText(now - 3 * 3_600_000, now)).toBe('3 小时前')
    expect(lastSeenText(now - 3 * 86_400_000, now)).toBe('3 天前')
  })

  it('draws a QR code for the pairing link', () => {
    const { size, d } = qrPath('wavi://pair?d=eyJ2IjoxfQ')
    expect(size).toBeGreaterThanOrEqual(21)
    expect(d.startsWith('M0 0h1v1h-1z')).toBe(true)
  })
})
